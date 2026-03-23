const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');
const PunishmentSystem = require('../../systems/punishment/punishmentSystem');
const ConfigSystem = require('../../systems/config/configSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('revogar')
        .setDescription('Anula uma punição e devolve reputação.')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID da punição').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da anulação').setRequired(true)),

    async execute(interaction) {
        const { guild, options, member: mod } = interaction;
        const punishmentId = options.getInteger('id');
        const revogReason = options.getString('motivo');

        // BUSCA NO CACHE
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        const logChanId = ConfigSystem.getSetting(guild.id, 'logs_channel');

        if (!mod.roles.cache.has(staffRoleId) && !mod.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: `${EMOJIS.ERRO} Sem permissão.`, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const result = await PunishmentSystem.revertPunishment(guild.id, punishmentId, revogReason);

            const finalEmbed = new EmbedBuilder()
                .setAuthor({ name: `Punição Revogada | ID #${punishmentId}`, iconURL: interaction.client.user.displayAvatarURL() })
                .setColor(0x2ECC71)
                .addFields(
                    { name: `${EMOJIS.USUARIO} Usuário`, value: `<@${result.userId}>`, inline: true },
                    { name: `${EMOJIS.STATUS} Nova Reputação`, value: `\`${result.currentRep} pts\``, inline: true },
                    { name: `${EMOJIS.NOTE} Motivo`, value: `\`\`\`${revogReason}\`\`\`` }
                )
                .setTimestamp();

            const logChannel = await guild.channels.fetch(logChanId).catch(() => null);
            if (logChannel) await logChannel.send({ embeds: [finalEmbed] });

            await interaction.editReply(`${EMOJIS.CHECK} Punição **#${punishmentId}** anulada.`);
        } catch (error) {
            await interaction.editReply(`${EMOJIS.AVISO} **Erro:** ${error.message}`);
        }
    }
};