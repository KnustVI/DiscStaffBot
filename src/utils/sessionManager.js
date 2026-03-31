const sessions = new Map();

class SessionManager {
    /**
     * Cria uma sessão com contexto completo
     * @param {string} userId - ID do usuário
     * @param {string} guildId - ID do servidor
     * @param {string} action - Ação/contexto (ex: 'config', 'strike', 'ticket')
     * @param {any} data - Dados da sessão
     * @param {number} ttl - Tempo de vida em ms (padrão: 5 minutos)
     * @returns {string} Chave da sessão
     */
    static set(userId, guildId, action, data, ttl = 300000) {
        const key = `${userId}_${guildId}_${action}`;
        const session = {
            data,
            expires: Date.now() + ttl,
            userId,
            guildId,
            action
        };
        
        sessions.set(key, session);
        
        // Auto-limpeza após TTL
        setTimeout(() => {
            const current = sessions.get(key);
            if (current && current.expires <= Date.now()) {
                sessions.delete(key);
            }
        }, ttl);
        
        return key;
    }
    
    /**
     * Obtém uma sessão pelo contexto completo
     * @param {string} userId - ID do usuário
     * @param {string} guildId - ID do servidor
     * @param {string} action - Ação/contexto
     * @returns {any|null} Dados da sessão ou null
     */
    static get(userId, guildId, action) {
        const key = `${userId}_${guildId}_${action}`;
        const session = sessions.get(key);
        
        if (!session) return null;
        
        if (session.expires <= Date.now()) {
            sessions.delete(key);
            return null;
        }
        
        return session.data;
    }
    
    /**
     * Remove uma sessão específica
     */
    static delete(userId, guildId, action) {
        const key = `${userId}_${guildId}_${action}`;
        sessions.delete(key);
    }
    
    /**
     * Remove todas as sessões de um usuário
     */
    static clearUser(userId) {
        for (const [key] of sessions) {
            if (key.startsWith(`${userId}_`)) {
                sessions.delete(key);
            }
        }
    }
    
    /**
     * Remove todas as sessões de um servidor
     */
    static clearGuild(guildId) {
        for (const [key, session] of sessions) {
            if (session.guildId === guildId) {
                sessions.delete(key);
            }
        }
    }
    
    /**
     * Verifica se uma sessão existe
     */
    static exists(userId, guildId, action) {
        const key = `${userId}_${guildId}_${action}`;
        const session = sessions.get(key);
        return session && session.expires > Date.now();
    }
    
    /**
     * Atualiza os dados de uma sessão sem alterar o TTL
     */
    static update(userId, guildId, action, newData) {
        const key = `${userId}_${guildId}_${action}`;
        const session = sessions.get(key);
        
        if (session && session.expires > Date.now()) {
            session.data = { ...session.data, ...newData };
            sessions.set(key, session);
            return true;
        }
        
        return false;
    }
    
    /**
     * Extende o TTL de uma sessão
     */
    static extend(userId, guildId, action, additionalMs = 300000) {
        const key = `${userId}_${guildId}_${action}`;
        const session = sessions.get(key);
        
        if (session && session.expires > Date.now()) {
            session.expires += additionalMs;
            sessions.set(key, session);
            return true;
        }
        
        return false;
    }
    
    /**
     * Obtém estatísticas das sessões ativas
     */
    static getStats() {
        const now = Date.now();
        let active = 0;
        let expired = 0;
        
        for (const [key, session] of sessions) {
            if (session.expires > now) active++;
            else expired++;
        }
        
        return {
            total: sessions.size,
            active,
            expired,
            keys: Array.from(sessions.keys())
        };
    }
}

module.exports = SessionManager;