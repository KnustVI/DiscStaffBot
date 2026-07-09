// src/commands/strike/registro.js — /strike registro
// Registro simples de punição — disponível em QUALQUER tier (incluindo
// Free), sem nível/severidade, sem pontos extras além da dedução padrão de
// reputação (se o tier tiver reputationEnabled) e sem nenhuma ação
// automática (nem no Discord, nem em jogo). Ao contrário de /strike ingame
// e /strike personalizado — que usam um nível pra aplicar ação em jogo via
// RCON — este subcomando é puramente registro.
//
// Nota: um /strike "bare" (sem subcomando nenhum) não é possível enquanto
// ingame/personalizado existirem como subcomandos — a API do Discord não
// permite misturar opções de topo com subcomandos no mesmo comando. Por
// isso este vira um subcomando próprio, com nome "registro" (não "strike",
// pra evitar a redundância de "/strike strike").
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');

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
                db.logActivity(guildId, staff.id, 'strike_denied', targetUser.id, { command: 'strike_registro', reason: 'Hierarquia insuficiente' });
                return await ResponseManager.error(interaction, 'Você não pode punir este membro.');
            }

            // ── Registro puro: sem nível, sem pontos extras, sem ação
            // automática no Discord nem em jogo — vale pra qualquer tier. ──────
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
                discordAct: 'none',
                jogoAct: 'none',
                alderonId: null,
            };
            sessionManager.set(staff.id, guildId, 'strike_pending', 'strike_pending', session, 120000);

            const PunishmentSystem = require('../../systems/moderation/punishmentSystem');
            const preview = await PunishmentSystem.buildStrikeConfirmPreview(session, guild, staffMember);
            await interaction.editReply(preview);
        } catch (error) {
            console.error('❌ Erro no /strike registro:', error);
            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao preparar aplicação de strike. A equipe foi notificada.');
        }
    },
};
