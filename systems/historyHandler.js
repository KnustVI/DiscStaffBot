const PunishmentSystem = require('./punishmentSystem');
const ErrorLogger = require('./errorLogger');

const HistoryHandler = {
    async handle(interaction, args) {
        const targetId = args[1];
        // O terceiro argumento do customId é a página: hist_ID_PAGINA
        const page = parseInt(args[2]) || 1;
        const guildId = interaction.guild.id;

        try {
            // 1. Busca os dados paginados (apenas 5 registros por vez)
            const history = await PunishmentSystem.getUserHistory(guildId, targetId, page);
            const targetUser = await interaction.client.users.fetch(targetId);

            // 2. Usa o "molde" universal que está no PunishmentSystem
            const embed = PunishmentSystem.generateHistoryEmbed(targetUser, history, page);
            const buttons = PunishmentSystem.generateHistoryButtons(targetId, page, history.totalPages);

            // 3. Responde atualizando a mensagem (sem criar uma nova no chat)
            if (interaction.isButton()) {
                await interaction.update({ 
                    embeds: [embed], 
                    components: buttons ? [buttons] : [] 
                });
            } else {
                // Caso seja chamado por outro meio que não botão
                await interaction.reply({ 
                    embeds: [embed], 
                    components: buttons ? [buttons] : [], 
                    ephemeral: true 
                });
            }

        } catch (err) {
            ErrorLogger.log('HistoryHandler_Interaction', err)
            const errorMsg = { content: "❌ Erro ao carregar página. Detalhes salvos no log.", ephemeral: true };
            if (!interaction.replied) await interaction.reply(errorMsg);
        }
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMsg);
            } else {
                await interaction.reply(errorMsg);
            }
        }
    
};

module.exports = HistoryHandler;