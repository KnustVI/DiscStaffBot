const db = require('../database/database'); // Verifique se são dois ou um (..) dependendo da sua pasta
const ConfigCache = require('./configCache');

const ConfigSystem = {
    /**
     * Busca uma configuração. Tenta na RAM primeiro, se não achar, vai no Banco.
     */
    getSetting(guildId, key) {
        let value = ConfigCache.get(guildId, key);
        
        // Debug para você ver no console se o cache está funcionando
        // console.log(`[DEBUG] Buscando ${key} para ${guildId}. Cache: ${value}`); 

        if (value === undefined) { 
            const row = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, key);
            
            // Se não existe no banco, definimos como null para o cache não ficar tentando ler o banco toda hora
            value = row ? row.value : null;
            ConfigCache.set(guildId, key, value);
        }
        
        return value;
    },

    /**
     * Atualiza no Banco e na RAM simultaneamente
     */
    updateSetting(guildId, key, value) {
        db.prepare(`
            INSERT INTO settings (guild_id, key, value) 
            VALUES (?, ?, ?) 
            ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
        `).run(guildId, key, value, value); // Adicionado o quarto parâmetro para o UPDATE
        
        ConfigCache.set(guildId, key, value);
        return true;
    },

    /**
     * Limpa as configurações de uma guilda (DB e RAM)
     */
    resetSettings(guildId) {
        db.prepare(`DELETE FROM settings WHERE guild_id = ?`).run(guildId);
        if (ConfigCache.deleteGuild) {
            ConfigCache.deleteGuild(guildId); 
        }
        return true;
    }
};

module.exports = ConfigSystem;