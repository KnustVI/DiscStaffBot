const ConfigSystem = require('../systems/configSystem');
const db = require('../database/index');

module.exports = {
    name: 'messageCreate',
    async execute(message, client) {
        if (message.author.bot) return;
        if (!message.channel.isThread()) return;
        
        const thread = message.channel;
        const guild = thread.guild;
        
        const report = db.prepare(`SELECT * FROM reports WHERE thread_id = ? AND status NOT LIKE 'closed%'`).get(thread.id);
        if (!report) return;
        
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        const member = await guild.members.fetch(message.author.id).catch(() => null);
        
        if (!member) return;
        
        const isStaff = staffRoleId && member.roles.cache.has(staffRoleId);
        
        if (isStaff && (report.status === 'waiting' || report.status === 'inactive')) {
            db.prepare(`UPDATE reports SET status = 'responded', last_message_at = ? WHERE id = ?`)
                .run(Date.now(), report.id);
            
            const ReportChatSystem = require('../systems/reportChatSystem');
            const reportSystem = new ReportChatSystem(client);
            await reportSystem.updateAllEmbeds(guild.id, report.id);  // ← CORRIGIDO
            
            console.log(`📌 Report ${report.id} status atualizado para 'responded' por ${message.author.tag}`);
        }
        
        db.prepare(`UPDATE reports SET last_message_at = ? WHERE id = ?`).run(Date.now(), report.id);
    }
};