// /home/ubuntu/DiscStaffBot/src/events/messageCreate.js
const ConfigSystem = require('../systems/core/configSystem');
const db = require('../database/index');

module.exports = {
    name: 'messageCreate',
    async execute(message, client) {
        if (message.author.bot) return;
        if (!message.channel.isThread()) return;
        
        const thread = message.channel;
        const guild = thread.guild;
        
        // Buscar o report pela thread_id
        const report = db.prepare(`
            SELECT guild_id, report_number, status, created_at, last_reply_at
            FROM reports
            WHERE thread_id = ? AND status NOT LIKE 'closed%'
        `).get(thread.id);
        
        if (!report) return;
        
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        const member = await guild.members.fetch(message.author.id).catch(() => null);
        if (!member) return;
        
        const isStaff = staffRoleId && member.roles.cache.has(staffRoleId);
        const now = Date.now();
        
        // Determinar o novo status baseado em quem respondeu
        let newStatus = report.status;
        let lastReplyBy = null;
        let lastReplyAt = now;
        
        if (isStaff) {
            // Staff respondeu
            if (report.status === 'waiting' || report.status === 'inactive') {
                newStatus = 'responded';
            }
            lastReplyBy = `staff:${message.author.id}`;
        } else {
            // Usuário respondeu
            newStatus = 'waiting'; // Volta para aguardando staff
            lastReplyBy = `user:${message.author.id}`;
        }
        
        // Atualizar o report com nova data e status
        db.prepare(`
            UPDATE reports
            SET last_message_at = ?,
                last_reply_by = ?,
                last_reply_at = ?,
                status = ?
            WHERE guild_id = ? AND report_number = ?
        `).run(now, lastReplyBy, lastReplyAt, newStatus, report.guild_id, report.report_number);

        // Histórico de mensagens do report — tabela existia no schema mas
        // nunca era populada. Também alimenta as métricas de staff abaixo.
        db.prepare(`
            INSERT INTO report_messages (guild_id, report_number, message_id, user_id, content, created_at, is_staff_reply)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(report.guild_id, report.report_number, message.id, message.author.id, message.content?.slice(0, 2000) || null, now, isStaff ? 1 : 0);

        // Analytics de staff: quantidade de mensagens + tempo desde a última
        // mensagem da thread (de qualquer pessoa) até esta resposta de staff.
        if (isStaff) {
            const AnalyticsSystem = require('../systems/moderation/analyticsSystem');
            const previousAt = report.last_reply_at || report.created_at;
            const responseSeconds = previousAt ? Math.max(0, Math.round((now - previousAt) / 1000)) : null;
            AnalyticsSystem.recordReportMessage(report.guild_id, message.author.id, responseSeconds);
        }

        // Se o status mudou, atualizar os containers
        if (newStatus !== report.status) {
            const ReportChatSystem = require('../systems/moderation/reportChatSystem');
            const reportSystem = new ReportChatSystem(client);
            const reportId = `#R${report.report_number}`;
            await reportSystem.updateStatus(report.guild_id, reportId, newStatus);
            
            const replyType = isStaff ? 'staff' : 'usuário';
            console.log(`📌 Report ${reportId} status atualizado para '${newStatus}' (${replyType} respondeu)`);
        }
    }
};