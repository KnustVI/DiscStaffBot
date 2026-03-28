const db = require('../database/database');
const ConfigCache = require('./configCache');
const ErrorLogger = require('./errorLogger');
const { getSettings } = require('./getSettings'); // Caminho corrigido conforme sua imagem
const { EMOJIS } = require('../database/emojis');
const { PermissionFlagsBits } = require('discord.js');

const ConfigSystem = {
    getSetting(guildId, key) {
        try {
            // 1. Tenta pegar no Cache (RAM)
            let value = ConfigCache.get(guildId, key);

            // 2. Se não estiver no Cache, busca no Banco e salva no Cache
            if (value === undefined) {
                const settings = getSettings(guildId);
                ConfigCache.setFull(guildId, settings);
                value = settings[key] || null;
            }
            return value;
        } catch (err) {
            ErrorLogger.log('ConfigSystem_Get', err);
            return null;
        }
    },

    updateSetting(guildId, key, value) {
        try {
            db.prepare(`
                INSERT INTO settings (guild_id, key, value) 
                VALUES (?, ?, ?) 
                ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
            `).run(guildId, key, String(value));

            ConfigCache.set(guildId, key, value);
            return true;
        } catch (err) {
            ErrorLogger.log('ConfigSystem_Update', err);
            throw err;
        }
    },

    async checkAuth(interaction) {
        const staffRoleId = this.getSetting(interaction.guildId, 'staff_role');
        const logsChannelId = this.getSetting(interaction.guildId, 'logs_channel');

        if (!staffRoleId || !logsChannelId) {
            return { authorized: false, message: `${EMOJIS.ERRO || '❌'} **Configuração Incompleta!** Use \`/config\`.` };
        }

        const isStaff = interaction.member.roles.cache.has(staffRoleId);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!isStaff && !isAdmin) {
            return { authorized: false, message: `${EMOJIS.ERRO || '❌'} **Acesso Negado!**` };
        }

        return { authorized: true };
    },

    getFooter(guildName) {
        return {
            text: `✧ Made By: KnustVI | ${guildName}`,
            iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png'
        };
    }
};

module.exports = ConfigSystem;