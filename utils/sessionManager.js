const sessions = new Map();

// Limpeza automática em segundo plano a cada 1 minuto para economizar RAM
setInterval(() => {
    const now = Date.now();
    const maxAge = 300000; // 5 minutos
    for (const [userId, session] of sessions.entries()) {
        if (now - session.createdAt > maxAge) {
            sessions.delete(userId);
        }
    }
}, 60000);

module.exports = {
    // Cria ou atualiza uma sessão
    create: (userId, data) => {
        const sessionData = {
            ...data,
            createdAt: Date.now()
        };
        sessions.set(userId, sessionData);
        return sessionData;
    },

    // Obtém a sessão apenas se não estiver expirada
    get: (userId, maxAge = 300000) => {
        const session = sessions.get(userId);
        if (!session) return null;

        // Verificação de segurança: se expirou, deleta na hora e retorna null
        if (Date.now() - session.createdAt > maxAge) {
            sessions.delete(userId);
            return null;
        }

        return session;
    },

    delete: (userId) => {
        return sessions.delete(userId);
    },

    exists: (userId) => {
        // Usa o método get acima para garantir que não valide uma sessão expirada
        return !!module.exports.get(userId);
    },

    // Útil para debugging no console
    size: () => sessions.size
};