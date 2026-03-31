const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Consulta a reputação e punições de um usuário.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a consultar').setRequired(true)),

    async execute(interaction) {
        const { client, guildId, user, options } = interaction;
        const target = options.getUser('usuario');

        // Ponto 2: Acesso centralizado
        const EMOJIS = client.systems.emojis || {};
        const Punishment = client.systems.punishment;
        const Session = client.systems.sessions;

        try {
            // 1. Busca os dados iniciais (Síncrono se possível, mas await por segurança de DB)
            const history = await Punishment.getUserHistory(guildId, target.id, 1);
            
            if (!history || history.totalRecords === 0) {
                return interaction.editReply({ 
                    content: `${EMOJIS.ERRO || '❌'} **${target.username}** está limpo! Nenhum registro encontrado.` 
                });
            }

            // 2. Inicializa a Sessão de Paginação (Expira em 5 min)
            if (Session) {
                Session.set(guildId, user.id, 'history', { 
                    targetId: target.id,
                    currentPage: 1,
                    totalPages: history.totalPages
                });
            }

            // 3. Gera a UI
            const embed = Punishment.generateHistoryEmbed(target, history, 1);
            const components = Punishment.generateHistoryButtons(target.id, 1, history.totalPages);

            await interaction.editReply({ 
                embeds: [embed], 
                components: components ? [components] : [] 
            });

        } catch (err) {
            if (client.systems.logger) client.systems.logger.log('Command_Historico', err);
            await interaction.editReply({ 
                content: `${EMOJIS.ERRO || '❌'} Erro ao carregar histórico: \`${err.message}\`` 
            });
        }
    }
};