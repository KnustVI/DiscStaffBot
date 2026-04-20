/**
 * SessionManager - Gerencia sessões com isolamento total
 * 
 * Formato da chave: ${userId}_${guildId}_${system}_${action}
 * 
 * SIMPLES, DIRETA, FUNCIONAL
 */

class SessionManager {
    constructor(options = {}) {
        this.sessions = new Map();
        this.defaultTTL = options.defaultTTL || 300000; // 5 minutos
        this.logger = options.logger || console;
        
        // Cleanup a cada 5 minutos
        setInterval(() => this._cleanup(), 5 * 60 * 1000);
    }

    _cleanup() {
        const now = Date.now();
        let removed = 0;
        
        for (const [key, session] of this.sessions) {
            if (session.expires <= now) {
                this.sessions.delete(key);
                removed++;
            }
        }
        
        if (removed > 0) {
            this.logger.log(`[SessionManager] 🧹 Cleanup: ${removed} expiradas`);
        }
    }

    _generateKey(userId, guildId, system, action) {
        // Aceita guildId null/undefined e converte para 'dm'
        const safeGuildId = guildId || 'dm';
        if (!userId || !system || !action) {
            throw new Error(`Parâmetros obrigatórios: userId=${userId}, system=${system}, action=${action}`);
        }
        return `${userId}_${safeGuildId}_${system}_${action}`;
    }

    _deepCopy(data) {
        if (data === null || typeof data !== 'object') return data;
        if (Array.isArray(data)) return data.map(item => this._deepCopy(item));
        
        // Objetos simples
        const copy = {};
        for (const [key, value] of Object.entries(data)) {
            copy[key] = this._deepCopy(value);
        }
        return copy;
    }

    /**
     * Cria ou atualiza uma sessão
     */
    set(userId, guildId, system, action, data, ttl = this.defaultTTL) {
        const key = this._generateKey(userId, guildId, system, action);
        
        const session = {
            data: this._deepCopy(data),
            expires: Date.now() + ttl,
            metadata: { userId, guildId: guildId || 'dm', system, action, createdAt: Date.now() }
        };
        
        this.sessions.set(key, session);
        return key;
    }

    /**
     * Obtém uma sessão
     */
    get(userId, guildId, system, action) {
        const key = this._generateKey(userId, guildId, system, action);
        const session = this.sessions.get(key);
        
        if (!session) return null;
        if (session.expires <= Date.now()) {
            this.sessions.delete(key);
            return null;
        }
        
        return this._deepCopy(session.data);
    }

    /**
     * Obtém sessão completa (com metadados)
     */
    getFull(userId, guildId, system, action) {
        const key = this._generateKey(userId, guildId, system, action);
        const session = this.sessions.get(key);
        
        if (!session) return null;
        if (session.expires <= Date.now()) {
            this.sessions.delete(key);
            return null;
        }
        
        return {
            data: this._deepCopy(session.data),
            expires: session.expires,
            metadata: this._deepCopy(session.metadata)
        };
    }

    /**
     * Atualiza dados de uma sessão
     */
    update(userId, guildId, system, action, newData) {
        const key = this._generateKey(userId, guildId, system, action);
        const session = this.sessions.get(key);
        
        if (!session || session.expires <= Date.now()) {
            if (session) this.sessions.delete(key);
            return false;
        }
        
        session.data = { ...session.data, ...this._deepCopy(newData) };
        this.sessions.set(key, session);
        return true;
    }

    /**
     * Remove uma sessão
     */
    delete(userId, guildId, system, action) {
        const key = this._generateKey(userId, guildId, system, action);
        return this.sessions.delete(key);
    }

    /**
     * Remove todas sessões de um usuário em um servidor
     */
    deleteUserSessions(userId, guildId) {
        let removed = 0;
        const safeGuildId = guildId || 'dm';
        
        for (const [key, session] of this.sessions) {
            if (session.metadata.userId === userId && session.metadata.guildId === safeGuildId) {
                this.sessions.delete(key);
                removed++;
            }
        }
        
        return removed;
    }

    /**
     * Estatísticas básicas
     */
    getStats() {
        const now = Date.now();
        let active = 0;
        
        for (const session of this.sessions.values()) {
            if (session.expires > now) active++;
        }
        
        return {
            total: this.sessions.size,
            active,
            expired: this.sessions.size - active
        };
    }
}

// Singleton simples
const sessionManager = new SessionManager();
module.exports = sessionManager;