const db = require('../database/database');
const ErrorLogger = require('./errorLogger');

// Estrutura:
// Map<guildId, Map<key, value>>
const cache = new Map();

const ConfigCache = {

    // =========================
    // LOAD ALL (BOOT)
    // =========================
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

            console.log(`🧠 [Cache] ${rows.length} configurações carregadas na RAM.`);

        } catch (err) {
            ErrorLogger.log('ConfigCache_LoadAll', err);
            console.error("❌ Falha crítica ao carregar cache.");
        }
    },

    // =========================
    // GET
    // =========================
    get(guildId, key) {
        const guildCache = cache.get(guildId);
        if (!guildCache) return undefined;

        return guildCache.get(key);
    },

    // =========================
    // SET
    // =========================
    set(guildId, key, value) {
        if (!cache.has(guildId)) {
            cache.set(guildId, new Map());
        }

        cache.get(guildId).set(key, value);
    },

    // =========================
    // HAS (debug / controle)
    // =========================
    has(guildId, key) {
        return cache.get(guildId)?.has(key) || false;
    },

    // =========================
    // DELETE GUILD (OTIMIZADO)
    // =========================
    deleteGuild(guildId) {
        try {
            cache.delete(guildId);
        } catch (err) {
            ErrorLogger.log('ConfigCache_DeleteGuild', err);
        }
    }
};

module.exports = ConfigCache;