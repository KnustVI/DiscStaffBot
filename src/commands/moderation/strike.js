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

    async execute(interaction) {
        const { client, guild, options, channel, member } = interaction;
        
        // Ponto 2: Sistemas via lookup de memória
        const EMOJIS = client.systems.emojis || {};
        const Config = client.systems.config;
        const Punishment = client.systems.punishment;

        // 1. Verificação de Autorização (Boas Práticas)
        const auth = Config.checkAuth ? Config.checkAuth(interaction) : { authorized: true };
        if (!auth.authorized) return interaction.editReply({ content: auth.message });

        const targetUser = options.getUser('usuario');
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        // 2. Proteção de Hierarquia (Ponto 3 - Contexto)
        if (targetMember && targetMember.roles.highest.position >= member.roles.highest.position) {
            return interaction.editReply({ 
                content: `${EMOJIS.ERROR || '❌'} Você não pode punir alguém com cargo igual ou superior ao seu.` 
            });
        }

        // 3. Captura automática de Ticket
        const ticketId = options.getString('ticket') || (channel.name.includes('ticket') ? channel.name.split('-')[1] || channel.name : 'N/A');

        try {
            // Ponto 1: O processamento ocorre enquanto o Discord aguarda (Defer já ativo)
            const result = await Punishment.executeFullProcess({
                guild,
                target: targetUser,
                moderator: member.user,
                severity: options.getInteger('gravidade'),
                reason: options.getString('motivo'),
                ticketId: ticketId,
                discordAct: options.getString('discord_act') || 'none',
                jogoAct: options.getString('jogo_act') || 'none',
                durationStr: options.getString('duracao')
            });

            // Resposta Final
            await interaction.editReply({
                content: `${EMOJIS.SUCCESS || '✅'} **Punição registrada com sucesso!**\nO saldo de **${targetUser.username}** agora é \`${result.newPoints || '??'}/100\` pontos.`
            });
            
        } catch (err) {
            if (client.systems.logger) client.systems.logger.log('Strike_Cmd_Error', err);
            console.error("❌ Erro ao processar strike:", err);
            
            await interaction.editReply({
                content: `${EMOJIS.ERROR || '❌'} Erro crítico ao aplicar strike: \`${err.message}\``
            });
        }
    }
};