const db = require('../../database/database');
const ConfigCache = require('./configCache');

const ConfigSystem = {
    getSetting(guildId, key) {
        let value = ConfigCache.get(guildId, key);
        if (value === undefined) { // Se não estiver no cache (pode ser null/0, então checamos undefined)
            const row = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, key);
            value = row ? row.value : null;
            ConfigCache.set(guildId, key, value);
        }
        return value;
    },

    updateSetting(guildId, key, value) {
        db.prepare(`
            INSERT INTO settings (guild_id, key, value) 
            VALUES (?, ?, ?) 
            ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
        `).run(guildId, key, value);
        
        ConfigCache.set(guildId, key, value);
        return true;
    },

    resetSettings(guildId) {
        db.prepare(`DELETE FROM settings WHERE guild_id = ?`).run(guildId);
        ConfigCache.deleteGuild(guildId); // Limpa a RAM
        return true;
    }
};

module.exports = ConfigSystem;