const db = require('../database/database');
const ConfigSystem = require('.configSystem');

const PunishmentSystem = {
    async executePunishment(guild, targetMember, moderatorId, severity, reason, ticketId) {
        const gId = guild.id;
        const now = Date.now();

        // 1. BUSCA MÉTRICAS VIA CACHE (Se não existir, usa defaults)
        const defaults = this.getDefaults(severity);
        const metrics = {
            action: ConfigSystem.getSetting(gId, `punish_${severity}_action`) || defaults.action,
            time: parseInt(ConfigSystem.getSetting(gId, `punish_${severity}_time`)) || defaults.time,
            rep: parseInt(ConfigSystem.getSetting(gId, `punish_${severity}_rep`)) || defaults.rep
        };

        // 2. EXECUÇÃO NO DISCORD (Omitido aqui por brevidade, mantém sua lógica de timeout/ban/kick)
        // ... (seu código de execução do discord aqui) ...

        // 3. PERSISTÊNCIA ATÔMICA
        db.transaction(() => {
            db.prepare(`INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, ticket_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(gId, targetMember.id, moderatorId, reason, severity, ticketId || 'N/A', now);
            db.prepare(`INSERT INTO users (user_id, guild_id, reputation, penalties, last_penalty) VALUES (?, ?, 100 - ?, 1, ?) ON CONFLICT(user_id, guild_id) DO UPDATE SET reputation = MAX(0, reputation - ?), penalties = penalties + 1, last_penalty = ?`).run(targetMember.id, gId, metrics.rep, now, metrics.rep, now);
        })();

        return { punishmentId: "OK", currentRep: "??", detail: "Sucesso" }; // Simplificado
    },

    // ... ( getUserHistory e revertPunishment continuam bons como estão ) ...
};

module.exports = PunishmentSystem;