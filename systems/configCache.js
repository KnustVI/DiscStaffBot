const cache = new Map();

const ConfigCache = {
    // Busca no mapa de memória
    get(guildId, key) {
        return cache.get(guildId)?.get(key);
    },

    // Salva uma chave específica
    set(guildId, key, value) {
        if (!cache.has(guildId)) {
            cache.set(guildId, new Map());
        }
        cache.get(guildId).set(key, value);
    },

    // Salva um objeto inteiro de configurações (Usado pelo ConfigSystem)
    setFull(guildId, settingsObj) {
        const guildMap = new Map(Object.entries(settingsObj));
        cache.set(guildId, guildMap);
    },

    // Limpa o cache de um servidor (Usado no Reset)
    deleteGuild(guildId) {
        cache.delete(guildId);
    }
};

module.exports = ConfigCache;