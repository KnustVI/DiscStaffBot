// src/integrations/pathoftitans/tokenManager.js
const crypto = require('crypto');
const db = require('../../database/index');

class PoTTokenManager {
    
    static generateToken(guildId) {
        // Token curto e amigável para colocar no Game.ini
        const random = crypto.randomBytes(16).toString('hex');
        const timestamp = Date.now().toString(36);
        const token = `${random.substring(0, 24)}_${timestamp}`;
        
        const stmt = db.prepare(`
            INSERT INTO pot_tokens (guild_id, token, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                token = excluded.token,
                updated_at = excluded.updated_at
        `);
        stmt.run(guildId, token, Date.now(), Date.now());
        
        return token;
    }
    
    static validateToken(token) {
        const stmt = db.prepare(`SELECT guild_id, created_at FROM pot_tokens WHERE token = ?`);
        const result = stmt.get(token);
        
        if (result) {
            db.prepare(`UPDATE pot_tokens SET last_used = ?, usage_count = usage_count + 1 WHERE token = ?`)
                .run(Date.now(), token);
            return result.guild_id;
        }
        return null;
    }
    
    static getToken(guildId) {
        const stmt = db.prepare(`SELECT token FROM pot_tokens WHERE guild_id = ?`);
        const result = stmt.get(guildId);
        return result ? result.token : null;
    }
    
    static revokeToken(guildId) {
        const stmt = db.prepare(`DELETE FROM pot_tokens WHERE guild_id = ?`);
        stmt.run(guildId);
    }
    
    static getTokenStats(guildId) {
        const stmt = db.prepare(`SELECT created_at, last_used, usage_count FROM pot_tokens WHERE guild_id = ?`);
        const result = stmt.get(guildId);
        return result || { created_at: null, last_used: null, usage_count: 0 };
    }
}

module.exports = PoTTokenManager;