const PunishmentSystem = require('./punishmentSystem');
const ErrorLogger = require('./errorLogger');

const HistoryHandler = {
    async handle(interaction, parts) {
        // Padrão esperado: hist:set:USERID:PAGE
        const targetId = parts[2]; 
        const page = parseInt(parts[3]) || 1;
        const guildId = interaction.guild.id;

        try {
            // 1. Busca os dados paginados
            const history = await PunishmentSystem.getUserHistory(guildId, targetId, page);
            const targetUser = await interaction.client.users.fetch(targetId);

            // 2. Gera a interface atualizada
            const embed = PunishmentSystem.generateHistoryEmbed(targetUser, history, page, interaction.guild.name);
            const buttons = PunishmentSystem.generateHistoryButtons(targetId, page, history.totalPages);

            // 3. Responde editando a mensagem original
            // Como o InteractionCreate já usou deferUpdate(), usamos editReply
            await interaction.editReply({ 
                embeds: [embed], 
                components: buttons ? [buttons] : [] 
            });

        } catch (err) {
            ErrorLogger.log('HistoryHandler_Interaction', err);
            
            const errorMsg = { 
                content: "❌ Erro ao carregar página do histórico.", 
                ephemeral: true 
            };

            // Envia o erro de forma segura
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(errorMsg);
            } else {
                await interaction.reply(errorMsg);
            }
        }
    }
};

module.exports = HistoryHandler;