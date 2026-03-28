const sessions = new Map();

/**
 * Estrutura da Session:
 * userId: {
 *    guildId: string,
 *    lastAction: timestamp,
 *    tempData: {} 
 * }
 */

module.exports = {
    // Cria ou atualiza uma sessão
    set(userId, data) {
        sessions.set(userId, {
            ...data,
            lastAction: Date.now()
        });

        // Auto-delete após 10 minutos para não vazar memória
        setTimeout(() => {
            const current = sessions.get(userId);
            if (current && (Date.now() - current.lastAction) >= 600000) {
                sessions.delete(userId);
            }
        }, 600000);
    },

    // Pega os dados da sessão
    get(userId) {
        return sessions.get(userId);
    },

    // Finaliza a sessão
    delete(userId) {
        return sessions.delete(userId);
    },

    // Verifica se existe
    has(userId) {
        return sessions.has(userId);
    }
};