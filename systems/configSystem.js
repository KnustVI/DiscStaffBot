const db = require('../database/database');

const ConfigSystem = {
    // Busca todas as configs de uma vez (economiza I/O)
    getGuildSettings(guildId) {
        const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
        return Object.fromEntries(rows.map(r => [r.key, r.value]));
    },

    // Salva uma config específica
    updateSetting(guildId, key, value) {
        return db.prepare(`
            INSERT INTO settings (guild_id, key, value) 
            VALUES (?, ?, ?) 
            ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
        `).run(guildId, key, value);
    },

    // Reset total
    resetSettings(guildId) {
        return db.prepare(`DELETE FROM settings WHERE guild_id = ?`).run(guildId);
    }
};

module.exports = ConfigSystem;