const db = require('../database/database');

/**
 * Busca todas as configurações de uma guilda e retorna como objeto
 */
function getSettings(guildId) {
    const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

module.exports = { getSettings };