const db = require('../database/database');
const ConfigCache = require('./configCache');

/**
 * Sistema de Configuração Otimizado
 * Gerencia o Banco de Dados (SQLite) e a RAM (Cache)
 */
const ConfigSystem = {
    
    /**
     * Busca uma configuração. 
     * Prioridade: Cache (RAM) -> Banco de Dados -> Null
     */
    getSetting(guildId, key) {
        // Tenta pegar da RAM primeiro (mais rápido)
        let value = ConfigCache.get(guildId, key);
        
        // Se for undefined, significa que não está no Cache
        if (value === undefined) { 
            const row = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, key);
            
            // Se não existe no banco, marcamos como null para evitar buscas repetitivas
            value = row ? row.value : null;
            
            // Alimenta o Cache para a próxima consulta
            ConfigCache.set(guildId, key, value);
        }
        
        return value;
    },

    /**
     * Salva ou Atualiza uma configuração
     * O 'excluded.value' no SQL usa o terceiro parâmetro fornecido no .run()
     */
    updateSetting(guildId, key, value) {
        // Executa o SQL com exatamente 3 parâmetros (guild_id, key, value)
        db.prepare(`
            INSERT INTO settings (guild_id, key, value) 
            VALUES (?, ?, ?) 
            ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
        `).run(guildId, key, value);
        
        // Atualiza a RAM imediatamente para o bot refletir a mudança na hora
        ConfigCache.set(guildId, key, value);
        
        return true;
    },

    /**
     * Limpa as configurações de um servidor específico
     */
    resetSettings(guildId) {
        db.prepare(`DELETE FROM settings WHERE guild_id = ?`).run(guildId);
        
        // Limpa a RAM para esta guilda
        if (ConfigCache.deleteGuild) {
            ConfigCache.deleteGuild(guildId); 
        }
        
        return true;
    }
};

module.exports = ConfigSystem;