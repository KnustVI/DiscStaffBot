const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/index.js');
const emojisFile = require('../database/emojis.js');
const EMOJIS = emojisFile.EMOJIS || {};

const PunishmentSystem = {

    // --- FUNÇÕES DE BUSCA E BANCO ---

    async getUserHistory(guildId, userId, page = 1) {
        const limit = 5; // Punições por página
        const offset = (page - 1) * limit;

        // Busca reputação
        let rep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
        const points = rep ? rep.points : 100;

        // Busca total de punições para paginação
        const total = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
        const totalRecords = total.count;
        const totalPages = Math.ceil(totalRecords / limit);

        // Busca punições da página atual
        const punishments = db.prepare(`
            SELECT * FROM punishments 
            WHERE guild_id = ? AND user_id = ? 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `).all(guildId, userId, limit, offset);

        return {
            reputation: points,
            punishments,
            totalRecords,
            totalPages
        };
    },

    // --- GERADORES DE UI ---

    generateHistoryEmbed(target, history, page) {
        const embed = new EmbedBuilder()
            .setAuthor({ name: `Histórico de ${target.tag}`, iconURL: target.displayAvatarURL() })
            .setColor(history.reputation > 50 ? 0x00FF00 : (history.reputation > 20 ? 0xFFAA00 : 0xFF0000))
            .setDescription(`${EMOJIS.REP || '⭐'} **Reputação Atual:** \`${history.reputation}/100\``)
            .setThumbnail(target.displayAvatarURL())
            .setFooter({ text: `Página ${page} de ${history.totalPages} • Total: ${history.totalRecords} registros` });

        if (history.punishments.length === 0) {
            embed.addFields({ name: 'Registros', value: 'Nenhuma punição encontrada.' });
        } else {
            history.punishments.forEach(p => {
                const date = `<t:${Math.floor(p.created_at / 1000)}:d>`;
                const severityIcon = ['⚪', '🟢', '🟡', '🟠', '🔴', '💀'][p.severity] || '❓';
                embed.addFields({
                    name: `${severityIcon} Caso #${p.id} | ${date}`,
                    value: `**Motivo:** ${p.reason}\n**Moderador:** <@${p.moderator_id}>\n**Ticket:** \`${p.ticket_id || 'N/A'}\``
                });
            });
        }

        return embed;
    },

    generateHistoryButtons(targetId, currentPage, totalPages) {
        if (totalPages <= 1) return null;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`history_prev_${targetId}_${currentPage - 1}`)
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`history_next_${targetId}_${currentPage + 1}`)
                .setEmoji('➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === totalPages)
        );

        return row;
    },

    // --- MÉTODOS EXISTENTES (MANTIDOS) ---

    parseDuration(durationStr) {
        if (!durationStr || ['0', 'perm'].includes(durationStr.toLowerCase())) return 0;
        const timeValue = parseInt(durationStr);
        const type = durationStr.slice(-1).toLowerCase();
        const multipliers = { 'm': 60000, 'h': 3600000, 'd': 86400000 }; 
        return (multipliers[type] || 3600000) * timeValue;
    },

    applyPunishment(guildId, targetId, moderatorId, reason, severity, ticketId, points) {
        const trans = db.transaction(() => {
            const res = db.prepare(`
                INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, ticket_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(guildId, targetId, moderatorId, reason, severity, ticketId, Date.now());

            db.prepare(`
                INSERT INTO reputation (guild_id, user_id, points) VALUES (?, ?, 100)
                ON CONFLICT(guild_id, user_id) DO UPDATE SET points = MAX(0, points - ?)
            `).run(guildId, targetId, points);

            return res.lastInsertRowid;
        });
        return trans();
    },

    initWorker(client) {
        console.log('⚖️ [Worker] Sistema de Punições Ativo');
        setInterval(async () => {
            const now = Date.now();
            const expiredRoles = db.prepare(`SELECT * FROM temporary_roles WHERE expires_at <= ?`).all(now);
            for (const entry of expiredRoles) {
                const guild = client.guilds.cache.get(entry.guild_id);
                if (guild) {
                    guild.members.fetch(entry.user_id)
                        .then(m => m.roles.remove(entry.role_id, "Strike Expirado"))
                        .catch(() => null);
                }
                db.prepare(`DELETE FROM temporary_roles WHERE id = ?`).run(entry.id);
            }
        }, 30000);
    }
};

module.exports = PunishmentSystem;