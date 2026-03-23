const db = require('../../database/database');
const cache = new Map();

const ConfigCache = {
    async loadAll() {
        const rows = db.prepare(`SELECT guild_id, key, value FROM settings`).all();
        cache.clear();
        for (const row of rows) {
            cache.set(`${row.guild_id}_${row.key}`, row.value);
        }
        console.log(`🧠 [Cache] ${cache.size} configurações carregadas na RAM.`);
    },

    get(guildId, key) {
        return cache.get(`${guildId}_${key}`);
    },

    set(guildId, key, value) {
        // O cache deve apenas guardar na RAM. Quem salva no banco é o ConfigSystem.
        cache.set(`${guildId}_${key}`, value);
    },

    // NOVO: Limpa todas as chaves de uma guilda específica
    deleteGuild(guildId) {
        for (const key of cache.keys()) {
            if (key.startsWith(`${guildId}_`)) cache.delete(key);
        }
    }
};

module.exports = ConfigCache;