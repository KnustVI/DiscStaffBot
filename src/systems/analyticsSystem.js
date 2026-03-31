const db = require('../database/index');
const { EmbedBuilder } = require('discord.js');

class AnalyticsSystem {
    
    /**
     * Atualiza analytics diários de um staff
     */
    static async updateStaffAnalytics(guildId, userId, date = null) {
        const targetDate = date || new Date().toISOString().slice(0, 10);
        
        // Buscar dados do dia
        const punishmentsApplied = db.prepare(`
            SELECT COUNT(*) as count FROM punishments 
            WHERE guild_id = ? AND moderator_id = ? AND date(created_at/1000, 'unixepoch') = ?
        `).get(guildId, userId, targetDate).count;
        
        const ticketsClaimed = db.prepare(`
            SELECT COUNT(*) as count FROM tickets 
            WHERE guild_id = ? AND claimed_by = ? AND date(claimed_at/1000, 'unixepoch') = ?
        `).get(guildId, userId, targetDate).count;
        
        const ticketsClosed = db.prepare(`
            SELECT COUNT(*) as count FROM tickets 
            WHERE guild_id = ? AND closed_by = ? AND date(closed_at/1000, 'unixepoch') = ?
        `).get(guildId, userId, targetDate).count;
        
        // Calcular tempo médio de resposta
        const responseTimes = db.prepare(`
            SELECT (claimed_at - created_at) as response_time 
            FROM tickets 
            WHERE guild_id = ? AND claimed_by = ? AND claimed_at IS NOT NULL 
            AND date(created_at/1000, 'unixepoch') = ?
        `).all(guildId, userId, targetDate);
        
        const avgResponseTime = responseTimes.length > 0 
            ? responseTimes.reduce((a, b) => a + b.response_time, 0) / responseTimes.length / 1000
            : 0;
        
        // Inserir ou atualizar
        db.prepare(`
            INSERT INTO staff_analytics (
                guild_id, user_id, period, date, 
                punishments_applied, tickets_claimed, tickets_closed, 
                avg_response_time, updated_at
            ) VALUES (?, ?, 'day', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, user_id, period, date) 
            DO UPDATE SET
                punishments_applied = excluded.punishments_applied,
                tickets_claimed = excluded.tickets_claimed,
                tickets_closed = excluded.tickets_closed,
                avg_response_time = excluded.avg_response_time,
                updated_at = excluded.updated_at
        `).run(
            guildId, userId, targetDate,
            punishmentsApplied, ticketsClaimed, ticketsClosed,
            Math.round(avgResponseTime), Date.now()
        );
        
        return {
            date: targetDate,
            punishmentsApplied,
            ticketsClaimed,
            ticketsClosed,
            avgResponseTime: Math.round(avgResponseTime)
        };
    }
    
    /**
     * Gera relatório de performance de staff
     */
    static async getStaffReport(guildId, userId, period = 'week') {
        const periods = {
            day: 1,
            week: 7,
            month: 30
        };
        
        const days = periods[period] || 7;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().slice(0, 10);
        
        const data = db.prepare(`
            SELECT * FROM staff_analytics 
            WHERE guild_id = ? AND user_id = ? AND date >= ?
            ORDER BY date DESC
        `).all(guildId, userId, startDateStr);
        
        const totals = {
            punishmentsApplied: 0,
            ticketsClaimed: 0,
            ticketsClosed: 0,
            avgResponseTime: 0
        };
        
        for (const day of data) {
            totals.punishmentsApplied += day.punishments_applied;
            totals.ticketsClaimed += day.tickets_claimed;
            totals.ticketsClosed += day.tickets_closed;
            totals.avgResponseTime += day.avg_response_time;
        }
        
        if (data.length > 0) {
            totals.avgResponseTime = Math.round(totals.avgResponseTime / data.length);
        }
        
        return {
            period,
            days: data.length,
            totals,
            daily: data
        };
    }
    
    /**
     * Gera ranking de staff por período
     */
    static async getStaffRanking(guildId, metric = 'punishments_applied', period = 'week', limit = 10) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (period === 'week' ? 7 : 30));
        const startDateStr = startDate.toISOString().slice(0, 10);
        
        const ranking = db.prepare(`
            SELECT 
                user_id,
                SUM(${metric}) as total
            FROM staff_analytics
            WHERE guild_id = ? AND date >= ?
            GROUP BY user_id
            ORDER BY total DESC
            LIMIT ?
        `).all(guildId, startDateStr, limit);
        
        return ranking;
    }
    
    /**
     * Gera embed com relatório de staff
     */
    static async generateStaffReportEmbed(guildId, userId, period = 'week') {
        const report = await this.getStaffReport(guildId, userId, period);
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setTitle(`📊 Relatório de Performance - <@${userId}>`)
            .setDescription(`Período: ${period === 'week' ? 'Últimos 7 dias' : 'Últimos 30 dias'}`)
            .addFields(
                { name: '⚠️ Punições Aplicadas', value: `${report.totals.punishmentsApplied}`, inline: true },
                { name: '🎫 Tickets Assumidos', value: `${report.totals.ticketsClaimed}`, inline: true },
                { name: '✅ Tickets Fechados', value: `${report.totals.ticketsClosed}`, inline: true },
                { name: '⏱️ Tempo Médio Resposta', value: `${report.totals.avgResponseTime}s`, inline: true }
            )
            .setFooter({ text: `${report.days} dias analisados` })
            .setTimestamp();
        
        return embed;
    }
}

module.exports = AnalyticsSystem;