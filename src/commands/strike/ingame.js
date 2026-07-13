// src/commands/strike/ingame.js — /strike ingame
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const { getPlayerByAlderonId, getPlayerNameByAlderonId } = require('../../systems/pot/potPlayerRegistry');

module.exports = {
    async execute(interaction, client) {
        const { guild, options, user: staff, member: staffMember } = interaction;
        const guildId = guild.id;

        // ── Sem níveis configuráveis não há o que selecionar — este fluxo
        // exige tier >= Rastreador (ver punishmentLevels.js, maxPunishmentLevels). ──
        if (!PremiumSystem.isGuildAtLeast(guildId, 'rastreador')) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guildId));
        }

        const alderonId = options.getString('alderon_id').trim();
        const reason = options.getString('motivo');
        let reportId = options.getString('report') || null;

        try {
            const PunishmentSystem = require('../../systems/moderation/punishmentSystem');

            // ── Comando livre pra jogador registrado ou não (/registrar) —
            // sem vínculo, segue com um alvo sintético (ver
            // PunishmentSystem._unregisteredTargetId): a ação em jogo usa o
            // AGID normalmente, os painéis de log são enviados do mesmo
            // jeito, só não há DM (sem conta Discord pra notificar) nem
            // ação automática no Discord (sem membro real pra aplicar). ────
            const link = getPlayerByAlderonId(alderonId);
            const targetId = link ? link.user_id : PunishmentSystem._unregisteredTargetId(alderonId);
            const targetPlayerName = link?.player_name || getPlayerNameByAlderonId(guildId, alderonId) || null;

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
            if (link) db.ensureUser(link.user_id, link.player_name || 'unknown', '0000', null);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

            // Hierarquia só faz sentido pra alvo com membro real no servidor
            // — sem vínculo, não há cargo nenhum pra comparar, então segue.
            const targetMember = link ? await guild.members.fetch(link.user_id).catch(() => null) : null;
            const isStaffHigher = targetMember &&
                targetMember.roles.highest.position >= staffMember.roles.highest.position &&
                staff.id !== guild.ownerId;

            if (isStaffHigher) {
                db.logActivity(guildId, staff.id, 'strike_denied', targetId, { command: 'strike_ingame', reason: 'Hierarquia insuficiente' });
                return await ResponseManager.error(interaction, 'Você não pode punir este membro.');
            }

            // ── Guarda os dados básicos staged; o select-menu de nível
            // (mostrado a seguir) preenche o resto (ver
            // PunishmentSystem.handleLevelSelect/_mergeLevelIntoSession). ──────
            sessionManager.set(staff.id, guildId, 'strike_staging', 'strike_staging', {
                targetId,
                reason,
                reportId,
                discordAct: 'none',
                jogoActOverride: null,
                durationOverride: null,
                alderonId,
                targetPlayerName,
            }, 120000);

            await PunishmentSystem.showLevelSelector(interaction, 'ingame');
        } catch (error) {
            console.error('❌ Erro no /strike ingame:', error);
            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao preparar aplicação de strike. A equipe foi notificada.');
        }
    },
};
