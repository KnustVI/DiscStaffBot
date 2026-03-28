const db = require('../../database/database');
const ErrorLogger = require('../errorLogger');

/**
 * BUSCA DE CONFIGURAÇÕES (BACKEND)
 * Este arquivo fala DIRETAMENTE com o SQLite.
 * Deve ser usado principalmente pelo ConfigCache durante o "boot" ou "refresh".
 */
function getSettings(guildId) {
    try {
        // 1. Busca todas as chaves e valores do servidor no Banco
        const rows = db.prepare(`
            SELECT key, value 
            FROM settings 
            WHERE guild_id = ?
        `).all(guildId);
        
        // 2. Se o servidor for novo e não tiver nada, retorna objeto vazio
        if (!rows || rows.length === 0) return {};

        // 3. Transforma as linhas do SQL em um objeto JavaScript puro
        // Ex: [{key: 'prefix', value: '!'}] -> { prefix: '!' }
        const settingsObj = {};
        for (const row of rows) {
            settingsObj[row.key] = row.value;
        }

        return settingsObj;

    } catch (err) {
        // Se o banco de dados travar ou o arquivo sumir, logamos o erro crítico
        console.error(`❌ Erro ao ler configurações da guilda ${guildId}:`, err);
        ErrorLogger.log('System_GetSettings_All', err);
        return {}; 
    }
}

module.exports = { getSettings };