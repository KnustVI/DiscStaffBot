// src/events/threadDelete.js
/**
 * Válvula de segurança pro report-chat: se a thread de um report/revisão for
 * apagada (staff apagou por engano, limpeza de canal, etc.), libera o report
 * automaticamente no banco — sem isso, ele ficaria "aberto" pra sempre e,
 * com o limite de chats do tier Free, bloquearia o usuário de abrir outro.
 *
 * Também descobre QUEM apagou (pedido do dono, pro dashboard mostrar e pro
 * log Geral do servidor — ver reportChatSystem.js _logThreadDeleted) — o
 * evento threadDelete do Discord não vem com o executor, só com a thread em
 * si, então é resolvido via audit log logo em seguida.
 */
const { AuditLogEvent } = require('discord.js');
const ReportChatSystem = require('../systems/moderation/reportChatSystem');
const ErrorLogger = require('../systems/core/errorLogger');

module.exports = {
    name: 'threadDelete',
    async execute(thread, client) {
        try {
            // targetId (não .target, que pode não resolver pra uma thread
            // já sumida do cache) + janela de 10s pra não casar com uma
            // entrada de audit log velha/sem relação com esta exclusão.
            let deletedBy = null;
            if (thread.guild) {
                const auditLogs = await thread.guild.fetchAuditLogs({ type: AuditLogEvent.ThreadDelete, limit: 5 }).catch(() => null);
                const entry = auditLogs?.entries.find(e => e.targetId === thread.id && Date.now() - e.createdTimestamp < 10000);
                deletedBy = entry?.executor?.id || null;
            }

            const reportSystem = new ReportChatSystem(client);
            const released = reportSystem.releaseReportByThreadId(thread.id, deletedBy);
            if (released) {
                console.log(`🔓 [ThreadDelete] Report #REP${released.report_number}${deletedBy ? ` apagado por ${deletedBy}` : ' (autor da exclusão não identificado)'} em ${thread.guild?.name || thread.guildId}`);
            }
        } catch (error) {
            ErrorLogger.error('thread_delete', 'releaseReport', error, { threadId: thread.id });
        }
    }
};
