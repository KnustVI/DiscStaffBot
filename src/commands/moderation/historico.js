const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Consulta a reputação e punições de um usuário.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a consultar').setRequired(true)),

    async execute(interaction) {
        const { client, guildId, user } = interaction;
        const target = interaction.options.getUser('usuario');

        // Problema 2: Acessando via client.systems (carregados no index)
        const EMOJIS = client.systems.emojis || {};
        const PunishmentSystem = client.systems.punishment; // Certifique-se de exportar como 'punishment' no index
        const Session = client.systems.sessions;
        const ErrorLogger = client.systems.logger;

        // 1. Inicializa a Sessão (Contextualizada para evitar conflito entre usuários)
        // Guardamos o targetId para que o Pagination Handler saiba quem filtrar depois
        Session.set(guildId, user.id, 'history', { 
            targetId: target.id,
            currentPage: 1 
        });

        try {
            // 2. Busca os dados (Passando página 1 como padrão inicial)
            // Problema 6: Se for consulta ao DB, mantemos o await
            const history = await PunishmentSystem.getUserHistory(guildId, target.id, 1);
            
            if (!history) {
                return interaction.editReply({ 
                    content: `${EMOJIS.ERRO || '❌'} Não foi possível localizar registros para este usuário.` 
                });
            }

            // 3. Gera a UI (Embed e Botões)
            const embed = PunishmentSystem.generateHistoryEmbed(target, history, 1);
            const components = PunishmentSystem.generateHistoryButtons(target.id, 1, history.totalPages);

            // 4. Resposta (Sempre editReply por conta do deferReply global)
            await interaction.editReply({ 
                embeds: [embed], 
                components: components ? [components] : [] 
            });

        } catch (err) {
            if (ErrorLogger) ErrorLogger.log('Command_Historico', err);
            console.error(`[History Error]`, err);
            
            await interaction.editReply({ 
                content: `${EMOJIS.ERRO || '❌'} **Falha ao carregar o histórico:**\n\`${err.message || 'Erro de integridade no banco de dados.'}\`` 
            });
        }
    }
};