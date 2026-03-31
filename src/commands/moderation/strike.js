const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('strike')
        .setDescription('Aplica uma punição rápida e remove pontos de reputação.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(opt => opt.setName('usuario').setDescription('Membro infrator').setRequired(true))
        .addIntegerOption(opt => opt.setName('gravidade').setDescription('Nível da infração').setRequired(true)
            .addChoices(
                { name: 'Nível 1 (-10 pts)', value: 1 },
                { name: 'Nível 2 (-25 pts)', value: 2 },
                { name: 'Nível 3 (-40 pts)', value: 3 },
                { name: 'Nível 4 (-60 pts)', value: 4 },
                { name: 'Nível 5 (-100 pts)', value: 5 }
            ))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da punição').setRequired(true))
        .addStringOption(opt => opt.setName('duracao').setDescription('Tempo (Ex: 10m, 1h, 3d, 0 para Perm)').setRequired(true))
        .addStringOption(opt => opt.setName('ticket').setDescription('ID do Ticket (Opcional)').setRequired(false))
        .addStringOption(opt => opt.setName('discord_act').setDescription('Ação imediata no Discord')
            .addChoices(
                { name: 'Nenhuma', value: 'none' },
                { name: 'Mute (Timeout)', value: 'timeout' },
                { name: 'Expulsar (Kick)', value: 'kick' },
                { name: 'Banir (Ban)', value: 'ban' }
            ))
        .addStringOption(opt => opt.setName('jogo_act').setDescription('Ação imediata In-Game')
            .addChoices(
                { name: 'Nenhuma', value: 'none' },
                { name: 'Aviso na Tela', value: 'rcon_warn' },
                { name: 'Kick do Jogo', value: 'rcon_kick' },
                { name: 'Slay (Matar)', value: 'rcon_slay' },
                { name: 'Ban do Jogo', value: 'rcon_ban' }
            )),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     */
    async execute(interaction) {
        const { client, guild, options, channel, member: staffMember } = interaction;
        
        // 1. Lookup de Sistemas (RAM)
        const { emojis, config, punishment, logger } = client.systems;
        const EMOJIS = emojis || {};

        // 2. Extração de Opções
        const targetUser = options.getUser('usuario');
        const severity = options.getInteger('gravidade');
        const reason = options.getString('motivo');
        const durationStr = options.getString('duracao');
        const discordAct = options.getString('discord_act') || 'none';
        const jogoAct = options.getString('jogo_act') || 'none';
        
        // Lógica de Ticket Inteligente (Síncrona)
        const ticketId = options.getString('ticket') || 
            (channel.name.includes('ticket') ? channel.name.split('-')[1] || channel.name : 'N/A');

        try {
            // 3. Validação de Hierarquia (Otimizada com Cache)
            const targetMember = guild.members.cache.get(targetUser.id) || await guild.members.fetch(targetUser.id).catch(() => null);

            if (targetMember && targetMember.roles.highest.position >= staffMember.roles.highest.position && interaction.user.id !== guild.ownerId) {
                return await interaction.editReply({ 
                    content: `${EMOJIS.ERRO || '❌'} **Erro de Hierarquia:** Você não pode punir este membro.` 
                });
            }

            // 4. Processamento da Punição (Lógica em PunishmentSystem)
            // Esta função deve cuidar do DB, Cálculo de Pontos e Ações de API
            const result = await punishment.executeFullProcess({
                guildId: guild.id,
                targetId: targetUser.id,
                moderatorId: interaction.user.id,
                severity,
                reason,
                ticketId,
                durationStr,
                discordAct,
                jogoAct
            });

            // 5. Resposta Imediata (Contrato Slash: editReply)
            await interaction.editReply({
                content: [
                    `${EMOJIS.CHECK || '✅'} **Punição Aplicada com Sucesso!**`,
                    `👤 **Alvo:** ${targetUser.tag}`,
                    `⚖️ **Gravidade:** Nível ${severity}`,
                    `📊 **Saldo Final:** \`${result.newPoints}/100\` pontos.`,
                    discordAct !== 'none' ? `🛠️ **Ação Discord:** \`${discordAct}\`` : null,
                    jogoAct !== 'none' ? `🎮 **Ação Jogo:** \`${jogoAct}\`` : null
                ].filter(Boolean).join('\n')
            });

            // 6. Logs e Notificações (Rodando em Background - Sem await bloqueante)
            punishment.dispatchLogs({
                guild,
                target: targetUser,
                moderator: interaction.user,
                severity,
                reason,
                ticketId,
                newPoints: result.newPoints,
                action: discordAct
            }).catch(e => logger?.log('Strike_Log_Error', e));

        } catch (err) {
            if (logger) logger.log('Command_Strike_Error', err);
            
            await interaction.editReply({
                content: `${EMOJIS.ERRO || '❌'} Erro crítico ao aplicar strike: \`${err.message}\``
            }).catch(() => null);
        }
    }
};