const cron = require('node-cron');
const db = require('../database/index');

function startInactiveReportsJob(client) {
    console.log('🕐 Job de verificação de reports inativos iniciado');
    
    cron.schedule('0 * * * *', async () => {
        console.log('🕐 Verificando reports inativos...');
        
        try {
            const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
            
            const inactiveReports = db.prepare(`
                SELECT id, guild_id FROM reports 
                WHERE status NOT LIKE 'closed%' 
                AND last_message_at < ?
            `).all(cutoffTime);
            
            for (const report of inactiveReports) {
                db.prepare(`UPDATE reports SET status = 'inactive' WHERE id = ?`).run(report.id);
                
                const ReportChatSystem = require('./reportChatSystem');
                const reportSystem = new ReportChatSystem(client);
                await reportSystem.updateAllEmbeds(report.guild_id, report.id);
                
                console.log(`📌 Report ${report.id} marcado como inativo`);
            }
        } catch (error) {
            console.error('❌ Erro no job de reports inativos:', error);
        }
    }, {
        timezone: "America/Sao_Paulo"
    });
}

module.exports = { startInactiveReportsJob };