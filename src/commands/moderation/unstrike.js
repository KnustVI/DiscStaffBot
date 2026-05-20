// src/commands/moderation/unstrike.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');
const ContainerFormatter = require('../../utils/ContainerFormatter');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unstrike')
        .setDescription('Anula uma punição e devolve os pontos ao usuário.')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID da punição').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da anulação').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, options, user: staff, member: staffMember } = interaction;
        const guildId = guild.id;
        
        const punishmentId = options.getInteger('id');
        const reason = options.getString('motivo');
        
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {}
        
        try {
            db.ensureUser(staff.id, staff.username, staff.discriminator, staff.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            const ConfigSystem = require('../../systems/configSystem');
            const PunishmentSystem = require('../../systems/punishmentSystem');
            
            const punishment = db.prepare(`
                SELECT * FROM punishments WHERE id = ? AND guild_id = ? AND status = 'active'
            `).get(punishmentId, guildId);
            
            if (!punishment) {
                return await ResponseManager.error(interaction, `Punição #${punishmentId} não encontrada ou já anulada.`);
            }
            
            let targetMember = null;
            try {
                targetMember = await guild.members.fetch(punishment.user_id).catch(() => null);
            } catch (err) {}
            
            const isStaffHigher = targetMember && 
                targetMember.roles.highest.position >= staffMember.roles.highest.position && 
                staff.id !== guild.ownerId;
            
            if (isStaffHigher) {
                return await ResponseManager.error(interaction, 'Você não pode anular punições de um cargo superior.');
            }
            
            const pointsMap = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 100 };
            const pointsToRestore = pointsMap[punishment.severity] || 10;
            
            const currentRep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`)
                .get(guildId, punishment.user_id)?.points || 100;
            const newPoints = Math.min(100, currentRep + pointsToRestore);
            
            db.prepare(`UPDATE punishments SET status = 'revoked', revoked_by = ?, revoked_reason = ?, revoked_at = ?
                WHERE id = ? AND guild_id = ?`).run(staff.id, reason, Date.now(), punishmentId, guildId);
            
            db.prepare(`UPDATE reputation SET points = ?, updated_at = ?, updated_by = ?
                WHERE guild_id = ? AND user_id = ?`).run(newPoints, Date.now(), staff.id, guildId, punishment.user_id);
            
            const strikeRoleId = ConfigSystem.getSetting(guildId, 'strike_role');
            if (strikeRoleId && targetMember?.roles.cache.has(strikeRoleId)) {
                try {
                    await targetMember.roles.remove(strikeRoleId, `Punição #${punishmentId} anulada`);
                } catch (err) {}
            }
            
            if (targetMember?.communicationDisabledUntilTimestamp) {
                try {
                    await targetMember.timeout(null, `Punição #${punishmentId} anulada`);
                } catch (err) {}
            }
            
            db.logActivity(guildId, staff.id, 'unstrike', punishment.user_id, {
                command: 'unstrike', punishmentId, pointsRestored: pointsToRestore, oldPoints: currentRep, newPoints
            });
            
            await AnalyticsSystem.updateStaffAnalytics(guildId, staff.id);
            
            const targetUser = await client.users.fetch(punishment.user_id).catch(() => null);
            
            // Container unificado
            const container = PunishmentSystem.generateUnstrikeUnifiedContainer(
                targetUser,
                staff,
                punishmentId,
                reason,
                pointsToRestore,
                newPoints,
                punishment.reason,
                guild.name
            );

            if (targetUser) {
                try {
                    await targetUser.send(container.build()).catch(() => null);
                } catch (err) {}
            }

            const logChannelId = ConfigSystem.getSetting(guildId, 'log_punishments');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        await logChannel.send(container.build()).catch(() => null);
                    }
                } catch (err) {}
            }

            await interaction.editReply({ 
                content: `✅ **Strike #${punishmentId} anulado!**\n📈 +${pointsToRestore} pts | ⭐ Reputação: ${newPoints}/100`,
                components: []
            });
            
            console.log(`📊 [UNSTRIKE] ${staff.tag} anulou #${punishmentId} | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            console.error('❌ Erro no unstrike:', error);
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao anular strike. A equipe foi notificada.');
        }
    }
};