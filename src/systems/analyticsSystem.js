// /home/ubuntu/DiscStaffBot/src/systems/analyticsSystem.js
const db = require('../database/index');
const ContainerFormatter = require('../utils/containerFormatter');

let EMOJIS = {};
try {
    const emojisFile = require('../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

class AnalyticsSystem {
    
    static getLocalDate(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    
    static async updateStaffAnalytics(guildId, userId, date = null) {
        const targetDate = date || this.getLocalDate();
        
        const punishmentsApplied = db.prepare(`
            SELECT COUNT(*) as count FROM punishments 
            WHERE guild_id = ? AND moderator_id = ? 
            AND date(created_at/1000, 'unixepoch', 'localtime') = ?
        `).get(guildId, userId, targetDate).count;
        
        let reportsClaimed = 0;
        try {
            reportsClaimed = db.prepare(`
                SELECT COUNT(*) as count FROM reports 
                WHERE guild_id = ? AND claimed_by = ? 
                AND date(claimed_at/1000, 'unixepoch', 'localtime') = ?
            `).get(guildId, userId, targetDate).count;
        } catch (err) {
            reportsClaimed = 0;
        }
        
        let reportsClosed = 0;
        try {
            reportsClosed = db.prepare(`
                SELECT COUNT(*) as count FROM reports 
                WHERE guild_id = ? AND closed_by = ? 
                AND date(closed_at/1000, 'unixepoch', 'localtime') = ?
            `).get(guildId, userId, targetDate).count;
        } catch (err) {
            reportsClosed = 0;
        }
        
        let avgResponseTime = null;
        try {
            const responseTimes = db.prepare(`
                SELECT (claimed_at - created_at) as response_time 
                FROM reports 
                WHERE guild_id = ? AND claimed_by = ? AND claimed_at IS NOT NULL 
                AND date(created_at/1000, 'unixepoch', 'localtime') = ?
            `).all(guildId, userId, targetDate);
            
            avgResponseTime = responseTimes.length > 0 
                ? Math.round(responseTimes.reduce((a, b) => a + b.response_time, 0) / responseTimes.length / 1000)
                : null;
        } catch (err) {
            avgResponseTime = null;
        }
        
        db.prepare(`
            INSERT INTO staff_analytics (
                guild_id, user_id, period, date, 
                punishments_applied, reports_claimed, reports_closed, 
                avg_response_time, updated_at
            ) VALUES (?, ?, 'day', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, user_id, period, date) 
            DO UPDATE SET
                punishments_applied = excluded.punishments_applied,
                reports_claimed = excluded.reports_claimed,
                reports_closed = excluded.reports_closed,
                avg_response_time = excluded.avg_response_time,
                updated_at = excluded.updated_at
        `).run(
            guildId, userId, targetDate,
            punishmentsApplied, reportsClaimed, reportsClosed,
            avgResponseTime, Date.now()
        );
        
        return {
            date: targetDate,
            punishmentsApplied,
            reportsClaimed,
            reportsClosed,
            avgResponseTime
        };
    }
    
    static async getStaffReport(guildId, userId, period = 'week') {
        const periods = { day: 1, week: 7, month: 30 };
        const days = periods[period] || 7;
        
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = this.getLocalDate(startDate);
        
        const data = db.prepare(`
            SELECT * FROM staff_analytics 
            WHERE guild_id = ? AND user_id = ? AND date >= ?
            ORDER BY date DESC
        `).all(guildId, userId, startDateStr);
        
        const totals = {
            punishmentsApplied: 0,
            reportsClaimed: 0,
            reportsClosed: 0,
            avgResponseTime: 0,
            daysWithData: 0
        };
        
        for (const day of data) {
            totals.punishmentsApplied += day.punishments_applied;
            totals.reportsClaimed += day.reports_claimed;
            totals.reportsClosed += day.reports_closed;
            if (day.avg_response_time !== null) {
                totals.avgResponseTime += day.avg_response_time;
                totals.daysWithData++;
            }
        }
        
        totals.avgResponseTime = totals.daysWithData > 0 
            ? Math.round(totals.avgResponseTime / totals.daysWithData)
            : null;
        
        return {
            period,
            days: data.length,
            totals,
            daily: data
        };
    }
    
    static async getStaffRanking(guildId, metric = 'punishments_applied', period = 'week', limit = 10) {
        const validMetrics = ['punishments_applied', 'reports_claimed', 'reports_closed'];
        if (!validMetrics.includes(metric)) {
            throw new Error(`Métrica inválida: ${metric}`);
        }
        
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (period === 'week' ? 7 : 30));
        const startDateStr = this.getLocalDate(startDate);
        
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
    
    static async generateStaffReportContainer(guildId, userId, guildName, period = 'week') {
        const report = await this.getStaffReport(guildId, userId, period);
        
        const avgResponseText = report.totals.avgResponseTime !== null 
            ? `${report.totals.avgResponseTime}s` 
            : 'Sem dados';
        
        const builder = ContainerFormatter.create(guildName, 0xDCA15E);
        builder.addTitle(`${EMOJIS.Rank || '📊'} Relatório de Staff`, 1);
        builder.addSeparator();
        builder.addText(`**Staff:** <@${userId}>`);
        builder.addText(`**Período:** ${period === 'week' ? '7 dias' : '30 dias'}`);
        builder.addSeparator();
        builder.addText(`${EMOJIS.strike || '⚠️'} **Punições:** ${report.totals.punishmentsApplied}`);
        builder.addText(`${EMOJIS.chat || '🎫'} **Reports Assumidos:** ${report.totals.reportsClaimed}`);
        builder.addText(`${EMOJIS.Check || '✅'} **Reports Fechados:** ${report.totals.reportsClosed}`);
        builder.addText(`⏱️ **Tempo Médio:** ${avgResponseText}`);
        builder.addFooter(`${report.days} dias analisados`);
        
        return builder;
    }
    
    static async generateRankingContainer(guildId, guildName, metric = 'punishments_applied', period = 'week', limit = 10) {
        const ranking = await this.getStaffRanking(guildId, metric, period, limit);
        
        const metricLabels = {
            punishments_applied: `${EMOJIS.strike || '⚠️'} Punições`,
            reports_claimed: `${EMOJIS.chat || '🎫'} Reports Assumidos`,
            reports_closed: `${EMOJIS.Check || '✅'} Reports Fechados`
        };
        
        const builder = ContainerFormatter.create(guildName, 0xDCA15E);
        builder.addTitle(`${EMOJIS.Leadboard || '🏆'} Ranking de Staff`, 1);
        builder.addSeparator();
        builder.addText(`**Período:** ${period === 'week' ? '7 dias' : '30 dias'}`);
        builder.addText(`**Métrica:** ${metricLabels[metric] || metric}`);
        builder.addSeparator();
        
        for (let index = 0; index < ranking.length; index++) {
            const item = ranking[index];
            const medal = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : `${index + 1}º`));
            builder.addText(`**${medal}** <@${item.user_id}>: \`${item.total}\``);
        }
        
        builder.addFooter(`Top ${limit} staff • ${new Date().toLocaleDateString('pt-BR')}`);
        
        return builder;
    }
}

module.exports = AnalyticsSystem;