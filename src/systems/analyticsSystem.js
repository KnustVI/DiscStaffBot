// src/systems/analyticsSystem.js
const db = require('../database/index');
const { EmbedBuilder } = require('discord.js');

// Carregar emojis do servidor
let EMOJIS = {};
try {
    const emojisFile = require('../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

class AnalyticsSystem {
    
    // Função auxiliar para data local
    static getLocalDate(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    
    static async updateStaffAnalytics(guildId, userId, date = null) {
        const targetDate = date || this.getLocalDate();
        
        // Punições aplicadas
        const punishmentsApplied = db.prepare(`
            SELECT COUNT(*) as count FROM punishments 
            WHERE guild_id = ? AND moderator_id = ? 
            AND date(created_at/1000, 'unixepoch', 'localtime') = ?
        `).get(guildId, userId, targetDate).count;
        
        // Tickets assumidos (verificar se a coluna existe)
        let ticketsClaimed = 0;
        try {
            ticketsClaimed = db.prepare(`
                SELECT COUNT(*) as count FROM tickets 
                WHERE guild_id = ? AND claimed_by = ? 
                AND date(claimed_at/1000, 'unixepoch', 'localtime') = ?
            `).get(guildId, userId, targetDate).count;
        } catch (err) {
            // Coluna não existe ainda
            ticketsClaimed = 0;
        }
        
        // Tickets fechados
        let ticketsClosed = 0;
        try {
            ticketsClosed = db.prepare(`
                SELECT COUNT(*) as count FROM tickets 
                WHERE guild_id = ? AND closed_by = ? 
                AND date(closed_at/1000, 'unixepoch', 'localtime') = ?
            `).get(guildId, userId, targetDate).count;
        } catch (err) {
            ticketsClosed = 0;
        }
        
        // Tempo médio de resposta
        let avgResponseTime = null;
        try {
            const responseTimes = db.prepare(`
                SELECT (claimed_at - created_at) as response_time 
                FROM tickets 
                WHERE guild_id = ? AND claimed_by = ? AND claimed_at IS NOT NULL 
                AND date(created_at/1000, 'unixepoch', 'localtime') = ?
            `).all(guildId, userId, targetDate);
            
            avgResponseTime = responseTimes.length > 0 
                ? Math.round(responseTimes.reduce((a, b) => a + b.response_time, 0) / responseTimes.length / 1000)
                : null;
        } catch (err) {
            avgResponseTime = null;
        }
        
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
            avgResponseTime, Date.now()
        );
        
        return {
            date: targetDate,
            punishmentsApplied,
            ticketsClaimed,
            ticketsClosed,
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
            ticketsClaimed: 0,
            ticketsClosed: 0,
            avgResponseTime: 0,
            daysWithData: 0
        };
        
        for (const day of data) {
            totals.punishmentsApplied += day.punishments_applied;
            totals.ticketsClaimed += day.tickets_claimed;
            totals.ticketsClosed += day.tickets_closed;
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
        const validMetrics = ['punishments_applied', 'tickets_claimed', 'tickets_closed'];
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
    
    static async generateStaffReportEmbed(guildId, userId, period = 'week') {
        const report = await this.getStaffReport(guildId, userId, period);
        
        const avgResponseText = report.totals.avgResponseTime !== null 
            ? `${report.totals.avgResponseTime}s` 
            : 'Sem dados';
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(`# ${EMOJIS.Rank || '📊'} Relatório de Staff\n**Staff:** <@${userId}>\n**Período:** ${period === 'week' ? '7 dias' : '30 dias'}\n\n${EMOJIS.strike || '⚠️'} **Punições:** ${report.totals.punishmentsApplied}\n${EMOJIS.Ticket || '🎫'} **Tickets Assumidos:** ${report.totals.ticketsClaimed}\n${EMOJIS.Check || '✅'} **Tickets Fechados:** ${report.totals.ticketsClosed}\n⏱️ **Tempo Médio:** ${avgResponseText}`)
            .setFooter({ text: `${report.days} dias analisados` })
            .setTimestamp();
        
        return embed;
    }
    
    static async generateRankingEmbed(guildId, metric = 'punishments_applied', period = 'week', limit = 10) {
        const ranking = await this.getStaffRanking(guildId, metric, period, limit);
        
        const metricLabels = {
            punishments_applied: `${EMOJIS.strike || '⚠️'} Punições`,
            tickets_claimed: `${EMOJIS.Ticket || '🎫'} Tickets Assumidos`,
            tickets_closed: `${EMOJIS.Check || '✅'} Tickets Fechados`
        };
        
        const description = [
            `# ${EMOJIS.Leadboard || '🏆'} Ranking de Staff`,
            `**Período:** ${period === 'week' ? '7 dias' : '30 dias'}`,
            `**Métrica:** ${metricLabels[metric] || metric}`,
            ``,
            ...ranking.map((item, index) => {
                const medal = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : `${index + 1}º`));
                return `**${medal}** <@${item.user_id}>: \`${item.total}\``;
            })
        ].join('\n');
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(description)
            .setFooter({ text: `Top ${limit} staff • ${new Date().toLocaleDateString('pt-BR')}` })
            .setTimestamp();
        
        return embed;
    }
}

module.exports = AnalyticsSystem;