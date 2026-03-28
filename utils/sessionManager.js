// Map em memória para velocidade máxima
const sessions = new Map();

/**
 * SESSION MANAGER OTIMIZADO
 * Focado em baixo consumo de RAM e expiração precisa.
 */
const SessionManager = {
    
    // Configurações padrão
    DEFAULT_EXPIRY: 300000, // 5 minutos

    /**
     * Cria ou atualiza uma sessão para o usuário
     * @param {string} userId - ID do usuário no Discord
     * @param {object} data - Dados a serem armazenados
     * @param {number} ttl - Tempo de vida em ms (opcional)
     */
    create(userId, data, ttl = this.DEFAULT_EXPIRY) {
        const sessionData = {
            ...data,
            expiresAt: Date.now() + ttl
        };
        sessions.set(userId, sessionData);
        return sessionData;
    },

    /**
     * Obtém a sessão e valida a expiração em tempo real
     */
    get(userId) {
        const session = sessions.get(userId);
        
        if (!session) return null;

        // Validação por timestamp absoluto (mais rápido que subtração)
        if (Date.now() > session.expiresAt) {
            sessions.delete(userId);
            return null;
        }

        return session;
    },

    /**
     * Deleta manualmente uma sessão (ex: após o uso de um botão)
     */
    delete(userId) {
        return sessions.delete(userId);
    },

    /**
     * Verifica existência validando expiração
     */
    exists(userId) {
        return !!this.get(userId);
    },

    /**
     * Retorna o tamanho atual do cache de sessões
     */
    size() {
        return sessions.size;
    },

    /**
     * Limpeza forçada de todas as sessões expiradas
     * Chamado pelo intervalo automático ou manualmente
     */
    cleanup() {
        const now = Date.now();
        let deletedCount = 0;

        for (const [userId, session] of sessions.entries()) {
            if (now > session.expiresAt) {
                sessions.delete(userId);
                deletedCount++;
            }
        }
        
        if (deletedCount > 0) {
            // Log silencioso apenas se houver limpeza significativa
            // console.log(`🧹 [Session] ${deletedCount} sessões expiradas removidas.`);
        }
    }
};

// Intervalo de limpeza: Ajustado para 2 minutos (equilíbrio entre CPU e RAM)
setInterval(() => SessionManager.cleanup(), 120000);

module.exports = SessionManager;