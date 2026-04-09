const ConfigSystem = require('../systems/configSystem');
const db = require('../database/index');

module.exports = {
    name: 'messageCreate',
    async execute(message, client) {
        // Ignorar bots
        if (message.author.bot) return;
        
        // Verificar se a mensagem é em uma thread
        if (!message.channel.isThread()) return;
        
        const thread = message.channel;
        const guild = thread.guild;
        
        // Buscar o report associado a esta thread
        const report = db.prepare(`SELECT * FROM reports WHERE thread_id = ? AND status NOT LIKE 'closed%'`).get(thread.id);
        if (!report) return;
        
        // Verificar se o autor é staff
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        const member = await guild.members.fetch(message.author.id).catch(() => null);
        
        if (!member) return;
        
        const isStaff = staffRoleId && member.roles.cache.has(staffRoleId);
        
        // Se for staff e o status for 'waiting' ou 'inactive', mudar para 'responded'
        if (isStaff && (report.status === 'waiting' || report.status === 'inactive')) {
            // Atualizar status no banco
            db.prepare(`UPDATE reports SET status = 'responded', last_message_at = ? WHERE id = ?`)
                .run(Date.now(), report.id);
            
            // Atualizar embeds
            const ReportChatSystem = require('../systems/reportChatSystem');
            const reportSystem = new ReportChatSystem(client);
            await reportSystem.updateEmbeds(guild.id, report.id);
            
            console.log(`📌 Report ${report.id} status atualizado para 'responded' por ${message.author.tag}`);
        }
        
        // Atualizar last_message_at para qualquer mensagem
        db.prepare(`UPDATE reports SET last_message_at = ? WHERE id = ?`).run(Date.now(), report.id);
    }
};