// /home/ubuntu/DiscStaffBot/src/systems/monitoring/inactiveReportsJob.js
const cron = require('node-cron');
const db = require('../../database/index');

function startInactiveReportsJob(client) {
    console.log('🕐 Job de verificação de reports inativos iniciado');
    
    cron.schedule('0 * * * *', async () => {
        console.log('🕐 Verificando reports inativos...');
        
        try {
            // 24 horas sem mensagens para considerar inativo
            const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
            
            // Buscar reports inativos usando a nova estrutura
            const inactiveReports = db.prepare(`
                SELECT guild_id, report_number 
                FROM reports 
                WHERE status NOT LIKE 'closed%' 
                AND status != 'inactive'
                AND last_message_at < ?
            `).all(cutoffTime);
            
            for (const report of inactiveReports) {
                // Atualizar status para inactive
                db.prepare(`
                    UPDATE reports 
                    SET status = 'inactive' 
                    WHERE guild_id = ? AND report_number = ?
                `).run(report.guild_id, report.report_number);
                
                const ReportChatSystem = require('../moderation/reportChatSystem');
                const reportSystem = new ReportChatSystem(client);
                const reportId = `#R${report.report_number}`;
                await reportSystem.updateStatus(report.guild_id, reportId, 'inactive');
                
                console.log(`📌 Report ${reportId} marcado como inativo (24h sem mensagens)`);
            }
        } catch (error) {
            console.error('❌ Erro no job de reports inativos:', error);
        }
    }, {
        timezone: "America/Sao_Paulo"
    });
}

module.exports = { startInactiveReportsJob };