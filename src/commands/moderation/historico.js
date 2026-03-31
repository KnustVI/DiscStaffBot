const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Consulta a reputação e punições de um usuário.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a consultar').setRequired(true)),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     */
    async execute(interaction) {
        const { client, guildId, user, options } = interaction;
        const target = options.getUser('usuario');

        // Extração de sistemas (Lookup em RAM)
        const { punishment, sessions, emojis, logger } = client.systems;
        const EMOJIS = emojis || {};

        try {
            // 1. Busca de dados (Lógica pesada isolada no PunishmentSystem)
            // Mantemos o await aqui pois é uma consulta ao SQLite que pode demorar ms
            const history = await punishment.getUserHistory(guildId, target.id, 1);
            
            // Caso o usuário não tenha registros
            if (!history || history.totalRecords === 0) {
                return await interaction.editReply({ 
                    content: `${EMOJIS.CHECK || '✅'} **${target.username}** não possui registros de punição.` 
                });
            }

            // 2. Sistema de Sessão com Contexto (Ponto 3 do manifesto)
            // Chave estruturada: userId_guildId_history
            if (sessions) {
                sessions.set(guildId, user.id, 'history', { 
                    targetId: target.id,
                    currentPage: 1,
                    totalPages: history.totalPages
                });
            }

            // 3. Geração de UI delegada ao Sistema
            // Padronizamos os CustomIDs como: punishment:history:acao:targetId:page
            const embed = punishment.generateHistoryEmbed(target, history, 1);
            const components = punishment.generateHistoryButtons(target.id, 1, history.totalPages);

            // 4. Resposta (Contrato Slash: editReply)
            await interaction.editReply({ 
                embeds: [embed], 
                components: components ? [components] : [] 
            });

        } catch (err) {
            if (logger) logger.log('Command_Historico', err);
            
            // SafeExecute: Resposta amigável ao erro
            await interaction.editReply({ 
                content: `${EMOJIS.ERRO || '❌'} Erro ao carregar histórico: \`${err.message}\`` 
            }).catch(() => null);
        }
    }
};