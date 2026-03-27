const getSettings = require('./getSettings');

const cache = new Map();

module.exports = {

    get: (db, guildId) => {
        if (cache.has(guildId)) {
            return cache.get(guildId);
        }

        const settings = getSettings(db, guildId);
        cache.set(guildId, settings);
        return settings;
    },

    set: (guildId, key, value) => {
        if (!cache.has(guildId)) return;

        const settings = cache.get(guildId);
        settings[key] = value;
        cache.set(guildId, settings);
    },

    delete: (guildId) => {
        cache.delete(guildId);
    }

};