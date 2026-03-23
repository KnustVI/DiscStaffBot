const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const PunishmentSystem = require('../../systems/punishmentSystem');
const ConfigSystem = require('../../systems/configSystem');
const { EMOJIS } = require('../../database/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('strike')
        .setDescription('Aplica uma punição rápida.')
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
        .addStringOption(opt => opt.setName('ticket').setDescription('ID do Ticket (Opcional)').setRequired(false)
        .addStringOption(opt => opt.setName('discord_act').setDescription('Punição no DISCORD')
        .addChoices(
            { name: 'Nenhuma', value: 'none' },
            { name: 'Mute (1h)', value: 'timeout_1h' },
            { name: 'Mute (1d)', value: 'timeout_1d' },
            { name: 'Expulsar (Kick)', value: 'kick' },
            { name: 'Banir (Ban)', value: 'ban' }
        ))
    //.   addStringOption(opt => opt.setName('jogo_act').setDescription('Punição IN-GAME (RCON)')
    //    .addChoices(
    //        { name: 'Nenhuma', value: 'none' },
    //        { name: 'Aviso na Tela', value: 'rcon_warn' },
    //        { name: 'Kick do Jogo', value: 'rcon_kick' },
    //        { name: 'Slay (Matar Dino)', value: 'rcon_slay' },
    //        { name: 'Ban do Jogo', value: 'rcon_ban' }
    //    ))
    .addStringOption(opt => opt.setName('duracao').setDescription('Tempo da punição (Ex: 1h, 3d, 7d). Use "0" para Permanente.').setRequired(true))
    ),

    async execute(interaction) {
        // 1. O "Seguro Anti-Lag" da Oracle
        await interaction.deferReply({ ephemeral: true });

        const { guild, options, channel, member } = interaction;
        const target = options.getUser('usuario');
        
        // Tática de Leveza: Se não informou ticket, tenta pegar o nome do canal atual (ex: ticket-vick)
        const ticketId = options.getString('ticket') || (channel.name.includes('ticket') ? channel.name : 'N/A');

        try {
            // 2. O Comando "Delegado": O sistema faz todo o trabalho pesado
            const result = await PunishmentSystem.executeFullProcess({
                guild,
                target,
                moderator: member,
                severity: options.getInteger('gravidade'),
                reason: options.getString('motivo'),
                ticketId
            });

            await interaction.editReply(`${EMOJIS.CHECK} Punição aplicada! Novo saldo de ${target.username}: **${result.newPoints}/100 pts**.`);
            
        } catch (err) {
            // Se o sistema falhar, ele já logou o erro no ErrorLogger internamente
            await interaction.editReply(`${EMOJIS.ERRO} Erro ao processar. Verifique os logs do sistema.`);
        }
    }
};