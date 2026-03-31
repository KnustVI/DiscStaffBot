const cache = new Map();

const ConfigCache = {
    // Adicionamos esta função apenas para evitar o erro no index.js
    async loadAll() {
        console.log("🧠 [Cache] Sistema de carregamento dinâmico ativado.");
        return true;
    },

    get(guildId, key) {
        return cache.get(guildId)?.get(key);
    },

    set(guildId, key, value) {
        if (!cache.has(guildId)) {
            cache.set(guildId, new Map());
        }
        cache.get(guildId).set(key, value);
    },

    setFull(guildId, settingsObj) {
        const guildMap = new Map(Object.entries(settingsObj));
        cache.set(guildId, guildMap);
    },

    deleteGuild(guildId) {
        cache.delete(guildId);
    }
};

module.exports = ConfigCache;