const db = require('../database');
const ErrorLogger = require('./errorLogger');

function getSettings(guildId) {
    try {
        const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
        
        if (!rows || rows.length === 0) return {};

        const settingsObj = {};
        for (const row of rows) {
            settingsObj[row.key] = row.value;
        }

        return settingsObj;
    } catch (err) {
        ErrorLogger.log('System_GetSettings_All', err);
        return {}; 
    }
}

module.exports = { getSettings };