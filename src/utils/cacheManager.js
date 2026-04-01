/**
 * CacheManager - Sistema de Cache com TTL (Time To Live)
 * 
 * Características:
 * - Suporte a expiração automática
 * - Limpeza programada de itens expirados
 * - Prevenção de crescimento infinito
 */

class CacheManager {
    constructor(options = {}) {
        this.cache = new Map();
        this.defaultTTL = options.defaultTTL || 300000; // 5 minutos
        this.cleanupInterval = null;
        
        // Iniciar limpeza automática
        this.startCleanup(options.cleanupIntervalMs || 60000);
    }
    
    /**
     * Define um valor no cache
     * @param {string} key - Chave única
     * @param {any} value - Valor a ser armazenado
     * @param {number} ttl - Tempo de vida em ms (opcional)
     */
    set(key, value, ttl = this.defaultTTL) {
        const expires = Date.now() + ttl;
        this.cache.set(key, { value, expires });
        
        // Log de debug (opcional)
        // console.log(`📦 [Cache] Set: ${key} | TTL: ${ttl}ms`);
        
        return true;
    }
    
    /**
     * Obtém um valor do cache
     * @param {string} key - Chave única
     * @returns {any|null} Valor armazenado ou null se expirado/inexistente
     */
    get(key) {
        const item = this.cache.get(key);
        
        if (!item) return null;
        
        // Verificar expiração
        if (item.expires <= Date.now()) {
            this.cache.delete(key);
            return null;
        }
        
        return item.value;
    }
    
    /**
     * Verifica se uma chave existe e não expirou
     */
    has(key) {
        const item = this.cache.get(key);
        if (!item) return false;
        if (item.expires <= Date.now()) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }
    
    /**
     * Remove um item do cache
     */
    delete(key) {
        return this.cache.delete(key);
    }
    
    /**
     * Limpa todo o cache
     */
    clear() {
        this.cache.clear();
        console.log('🗑️ [Cache] Cache completamente limpo');
    }
    
    /**
     * Remove itens expirados
     * @returns {number} Quantidade de itens removidos
     */
    cleanup() {
        const now = Date.now();
        let removed = 0;
        
        for (const [key, item] of this.cache) {
            if (item.expires <= now) {
                this.cache.delete(key);
                removed++;
            }
        }
        
        if (removed > 0) {
            // console.log(`🧹 [Cache] Limpeza: ${removed} itens expirados removidos`);
        }
        
        return removed;
    }
    
    /**
     * Inicia limpeza automática
     */
    startCleanup(intervalMs = 60000) {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, intervalMs);
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
     * Obtém estatísticas do cache
     */
    getStats() {
        const now = Date.now();
        let total = 0;
        let active = 0;
        let expired = 0;
        
        for (const item of this.cache.values()) {
            total++;
            if (item.expires > now) active++;
            else expired++;
        }
        
        return {
            total,
            active,
            expired,
            size: this.cache.size
        };
    }
    
    /**
     * Renova o TTL de um item
     */
    renew(key, ttl = this.defaultTTL) {
        const item = this.cache.get(key);
        if (!item) return false;
        
        item.expires = Date.now() + ttl;
        this.cache.set(key, item);
        return true;
    }
    
    /**
     * Obtém todas as chaves ativas
     */
    keys() {
        const activeKeys = [];
        const now = Date.now();
        
        for (const [key, item] of this.cache) {
            if (item.expires > now) {
                activeKeys.push(key);
            }
        }
        
        return activeKeys;
    }
}

// Singleton para uso global
const cacheManager = new CacheManager();

module.exports = cacheManager;
module.exports.CacheManager = CacheManager;