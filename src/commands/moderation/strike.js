const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('strike')
        .setDescription('Aplica uma punição rápida e remove pontos.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(opt => opt.setName('usuario').setDescription('Infrator').setRequired(true))
        .addIntegerOption(opt => opt.setName('gravidade').setDescription('Nível (1-5)').setRequired(true)
            .addChoices(
                { name: 'Nível 1 (-10 pts)', value: 1 },
                { name: 'Nível 2 (-25 pts)', value: 2 },
                { name: 'Nível 3 (-40 pts)', value: 3 },
                { name: 'Nível 4 (-60 pts)', value: 4 },
                { name: 'Nível 5 (-100 pts)', value: 5 }
            ))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da punição').setRequired(true))
        .addStringOption(opt => opt.setName('duracao').setDescription('Tempo (Ex: 1h, 3d, 0 para Perm)').setRequired(true))
        .addStringOption(opt => opt.setName('ticket').setDescription('ID do Ticket (Opcional)').setRequired(false))
        .addStringOption(opt => opt.setName('discord_act').setDescription('Punição no DISCORD')
            .addChoices(
                { name: 'Nenhuma', value: 'none' },
                { name: 'Mute (Timeout)', value: 'timeout' },
                { name: 'Expulsar (Kick)', value: 'kick' },
                { name: 'Banir (Ban)', value: 'ban' }
            ))
        .addStringOption(opt => opt.setName('jogo_act').setDescription('Punição IN-GAME (RCON)')
            .addChoices(
                { name: 'Nenhuma', value: 'none' },
                { name: 'Aviso na Tela', value: 'rcon_warn' },
                { name: 'Kick do Jogo', value: 'rcon_kick' },
                { name: 'Slay (Matar)', value: 'rcon_slay' },
                { name: 'Ban do Jogo', value: 'rcon_ban' }
            )),

    async execute(interaction) {
        const { client, guild, options, channel, member } = interaction;
        const EMOJIS = client.systems.emojis || {};
        const Config = client.systems.config;
        const Punishment = client.systems.punishment;

        const auth = Config.checkAuth(interaction);
        if (!auth.authorized) return interaction.editReply({ content: auth.message });

        const target = options.getUser('usuario');
        const ticketId = options.getString('ticket') || (channel?.name?.includes('ticket') ? channel.name : 'N/A');

        try {
            const result = await Punishment.executeFullProcess({
                guild,
                target,
                moderator: member.user,
                severity: options.getInteger('gravidade'),
                reason: options.getString('motivo'),
                ticketId: ticketId,
                discordAct: options.getString('discord_act') || 'none',
                jogoAct: options.getString('jogo_act') || 'none',
                durationStr: options.getString('duracao')
            });

            await interaction.editReply({
                content: `${EMOJIS.CHECK || '✅'} **Punição aplicada!** O saldo de **${target.username}** agora é: \`${result.newPoints}/100 pts\`.`
            });
            
        } catch (err) {
            if (client.systems.logger) client.systems.logger.log('Strike_Cmd', err);
            await interaction.editReply({
                content: `${EMOJIS.ERRO || '❌'} **Erro ao processar strike:** \`${err.message}\``
            });
        }
    }
};