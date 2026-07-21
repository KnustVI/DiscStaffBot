// src/commands/strike/registro.js
// Caminho FREE do /strike unificado (ver src/commands/strike/index.js) —
// chamado diretamente de lá quando o servidor não tem plano Rastreador+
// (sem níveis de punição disponíveis, ver punishmentLevels.js). Registro
// simples: sem nível/severidade, sem ação automática (nem Discord nem em
// jogo), só a dedução padrão de reputação (se o tier tiver
// reputationEnabled). Free perderia a capacidade de punir por completo se
// nível fosse sempre obrigatório (Free tem maxPunishmentLevels = 0) — por
// isso este caminho continua existindo à parte, preservando o que já era
// documentado no Free (ver PREMIUM.txt, seção 1).
//
// Lê `usuario`/`motivo`/`duracao`/`report` direto de interaction.options —
// são os MESMOS nomes de opção do comando único /strike agora (antes eram
// opções do subcomando "registro" que dava nome a este arquivo).
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
