const db = require('../database/database');
const ConfigCache = require('./configCache');
const ErrorLogger = require('./errorLogger');

/**
 * Busca todas as configurações de uma guilda.
 * Prioriza o Cache, mas serve como fallback para o Banco.
 */
function getSettings(guildId) {
    try {
        // 1. Tenta buscar no Banco de Dados para garantir que temos tudo atualizado
        const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
        
        // Se não houver nada no banco para essa guilda, retorna objeto vazio
        if (!rows || rows.length === 0) return {};

        // 2. Transforma em objeto { key: value }
        const settingsObj = Object.fromEntries(rows.map(r => [r.key, r.value]));

        // 3. (Opcional) Sincroniza o Cache se ele estiver vazio para essa guilda
        // Isso garante que o bot "aprenda" as configs se o cache falhar no boot
        for (const [key, value] of Object.entries(settingsObj)) {
            if (ConfigCache.get(guildId, key) === undefined) {
                ConfigCache.set(guildId, key, value);
            }
        }

        return settingsObj;

    } catch (err) {
        // Log de Sistema (Arquivo) para o Vick
        ErrorLogger.log('System_GetSettings_All', err);
        return {}; // Retorna vazio em caso de erro para não quebrar o comando
    }
}

module.exports = { getSettings };