// /home/ubuntu/DiscStaffBot/src/utils/sessionManager.js
class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.maxSessionsPerUser = 5;
        this.defaultTTL = 300000; // 5 minutos
        this.cleanupInterval = 60000; // 1 minuto
        
        // Iniciar limpeza automática
        setInterval(() => this.cleanup(), this.cleanupInterval);
    }

    /**
     * Gera chave única para a sessão
     */
    _generateKey(userId, guildId, category, action) {
        return `${userId}:${guildId || 'dm'}:${category}:${action}`;
    }

    /**
     * Limita o número de sessões por usuário
     */
    _limitUserSessions(userId, guildId) {
        const userSessions = [];
        for (const [key, session] of this.sessions.entries()) {
            if (key.startsWith(`${userId}:${guildId || 'dm'}`)) {
                userSessions.push(key);
            }
        }
        
        while (userSessions.length >= this.maxSessionsPerUser) {
            const oldestKey = userSessions.shift();
            this.sessions.delete(oldestKey);
        }
    }

    /**
     * Cria ou atualiza uma sessão
     * @param {string} userId - ID do usuário
     * @param {string} guildId - ID do servidor (ou null para DM)
     * @param {string} category - Categoria da sessão (ex: 'strike', 'report')
     * @param {string} action - Ação específica (ex: 'pending', 'confirm')
     * @param {any} data - Dados da sessão
     * @param {number} ttl - Tempo de vida em milissegundos (padrão: 5min)
     */
    set(userId, guildId, category, action, data, ttl = this.defaultTTL) {
        const key = this._generateKey(userId, guildId, category, action);
        
        // Limitar sessões por usuário
        this._limitUserSessions(userId, guildId);
        
        // Remover sessão existente se houver
        if (this.sessions.has(key)) {
            clearTimeout(this.sessions.get(key).timeout);
        }
        
        // Criar timeout para auto-exclusão
        const timeout = setTimeout(() => {
            if (this.sessions.has(key)) {
                this.sessions.delete(key);
            }
        }, ttl);
        
        this.sessions.set(key, {
            data,
            expires: Date.now() + ttl,
            timeout,
            createdAt: Date.now(),
            userId,
            guildId,
            category,
            action
        });
        
        return true;
    }

    /**
     * Recupera dados de uma sessão
     * @returns {any|null} Dados da sessão ou null se expirada/inexistente
     */
    get(userId, guildId, category, action) {
        const key = this._generateKey(userId, guildId, category, action);
        const session = this.sessions.get(key);
        
        if (!session) return null;
        
        // Verificar expiração
        if (Date.now() > session.expires) {
            this.sessions.delete(key);
            return null;
        }
        
        return session.data;
    }

    /**
     * Verifica se uma sessão existe e não expirou
     */
    has(userId, guildId, category, action) {
        const key = this._generateKey(userId, guildId, category, action);
        const session = this.sessions.get(key);
        
        if (!session) return false;
        if (Date.now() > session.expires) {
            this.sessions.delete(key);
            return false;
        }
        
        return true;
    }

    /**
     * Remove uma sessão específica
     */
    delete(userId, guildId, category, action) {
        const key = this._generateKey(userId, guildId, category, action);
        const session = this.sessions.get(key);
        
        if (session && session.timeout) {
            clearTimeout(session.timeout);
        }
        
        return this.sessions.delete(key);
    }

    /**
     * Remove todas sessões de um usuário em um servidor
     */
    clear(userId, guildId) {
        const prefix = `${userId}:${guildId || 'dm'}`;
        let count = 0;
        
        for (const [key, session] of this.sessions.entries()) {
            if (key.startsWith(prefix)) {
                if (session.timeout) clearTimeout(session.timeout);
                this.sessions.delete(key);
                count++;
            }
        }
        
        return count;
    }

    /**
     * Remove todas sessões expiradas
     */
    cleanup() {
        const now = Date.now();
        let removed = 0;
        
        for (const [key, session] of this.sessions.entries()) {
            if (now > session.expires) {
                if (session.timeout) clearTimeout(session.timeout);
                this.sessions.delete(key);
                removed++;
            }
        }
        
        if (removed > 0) {
            // console.log(`🧹 [SessionManager] ${removed} sessões expiradas removidas`);
        }
    }

    /**
     * Remove todas sessões do sistema
     */
    clearAll() {
        for (const [key, session] of this.sessions.entries()) {
            if (session.timeout) clearTimeout(session.timeout);
        }
        this.sessions.clear();
    }

    /**
     * Retorna estatísticas das sessões
     */
    getStats() {
        const stats = {
            total: this.sessions.size,
            byCategory: {},
            byUser: {},
            oldest: null,
            newest: null
        };
        
        let oldestTime = Date.now();
        let newestTime = 0;
        
        for (const [key, session] of this.sessions.entries()) {
            // Por categoria
            const cat = `${session.category}:${session.action}`;
            stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
            
            // Por usuário
            stats.byUser[session.userId] = (stats.byUser[session.userId] || 0) + 1;
            
            // Idade
            if (session.createdAt < oldestTime) {
                oldestTime = session.createdAt;
                stats.oldest = {
                    key,
                    age: Math.round((Date.now() - session.createdAt) / 1000)
                };
            }
            if (session.createdAt > newestTime) {
                newestTime = session.createdAt;
                stats.newest = {
                    key,
                    age: Math.round((Date.now() - session.createdAt) / 1000)
                };
            }
        }
        
        return stats;
    }
}

module.exports = new SessionManager();