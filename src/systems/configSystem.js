const db = require('../../database/index'); // Caminho pro seu SQLite

const cache = new Map();

const ConfigSystem = {
    // Busca uma config (Primeiro no Cache, se não tiver, vai no DB)
    getSetting(guildId, key) {
        const cacheKey = `${guildId}_${key}`;
        if (cache.has(cacheKey)) return cache.get(cacheKey);

        const row = db.prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?').get(guildId, key);
        const val = row ? row.value : null;
        
        cache.set(cacheKey, val);
        return val;
    },

    // Salva uma config (No DB e no Cache ao mesmo tempo)
    setSetting(guildId, key, value) {
        db.prepare(`
            INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?)
            ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
        `).run(guildId, key, value);

        cache.set(`${guildId}_${key}`, value);
    },

    // Limpa o cache de um servidor (Útil para o reset-db)
    clearCache(guildId) {
        for (const key of cache.keys()) {
            if (key.startsWith(`${guildId}_`)) cache.delete(key);
        }
    },

    getFooter(guildName) {
        return { text: `Sistema de Integridade • ${guildName}` };
    }
};

module.exports = ConfigSystem;