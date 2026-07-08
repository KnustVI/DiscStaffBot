// src/commands/strike/discord.js — /strike discord
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');
const PremiumSystem = require('../../systems/premium/premiumSystem');

module.exports = {
    async execute(interaction, client) {
        const { guild, options, user: staff, member: staffMember } = interaction;
        const guildId = guild.id;

        const targetUser = options.getUser('usuario');
        const reason = options.getString('motivo');
        const durationStr = options.getString('duracao') || null;
        let reportId = options.getString('report') || null;

        try {
            if (!targetUser) {
                return await ResponseManager.error(interaction, 'Usuário não encontrado.');
            }

            const isFree = !PremiumSystem.isGuildAtLeast(guildId, 'rastreador');
            if (isFree && !durationStr) {
                return await ResponseManager.error(
                    interaction,
                    'Em servidores sem plano Rastreador/Caçador não há níveis de punição pra puxar uma duração padrão — informe a `duracao` manualmente.',
                );
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
                db.logActivity(guildId, staff.id, 'strike_denied', targetUser.id, { command: 'strike_discord', reason: 'Hierarquia insuficiente' });
                return await ResponseManager.error(interaction, 'Você não pode punir este membro.');
            }

            const PunishmentSystem = require('../../systems/moderation/punishmentSystem');

            if (isFree) {
                // ── Fluxo simplificado (sem níveis): sem pontos, sem ação em
                // jogo. "discordAct" fica marcado como timeout, mas só é
                // aplicado de fato se o tier tiver discordActionsEnabled
                // (Caçador) — em Free isso é sempre bloqueado, então na
                // prática vira só registro (ver PunishmentSystem._executeStrike). ──
                const session = {
                    targetId: targetUser.id,
                    reason,
                    reportId,
                    levelId: null,
                    levelName: null,
                    levelSeverity: null,
                    levelAction: null,
                    pointsLost: 0,
                    durationStr,
                    discordAct: 'timeout',
                    jogoAct: 'none',
                    alderonId: null,
                };
                sessionManager.set(staff.id, guildId, 'strike_pending', 'strike_pending', session, 120000);
                const preview = await PunishmentSystem.buildStrikeConfirmPreview(session, guild, staffMember);
                return await interaction.editReply(preview);
            }

            // ── Rastreador/Caçador: mostra o select-menu de níveis; a
            // duração informada (se houver) sobrescreve a do nível. ──────────
            sessionManager.set(staff.id, guildId, 'strike_staging', 'strike_staging', {
                targetId: targetUser.id,
                reason,
                reportId,
                discordAct: 'none',
                jogoActOverride: null,
                durationOverride: durationStr,
                alderonId: null,
            }, 120000);

            await PunishmentSystem.showLevelSelector(interaction, 'discord');
        } catch (error) {
            console.error('❌ Erro no /strike discord:', error);
            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao preparar aplicação de strike. A equipe foi notificada.');
        }
    },
};
