const db = require('../database/database');
const ErrorLogger = require('./errorLogger'); // <--- Importado para segurança
const cache = new Map();

/**
 * Sistema de Cache na RAM
 * Evita consultas excessivas ao disco (SQLite) na Oracle Cloud
 */
const ConfigCache = {
    /**
     * Carrega todas as configurações do banco para a RAM ao iniciar
     */
    async loadAll() {
        try {
            const rows = db.prepare(`SELECT guild_id, key, value FROM settings`).all();
            cache.clear();
            
            for (const row of rows) {
                cache.set(`${row.guild_id}_${row.key}`, row.value);
            }
            
            console.log(`🧠 [Cache] ${cache.size} configurações carregadas na RAM.`);
        } catch (err) {
            // Se o banco falhar no boot, o ErrorLogger registra o motivo exato
            ErrorLogger.log('ConfigCache_LoadAll', err);
            console.error("❌ Falha crítica ao carregar cache. Verifique os logs.");
        }
    },

    /**
     * Retorna um valor da RAM
     */
    get(guildId, key) {
        return cache.get(`${guildId}_${key}`);
    },

    /**
     * Atualiza um valor na RAM
     */
    set(guildId, key, value) {
        cache.set(`${guildId}_${key}`, value);
    },

    /**
     * Limpa todas as chaves de uma guilda específica (Útil para o resetSettings)
     */
    deleteGuild(guildId) {
        try {
            for (const key of cache.keys()) {
                if (key.startsWith(`${guildId}_`)) {
                    cache.delete(key);
                }
            }
        } catch (err) {
            ErrorLogger.log('ConfigCache_DeleteGuild', err);
        }
    }
};

module.exports = ConfigCache;