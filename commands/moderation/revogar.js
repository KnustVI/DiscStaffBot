const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('revogar')
        .setDescription('Anula uma punição específica, devolve reputação e ajusta o histórico.')
        // Removida a trava rígida para permitir que o cargo Staff veja o comando
        .addIntegerOption(opt => opt.setName('id').setDescription('O ID da punição').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Breve motivo da anulação').setRequired(true)),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const punishmentId = interaction.options.getInteger('id');
        const revogReason = interaction.options.getString('motivo');

        // 1. VERIFICAÇÃO DE PERMISSÃO (STAFF OU ADMIN)
        const staffRoleSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guildId);
        const logChannelSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guildId);

        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasStaffRole = staffRoleSetting ? interaction.member.roles.cache.has(staffRoleSetting.value) : false;

        if (!hasStaffRole && !isAdmin) {
            return interaction.reply({ 
                content: `${EMOJIS.ERRO} Apenas membros da **Staff** podem revogar punições.`, 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // 2. BUSCA A PUNIÇÃO ORIGINAL
            const punishment = db.prepare(`SELECT * FROM punishments WHERE id = ? AND guild_id = ?`).get(punishmentId, guildId);

            if (!punishment) {
                return interaction.editReply(`${EMOJIS.AVISO} Não encontrei a punição **#${punishmentId}**.`);
            }

            if (punishment.severity === 0) {
                return interaction.editReply(`${EMOJIS.AVISO} Esta punição já foi revogada anteriormente.`);
            }

            // 3. CÁLCULO DE REPUTAÇÃO A DEVOLVER
            const metricKey = `punish_${punishment.severity}_rep`;
            const customRep = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, metricKey);
            const defaultRep = { 1: 2, 2: 5, 3: 10, 4: 20, 5: 35 };
            const repToRestore = customRep ? parseInt(customRep.value) : (defaultRep[punishment.severity] || 0);

            // 4. ATUALIZA O REGISTRO DA PUNIÇÃO (Severity 0 = Revogada)
            db.prepare(`UPDATE punishments SET reason = ?, severity = 0 WHERE id = ?`).run(`REVOGADA: ${revogReason}`, punishmentId);

            // 5. AJUSTE DO TIMER DE RECUPERAÇÃO (LAST_PENALTY)
            // Busca a punição ativa mais recente que sobrou
            const lastValidPunishment = db.prepare(`
                SELECT created_at FROM punishments 
                WHERE user_id = ? AND guild_id = ? AND severity > 0 
                ORDER BY created_at DESC LIMIT 1
            `).get(punishment.user_id, guildId);

            const newLastPenalty = lastValidPunishment ? lastValidPunishment.created_at : 0;

            // 6. ATUALIZA O PERFIL DO USUÁRIO NO BANCO
            db.prepare(`
                UPDATE users 
                SET reputation = MIN(100, reputation + ?),
                    penalties = MAX(0, penalties - 1),
                    last_penalty = ?
                WHERE user_id = ? AND guild_id = ?
            `).run(repToRestore, newLastPenalty, punishment.user_id, guildId);

            const userData = db.prepare(`SELECT reputation FROM users WHERE user_id = ? AND guild_id = ?`).get(punishment.user_id, guildId);

            // 7. EMBED DE LOG
            const finalEmbed = new EmbedBuilder()
                .setTitle(`${EMOJIS.UP} Punição Revogada | ID #${punishmentId}`)
                .setDescription(`A reputação foi devolvida e o histórico de recuperação foi reajustado.`)
                .setColor(0x00FF00)
                .addFields(
                    { name: `${EMOJIS.USUARIO} Usuário`, value: `<@${punishment.user_id}>`, inline: true },
                    { name: `${EMOJIS.STAFF} Revogado por`, value: `${interaction.user}`, inline: true },
                    { name: `${EMOJIS.STATUS} Reputação`, value: `\`${userData.reputation} pts (+${repToRestore})\``, inline: true },
                    { name: `${EMOJIS.TICKET} Ticket`, value: `\`#${punishment.ticket_id || 'N/A'}\``, inline: true },
                    { name: `${EMOJIS.NOTE} Motivo`, value: `\`\`\`${revogReason}\`\`\`` }
                )
                .setFooter({ 
                    text: `✧ BOT by: KnustVI`, 
                    iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' 
                })
                .setTimestamp();

            // Envio de Logs
            if (logChannelSetting) {
                const logChannel = interaction.guild.channels.cache.get(logChannelSetting.value);
                if (logChannel) await logChannel.send({ embeds: [finalEmbed] }).catch(() => null);
            }

            // Notificação via DM
            const targetUser = await interaction.client.users.fetch(punishment.user_id).catch(() => null);
            if (targetUser) {
                await targetUser.send({ 
                    content: `${EMOJIS.DM} Uma punição aplicada a você foi revogada em **${interaction.guild.name}**.`,
                    embeds: [finalEmbed] 
                }).catch(() => null);
            }

            await interaction.editReply(`${EMOJIS.CHECK} Punição **#${punishmentId}** revogada e métricas atualizadas.`);

        } catch (error) {
            console.error("Erro ao revogar punição:", error);
            await interaction.editReply(`${EMOJIS.ERRO} Houve um erro técnico ao processar a revogação.`);
        }
    }
};