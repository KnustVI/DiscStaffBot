const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unstrike')
        .setDescription('Anula uma punição e devolve os pontos ao usuário.')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID da punição').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da anulação').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        const { client, guild, options, user } = interaction;
        const Punishment = client.systems.punishment;
        const EMOJIS = client.systems.emojis || {};

        try {
            // Chamada para o sistema que remove o strike e devolve os pontos
            const result = await Punishment.executeUnstrike({
                guild,
                punishmentId: options.getInteger('id'),
                moderator: user,
                reason: options.getString('motivo') 
            });

            if (!result.success) {
                return interaction.editReply({
                    content: `${EMOJIS.ERRO || '❌'} **Erro:** ${result.message || 'Punição não encontrada.'}`
                });
            }

            await interaction.editReply({
                content: `${EMOJIS.CHECK || '✅'} **Punição #${options.getInteger('id')} anulada!**\nOs pontos foram devolvidos para <@${result.targetId}> e o status de reputação foi sincronizado.`
            });

        } catch (err) {
            if (client.systems.logger) client.systems.logger.log('Command_Unstrike', err);
            await interaction.editReply({
                content: `${EMOJIS.ERRO || '❌'} **Falha crítica:** \`${err.message}\``
            });
        }
    }
};