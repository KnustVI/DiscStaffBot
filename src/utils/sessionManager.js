const sessions = new Map();

/**
 * SESSION MANAGER OTIMIZADO (Ponto 3 & 4)
 * Focado em contexto Guild-User-Action e expiração automática.
 */
const SessionManager = {
    DEFAULT_EXPIRY: 600000, // 10 minutos

    // Função interna para gerar a chave única (Ponto 3)
    _generateKey(guildId, userId, action) {
        return `${guildId}:${userId}:${action}`;
    },

    /**
     * @param {string} guildId - ID do Servidor
     * @param {string} userId - ID do Usuário
     * @param {string} action - Prefixo da ação (ex: 'config', 'strike')
     * @param {object} data - Dados da sessão
     */
    set(guildId, userId, action, data = {}, ttl = this.DEFAULT_EXPIRY) {
        const key = this._generateKey(guildId, userId, action);
        
        // Limpa resíduos antes de setar nova
        sessions.delete(key);

        sessions.set(key, {
            ...data,
            guildId,
            userId,
            action,
            expiresAt: Date.now() + ttl
        });
    },

    get(guildId, userId, action) {
        const key = this._generateKey(guildId, userId, action);
        const session = sessions.get(key);
        
        if (!session) return null;

        // Ponto 4: Auto-limpeza no acesso (Lazy Delete)
        if (Date.now() > session.expiresAt) {
            sessions.delete(key);
            return null;
        }

        return session;
    },

    delete(guildId, userId, action) {
        return sessions.delete(this._generateKey(guildId, userId, action));
    },

    // Limpeza em massa para segurança de memória (Ponto 4)
    cleanup() {
        const now = Date.now();
        let count = 0;
        for (const [key, session] of sessions.entries()) {
            if (now > session.expiresAt) {
                sessions.delete(key);
                count++;
            }
        }
        if (count > 0) console.log(`[CLEANUP] ${count} sessões expiradas removidas.`);
    }
};

// Ponto 4: Intervalo de limpeza pesada a cada 10 minutos
setInterval(() => SessionManager.cleanup(), 600000);

module.exports = SessionManager;