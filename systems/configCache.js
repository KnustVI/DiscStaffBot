const db = require('../database/database');
const ErrorLogger = require('./errorLogger');

// Estrutura: Map<guildId, Map<key, value>>
const cache = new Map();

const ConfigCache = {
    /**
     * Carrega todas as configurações do banco para a RAM no boot do bot
     */
    async loadAll() {
        try {
            const rows = db.prepare(`SELECT guild_id, key, value FROM settings`).all();
            cache.clear();

            for (const row of rows) {
                if (!cache.has(row.guild_id)) {
                    cache.set(row.guild_id, new Map());
                }
                cache.get(row.guild_id).set(row.key, row.value);
            }

            console.log(`🧠 [Cache] ${rows.length} configurações carregadas com sucesso.`);
        } catch (err) {
            ErrorLogger.log('ConfigCache_LoadAll', err);
            console.error("❌ Falha crítica ao carregar cache de configurações.");
        }
    },

    get(guildId, key) {
        return cache.get(guildId)?.get(key);
    },

    set(guildId, key, value) {
        if (!cache.has(guildId)) {
            cache.set(guildId, new Map());
        }
        cache.get(guildId).set(key, value);
    },

    deleteGuild(guildId) {
        cache.delete(guildId);
    }
};

module.exports = ConfigCache;