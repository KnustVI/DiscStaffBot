// src/commands/strike/personalizado.js — /strike personalizado
// Restrito ao cargo Supervisor (ver /config roles) — modo manual completo,
// com controle total sobre duração/ação no Discord/ação em jogo, todos
// sobrescrevendo o valor do nível escolhido como base.
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');
const PremiumSystem = require('../../systems/premium/premiumSystem');

module.exports = {
    async execute(interaction, client) {
        const { guild, options, user: staff, member: staffMember } = interaction;
        const guildId = guild.id;

        const PunishmentSystem = require('../../systems/moderation/punishmentSystem');

        if (!(await PunishmentSystem.memberHasSupervisorRole(guild, staffMember))) {
            return await ResponseManager.error(interaction, 'Este subcomando é restrito ao cargo Supervisor (ver /config roles).');
        }

        if (!PremiumSystem.isGuildAtLeast(guildId, 'rastreador')) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guildId));
        }

        const targetUser = options.getUser('usuario');
        const reason = options.getString('motivo');
        const durationOverride = options.getString('duracao') || null;
        const discordAct = options.getString('discord_act') || 'none';
        const jogoActOption = options.getString('jogo_act') || null;
        const jogoActOverride = (jogoActOption && jogoActOption !== 'none') ? jogoActOption : null;
        let reportId = options.getString('report') || null;

        try {
            if (!targetUser) {
                return await ResponseManager.error(interaction, 'Usuário não encontrado.');
            }

            if (reportId) {
                const match = reportId.trim().match(/^#?R?(\d+)$/i);
                if (!match) {
                    return await ResponseManager.error(interaction, 'ID de Report inválido. Use o formato #R5 (ou apenas 5).');
                }
                const reportNumber = parseInt(match[1]);
                const reportExists = db.prepare(`SELECT 1 FROM reports WHERE guild_id = ? AND report_number = ?`).get(guildId, reportNumber);
                if (!reportExists) {
                    return await ResponseManager.error(interaction, `Report #R${reportNumber} não encontrado neste servidor.`);
                }
                reportId = `#R${reportNumber}`;
            }

            db.ensureUser(staff.id, staff.username, staff.discriminator, staff.avatar);
            db.ensureUser(targetUser.id, targetUser.username, targetUser.discriminator, targetUser.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            const isStaffHigher = targetMember &&
                targetMember.roles.highest.position >= staffMember.roles.highest.position &&
                staff.id !== guild.ownerId;

            if (isStaffHigher) {
                db.logActivity(guildId, staff.id, 'strike_denied', targetUser.id, { command: 'strike_personalizado', reason: 'Hierarquia insuficiente' });
                return await ResponseManager.error(interaction, 'Você não pode punir este membro.');
            }

            // ── Todo campo manual (duração/discordAct/jogoAct) sobrescreve o
            // valor do nível escolhido como base — ver
            // PunishmentSystem._mergeLevelIntoSession. ─────────────────────────
            sessionManager.set(staff.id, guildId, 'strike_staging', 'strike_staging', {
                targetId: targetUser.id,
                reason,
                reportId,
                discordAct,
                jogoActOverride,
                durationOverride,
                alderonId: null,
            }, 120000);

            await PunishmentSystem.showLevelSelector(interaction, 'personalizado');
        } catch (error) {
            console.error('❌ Erro no /strike personalizado:', error);
            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao preparar aplicação de strike. A equipe foi notificada.');
        }
    },
};
