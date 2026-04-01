/**
 * Sistema de Sessão Avançado com Isolamento Total
 * 
 * Formato da chave: ${userId}_${guildId}_${system}_${action}
 * 
 * Exemplos:
 * - 123456_789012_config_setting
 * - 123456_789012_ticket_create
 * - 123456_789012_strike_confirm
 * 
 * Garante isolamento entre:
 * - Servidores diferentes (guildId)
 * - Sistemas diferentes (system)
 * - Ações diferentes (action)
 * - Usuários diferentes (userId)
 */

class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.defaultTTL = 300000; // 5 minutos
        this.cleanupInterval = null;
        
        // Iniciar limpeza automática a cada minuto
        this.startCleanup();
    }
    
    /**
     * Gera chave única para sessão com isolamento total
     */
    generateKey(userId, guildId, system, action) {
        if (!userId || !guildId || !system || !action) {
            throw new Error('userId, guildId, system e action são obrigatórios');
        }
        return `${userId}_${guildId}_${system}_${action}`;
    }
    
    /**
     * Cria ou atualiza uma sessão
     */
    set(userId, guildId, system, action, data, ttl = this.defaultTTL) {
        const key = this.generateKey(userId, guildId, system, action);
        const session = {
            data,
            expires: Date.now() + ttl,
            metadata: {
                userId,
                guildId,
                system,
                action,
                createdAt: Date.now()
            }
        };
        
        this.sessions.set(key, session);
        
        // Log de debug (opcional)
        // console.log(`📦 [Session] Criada: ${key} | TTL: ${ttl}ms`);
        
        return key;
    }
    
    /**
     * Obtém uma sessão
     */
    get(userId, guildId, system, action) {
        const key = this.generateKey(userId, guildId, system, action);
        const session = this.sessions.get(key);
        
        if (!session) return null;
        
        // Verificar expiração
        if (session.expires <= Date.now()) {
            this.sessions.delete(key);
            return null;
        }
        
        return session.data;
    }
    
    /**
     * Obtém sessão completa (com metadados)
     */
    getFull(userId, guildId, system, action) {
        const key = this.generateKey(userId, guildId, system, action);
        const session = this.sessions.get(key);
        
        if (!session) return null;
        if (session.expires <= Date.now()) {
            this.sessions.delete(key);
            return null;
        }
        
        return session;
    }
    
    /**
     * Atualiza dados de uma sessão existente
     */
    update(userId, guildId, system, action, newData) {
        const key = this.generateKey(userId, guildId, system, action);
        const session = this.sessions.get(key);
        
        if (!session || session.expires <= Date.now()) {
            return false;
        }
        
        session.data = { ...session.data, ...newData };
        this.sessions.set(key, session);
        
        return true;
    }
    
    /**
     * Remove uma sessão específica
     */
    delete(userId, guildId, system, action) {
        const key = this.generateKey(userId, guildId, system, action);
        return this.sessions.delete(key);
    }
    
    /**
     * Remove todas as sessões de um usuário em um servidor
     */
    deleteUserSessions(userId, guildId) {
        let count = 0;
        for (const [key, session] of this.sessions) {
            if (session.metadata.userId === userId && session.metadata.guildId === guildId) {
                this.sessions.delete(key);
                count++;
            }
        }
        return count;
    }
    
    /**
     * Remove todas as sessões expiradas
     */
    cleanup() {
        const now = Date.now();
        let removed = 0;
        
        for (const [key, session] of this.sessions) {
            if (session.expires <= now) {
                this.sessions.delete(key);
                removed++;
            }
        }
        
        if (removed > 0) {
            // console.log(`🧹 [Session] Limpeza: ${removed} sessões expiradas removidas`);
        }
        
        return removed;
    }
    
    /**
     * Inicia limpeza automática
     */
    startCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60000); // A cada minuto
    }
    
    /**
     * Para a limpeza automática
     */
    stopCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
    
    /**
     * Obtém estatísticas das sessões
     */
    getStats() {
        const now = Date.now();
        let active = 0;
        let expired = 0;
        
        for (const session of this.sessions.values()) {
            if (session.expires > now) active++;
            else expired++;
        }
        
        return {
            total: this.sessions.size,
            active,
            expired,
            bySystem: this.getStatsBySystem()
        };
    }
    
    /**
     * Estatísticas por sistema
     */
    getStatsBySystem() {
        const bySystem = {};
        for (const session of this.sessions.values()) {
            const system = session.metadata.system;
            bySystem[system] = (bySystem[system] || 0) + 1;
        }
        return bySystem;
    }
}

// Singleton para uso global
const sessionManager = new SessionManager();

module.exports = sessionManager;
module.exports.SessionManager = SessionManager;