const sessions = new Map();

/**
 * SESSION MANAGER OTIMIZADO
 * Focado em contexto Guild-User e expiração automática.
 */
const SessionManager = {
    DEFAULT_EXPIRY: 600000, // 10 minutos (equilíbrio ideal)

    /**
     * @param {string} guildId - ID do Servidor
     * @param {string} userId - ID do Usuário
     * @param {string} action - Prefixo da ação (ex: 'config', 'ticket')
     * @param {object} data - Dados da sessão
     */
    set(guildId, userId, action, data, ttl = this.DEFAULT_EXPIRY) {
        const key = `${guildId}-${userId}-${action}`;
        
        // Se já existir, limpa para não duplicar processamento
        this.delete(guildId, userId, action);

        sessions.set(key, {
            ...data,
            expiresAt: Date.now() + ttl
        });
    },

    get(guildId, userId, action) {
        const key = `${guildId}-${userId}-${action}`;
        const session = sessions.get(key);
        
        if (!session) return null;

        if (Date.now() > session.expiresAt) {
            sessions.delete(key);
            return null;
        }

        return session;
    },

    delete(guildId, userId, action) {
        return sessions.delete(`${guildId}-${userId}-${action}`);
    },

    // Limpeza pesada para evitar vazamento de memória (Problema 4)
    cleanup() {
        const now = Date.now();
        for (const [key, session] of sessions.entries()) {
            if (now > session.expiresAt) sessions.delete(key);
        }
    }
};

// Intervalo de limpeza a cada 5 minutos
setInterval(() => SessionManager.cleanup(), 300000);

module.exports = SessionManager;