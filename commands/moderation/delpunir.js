const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delpunir')
        .setDescription('Anula uma punição, remove do histórico e devolve a reputação local.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addIntegerOption(opt => 
            opt.setName('id')
                .setDescription('O número da punição (ex: 12)')
                .setRequired(true)
        )
        .addStringOption(opt => 
            opt.setName('motivo')
                .setDescription('Justificativa para anular esta punição')
                .setRequired(true)
        ),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const punishmentId = interaction.options.getInteger('id');
        const voidReason = interaction.options.getString('motivo');

        const staffSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guildId);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasStaffRole = staffSetting ? interaction.member.roles.cache.has(staffSetting.value) : false;

        if (!isAdmin && !hasStaffRole) {
            return interaction.reply({ 
                content: "❌ Você não tem permissão para anular punições ou o cargo de Staff não foi configurado.", 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // 2. Busca os dados ANTES de deletar para ter acesso ao ticket_id e user_id
            const punishment = db.prepare(`SELECT * FROM punishments WHERE id = ? AND guild_id = ?`).get(punishmentId, guildId);

            if (!punishment) {
                return interaction.editReply(`❌ Nenhuma punição encontrada com o ID **#${punishmentId}** neste servidor.`);
            }

            const ticketRef = punishment.ticket_id || 'N/A';
            const penaltyValues = { 1: 2, 2: 5, 3: 10, 4: 20, 5: 35 };
            const repToRestore = penaltyValues[punishment.severity] || 0;

            // 4. Deleta o registro da punição
            db.prepare(`DELETE FROM punishments WHERE id = ? AND guild_id = ?`).run(punishmentId, guildId);

            // 5. Devolve os pontos
            db.prepare(`
                UPDATE users 
                SET reputation = MIN(100, reputation + ?),
                    penalties = MAX(0, penalties - 1)
                WHERE user_id = ? AND guild_id = ?
            `).run(repToRestore, punishment.user_id, guildId);

            // 6. Envio do Log (Canal do Servidor)
            const logSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guildId);
            if (logSetting) {
                const logChannel = interaction.guild.channels.cache.get(logSetting.value);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle("♻️ Punição Anulada")
                        .setColor('#ff2e6c')
                        .setThumbnail(interaction.guild.iconURL())
                        .addFields(
                            { name: "🆔 ID Anulado", value: `\`#${punishmentId}\``, inline: true },
                            { name: "🎫 Ticket Origem", value: `\`#${ticketRef}\``, inline: true },
                            { name: "👤 Beneficiado", value: `<@${punishment.user_id}>`, inline: true },
                            { name: "👮 Responsável", value: `${interaction.user}`, inline: true },
                            { name: "📈 Restaurado", value: `\`+${repToRestore} pts\``, inline: true },
                            { name: "📝 Motivo Anulação", value: `\`\`\`${voidReason}\`\`\`` }
                        )
                        .setTimestamp();

                    logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                }
            }

            // --- 7. NOTIFICAÇÃO NA DM DO USUÁRIO ---
            const targetUser = await interaction.client.users.fetch(punishment.user_id).catch(() => null);
            if (targetUser) {
                const dmEmbed = new EmbedBuilder()
                    .setTitle(`⚖️ Notificação de Revisão - ${interaction.guild.name}`)
                    .setDescription(`Uma punição aplicada anteriormente à sua conta foi **anulada**.`)
                    .setColor('#00FF7F')
                    .addFields(
                        { name: "🆔 Protocolo", value: `\`#${punishmentId}\``, inline: true },
                        { name: "🎫 Ticket Ref.", value: `\`#${ticketRef}\``, inline: true },
                        { name: "📈 Reputação", value: `Sua pontuação foi restaurada em **+${repToRestore} pontos**.`, inline: false },
                        { name: "📝 Motivo da Anulação", value: voidReason }
                    )
                    .setFooter({ text: "Sua ficha foi limpa em relação a este incidente." })
                    .setTimestamp();

                await targetUser.send({ embeds: [dmEmbed] }).catch(() => null);
            }

            await interaction.editReply({
                content: `✅ Punição **#${punishmentId}** (Ticket: #${ticketRef}) removida com sucesso!\nO usuário <@${punishment.user_id}> recuperou **${repToRestore}** pontos.`
            });

        } catch (error) {
            console.error("Erro crítico no delpunir:", error);
            await interaction.editReply("❌ Erro ao processar a anulação no banco de dados.");
        }
    }
};