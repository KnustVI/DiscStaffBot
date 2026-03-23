const db = require('../database/database');
const ConfigCache = require('./configCache');
const ErrorLogger = require('./errorLogger');

/**
 * Sistema de Configuração Centralizado
 * Responsável pela persistência (SQLite) e performance (Cache)
 */
const ConfigSystem = {
    
    /**
     * Busca uma configuração.
     * @param {string} guildId - ID do servidor.
     * @param {string} key - Chave da config (ex: 'staff_role', 'logs_channel').
     * @returns {string|null} - O valor salvo ou null se não existir.
     */
    getSetting(guildId, key) {
        try {
            // 1. Tenta buscar na RAM primeiro (Velocidade máxima)
            let value = ConfigCache.get(guildId, key);
            
            // 2. Se não estiver no Cache (undefined), busca no Banco de Dados
            if (value === undefined) { 
                const row = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, key);
                
                // Se existir no banco, pega o valor. Se não, define como null.
                value = row ? row.value : null;
                
                // 3. Alimenta o Cache para que a próxima consulta não precise ir ao disco
                ConfigCache.set(guildId, key, value);
            }
            
            return value;
        } catch (err) {
            // Se o banco falhar na leitura (ex: tabela corrompida)
            ErrorLogger.log('ConfigSystem_Get', err);
            return null;
        }
    },

    /**
     * Salva ou Atualiza uma configuração.
     * @param {string} guildId - ID do servidor.
     * @param {string} key - Nome da configuração.
     * @param {string} value - Valor a ser salvo (ID de cargo/canal).
     */
    updateSetting(guildId, key, value) {
        try {
            // Executa o UPSERT (Insert or Update) com exatamente 3 parâmetros.
            db.prepare(`
                INSERT INTO settings (guild_id, key, value) 
                VALUES (?, ?, ?) 
                ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
            `).run(guildId, key, value);
            
            // Atualiza a RAM imediatamente
            ConfigCache.set(guildId, key, value);
            
            return true;
        } catch (err) {
            // Se o banco falhar na escrita
            ErrorLogger.log('ConfigSystem_Update', err);
            throw err; // Lançamos o erro para o comando avisar o usuário
        }
    },

    /**
     * Remove todas as configurações de um servidor.
     */
    resetSettings(guildId) {
        try {
            db.prepare(`DELETE FROM settings WHERE guild_id = ?`).run(guildId);
            
            // Limpa o Cache da guilda específica
            if (ConfigCache.deleteGuild) {
                ConfigCache.deleteGuild(guildId); 
            }
            
            return true;
        } catch (err) {
            ErrorLogger.log('ConfigSystem_Reset', err);
            return false;
        }
    }
};

module.exports = ConfigSystem;