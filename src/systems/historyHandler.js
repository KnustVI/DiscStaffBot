const PunishmentSystem = require('./punishmentSystem');
const ErrorLogger = require('./errorLogger');
const { EMOJIS } = require('../../../database/emojis');

const HistoryHandler = {
    async handle(interaction, parts) {
        // Padrão esperado do customId: hist:set:USERID:PAGE
        // parts[0] = hist, parts[1] = set, parts[2] = targetId, parts[3] = page
        const targetId = parts[2]; 
        const page = parseInt(parts[3]) || 1;
        const guildId = interaction.guildId;

        try {
            // 1. Busca os dados paginados no banco/cache
            const history = await PunishmentSystem.getUserHistory(guildId, targetId, page);
            
            // 2. Busca o objeto do usuário (necessário para o Embed)
            // Usamos fetch apenas se não estiver no cache do client para performance
            const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);

            if (!targetUser) {
                throw new Error("Não foi possível encontrar as informações deste usuário no Discord.");
            }

            // 3. Gera a interface atualizada (Mantendo suas funções originais)
            const embed = PunishmentSystem.generateHistoryEmbed(targetUser, history, page, interaction.guild.name);
            const buttons = PunishmentSystem.generateHistoryButtons(targetId, page, history.totalPages);

            // 4. Responde editando a mensagem original
            // Como o InteractionCreate já usou deferUpdate(), usamos editReply() com segurança
            await interaction.editReply({ 
                embeds: [embed], 
                components: buttons ? [buttons] : [] 
            });

        } catch (err) {
            // Logamos internamente para o administrador
            ErrorLogger.log('HistoryHandler_Interaction', err);
            console.error(`[HistoryHandler Error]`, err);

            // Relançamos o erro. Por quê? 
            // Porque o interactionCreate vai capturar e enviar o Embed de erro preciso no Discord.
            throw err; 
        }
    }
};

module.exports = HistoryHandler;