const sessions = new Map();

module.exports = {

    create: (userId, data) => {
        sessions.set(userId, {
            ...data,
            createdAt: Date.now()
        });
    },

    get: (userId) => {
        return sessions.get(userId);
    },

    delete: (userId) => {
        sessions.delete(userId);
    },

    exists: (userId) => {
        return sessions.has(userId);
    },

    clearExpired: (maxAge = 300000) => { // 5 min
        const now = Date.now();
        for (const [userId, session] of sessions.entries()) {
            if (now - session.createdAt > maxAge) {
                sessions.delete(userId);
            }
        }
    }

};