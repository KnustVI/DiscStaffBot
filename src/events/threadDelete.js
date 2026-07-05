// src/events/threadDelete.js
/**
 * Válvula de segurança pro report-chat: se a thread de um report/revisão for
 * apagada (staff apagou por engano, limpeza de canal, etc.), libera o report
 * automaticamente no banco — sem isso, ele ficaria "aberto" pra sempre e,
 * com o limite de chats do tier Free, bloquearia o usuário de abrir outro.
 */
const ReportChatSystem = require('../systems/moderation/reportChatSystem');
const ErrorLogger = require('../systems/core/errorLogger');

module.exports = {
    name: 'threadDelete',
    async execute(thread, client) {
        try {
            const reportSystem = new ReportChatSystem(client);
            const released = reportSystem.releaseReportByThreadId(thread.id);
            if (released) {
                console.log(`🔓 [ThreadDelete] Report #R${released.report_number} liberado automaticamente (thread excluída) em ${thread.guild?.name || thread.guildId}`);
            }
        } catch (error) {
            ErrorLogger.error('thread_delete', 'releaseReport', error, { threadId: thread.id });
        }
    }
};
