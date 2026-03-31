const db = require('../database/index');

/**
 * Cache em memória para evitar queries repetitivas ao SQLite.
 * Chave: {guildId}_{key}
 */
const cache = new Map();

const ConfigSystem = {
    /**
     * Busca uma configuração. 
     * Prioriza Cache -> Fallback para DB -> Default null.
     */
    getSetting(guildId, key) {
        const cacheKey = `${guildId}_${key}`;
        if (cache.has(cacheKey)) return cache.get(cacheKey);

        const row = db.prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?').get(guildId, key);
        const val = row ? row.value : null;
        
        cache.set(cacheKey, val);
        return val;
    },

    /**
     * Salva ou Atualiza uma configuração.
     * Atualiza DB (Atomic) e Cache simultaneamente.
     */
    setSetting(guildId, key, value) {
        // Garantimos que o valor seja sempre string no banco para evitar conflitos de tipo
        const finalValue = value?.toString() || null;

        db.prepare(`
            INSERT INTO settings (guild_id, key, value) 
            VALUES (?, ?, ?)
            ON CONFLICT(guild_id, key) 
            DO UPDATE SET value = excluded.value
        `).run(guildId, key, finalValue);

        cache.set(`${guildId}_${key}`, finalValue);
    },

    /**
     * Busca um conjunto de configurações de uma vez (Performance para embeds).
     */
    getMany(guildId, keys = []) {
        const result = {};
        for (const key of keys) {
            result[key] = this.getSetting(guildId, key);
        }
        return result;
    },

    /**
     * Remove o cache de um servidor específico.
     * Útil para reset de banco ou quando o bot sai de um servidor.
     */
    clearCache(guildId) {
        for (const key of cache.keys()) {
            if (key.startsWith(`${guildId}_`)) {
                cache.delete(key);
            }
        }
    },

    /**
     * Helper para padronização visual das Embeds.
     */
    getFooter(guildName) {
        return { 
            text: `Sistema Robin • ${guildName}`, 
            iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' // Ícone padrão do sistema
        };
    }
};

module.exports = ConfigSystem;