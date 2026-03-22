const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');
const PunishmentSystem = require('../../systems/punishmentSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('revogar')
        .setDescription('Anula uma punição, devolve reputação e ajusta o histórico.')
        .addIntegerOption(opt => opt.setName('id').setDescription('O ID da punição').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Breve motivo da anulação').setRequired(true)),

    async execute(interaction) {
        const { guild, options, member: mod } = interaction;
        const punishmentId = options.getInteger('id');
        const revogReason = options.getString('motivo');

        // Validação de Permissão (Padrão do Bot)
        const staffRole = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guild.id);
        const logChanId = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guild.id);

        if (!mod.roles.cache.has(staffRole?.value) && !mod.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: `${EMOJIS.ERRO} Apenas a **Staff** pode usar este comando.`, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const result = await PunishmentSystem.revertPunishment(guild.id, punishmentId, revogReason);

            const finalEmbed = new EmbedBuilder()
                .setTitle(`${EMOJIS.UP} Punição Revogada | ID #${punishmentId}`)
                .setDescription(`Reputação devolvida e timer de recuperação reajustado.`)
                .setColor(0x00FF00)
                .addFields(
                    { name: `${EMOJIS.USUARIO} Usuário`, value: `<@${result.userId}>`, inline: true },
                    { name: `${EMOJIS.STAFF} Revogado por`, value: `${interaction.user}`, inline: true },
                    { name: `${EMOJIS.STATUS} Reputação`, value: `\`${result.currentRep} pts (+${result.repRestored})\``, inline: true },
                    { name: `${EMOJIS.TICKET} Ticket Relacionado`, value: `\`#${result.ticketId || 'N/A'}\``, inline: true },
                    { name: `${EMOJIS.NOTE} Motivo da Revogação`, value: `\`\`\`${revogReason}\`\`\`` }
                )
                .setTimestamp();

            // Logs e DMs
            const logChannel = guild.channels.cache.get(logChanId?.value);
            if (logChannel) logChannel.send({ embeds: [finalEmbed] });

            const targetUser = await interaction.client.users.fetch(result.userId).catch(() => null);
            if (targetUser) targetUser.send({ content: `Punição revogada em **${guild.name}**`, embeds: [finalEmbed] }).catch(() => null);

            await interaction.editReply(`${EMOJIS.CHECK} Punição **#${punishmentId}** anulada com sucesso.`);

        } catch (error) {
            console.error(error);
            await interaction.editReply(`${EMOJIS.AVISO} ${error.message || "Erro técnico ao revogar."}`);
        }
    }
};