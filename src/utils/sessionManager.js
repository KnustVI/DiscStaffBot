const sessions = new Map();

/**
 * SESSION MANAGER OTIMIZADO
 * Gerencia o estado temporário de interações (menus, botões, formulários)
 * evitando sobrecarga de memória e conflitos de contexto.
 */
const SessionManager = {
    DEFAULT_EXPIRY: 600000, // 10 minutos (10 * 60 * 1000)

    /**
     * Gera uma chave composta para isolar o contexto.
     * @private
     */
    _generateKey(guildId, userId, action) {
        return `${guildId}:${userId}:${action}`;
    },

    /**
     * Cria ou atualiza uma sessão ativa.
     */
    set(guildId, userId, action, data = {}, ttl = this.DEFAULT_EXPIRY) {
        const key = this._generateKey(guildId, userId, action);
        
        // Remove sessão anterior para garantir dados limpos
        if (sessions.has(key)) sessions.delete(key);

        sessions.set(key, {
            ...data,
            guildId,
            userId,
            action,
            expiresAt: Date.now() + ttl
        });
    },

    /**
     * Recupera dados da sessão com validação de expiração (Lazy Delete).
     */
    get(guildId, userId, action) {
        const key = this._generateKey(guildId, userId, action);
        const session = sessions.get(key);
        
        if (!session) return null;

        // Validação de expiração no momento do acesso
        if (Date.now() > session.expiresAt) {
            sessions.delete(key);
            return null;
        }

        return session;
    },

    /**
     * Finaliza uma sessão manualmente (Ex: após concluir um formulário).
     */
    delete(guildId, userId, action) {
        const key = this._generateKey(guildId, userId, action);
        return sessions.delete(key);
    },

    /**
     * Limpeza periódica para evitar Memory Leak (Vazamento de memória).
     */
    cleanup() {
        const now = Date.now();
        let count = 0;

        for (const [key, session] of sessions.entries()) {
            if (now > session.expiresAt) {
                sessions.delete(key);
                count++;
            }
        }

        if (count > 0) {
            // Log discreto para monitoramento na Oracle Cloud
            console.log(`\x1b[34m[SESSION]\x1b[0m Limpeza concluída: ${count} sessões expiradas removidas.`);
        }
    }
};

// Intervalo de manutenção automática (A cada 10 minutos)
setInterval(() => SessionManager.cleanup(), 600000);

module.exports = SessionManager;