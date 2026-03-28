const db = require('../database/database');
const ConfigCache = require('./configCache');
const ErrorLogger = require('./errorLogger');
const { EMOJIS } = require('../database/emojis');
const { PermissionFlagsBits } = require('discord.js');

// Prepared Statements fora do objeto para performance máxima
const getStmt = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`);
const upsertStmt = db.prepare(`
    INSERT INTO settings (guild_id, key, value) 
    VALUES (?, ?, ?) 
    ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
`);
const deleteStmt = db.prepare(`DELETE FROM settings WHERE guild_id = ?`);

const ConfigSystem = {

    // =========================
    // GET SETTING (CACHE FIRST)
    // =========================
    getSetting(guildId, key) {
        try {
            let value = ConfigCache.get(guildId, key);

            if (value === undefined) {
                const row = getStmt.get(guildId, key);
                value = row ? row.value : null;
                ConfigCache.set(guildId, key, value);
            }
            return value;
        } catch (err) {
            ErrorLogger.log('ConfigSystem_Get', err);
            return null;
        }
    },

    // =========================
    // UPDATE SETTING
    // =========================
    updateSetting(guildId, key, value) {
        try {
            upsertStmt.run(guildId, key, value);
            ConfigCache.set(guildId, key, value);
            return true;
        } catch (err) {
            ErrorLogger.log('ConfigSystem_Update', err);
            throw err; // Lançamos para o Handler capturar o erro exato
        }
    },

    // =========================
    // AUTH CHECK (LÓGICA PURA)
    // =========================
    // Removi os .reply() daqui. Ele agora retorna um objeto com o status.
    async checkAuth(interaction) {
        try {
            const guildId = interaction.guildId;
            const staffRoleId = this.getSetting(guildId, 'staff_role');
            const logsChannelId = this.getSetting(guildId, 'logs_channel');

            // 1. Verificação de Configuração Básica
            if (!staffRoleId || !logsChannelId) {
                return { 
                    authorized: false, 
                    message: `${EMOJIS.ERRO} **Configuração Incompleta!**\nUse \`/config\` para definir o cargo Staff e o canal de Logs.` 
                };
            }

            const member = interaction.member;
            if (!member) return { authorized: false, message: 'Membro não encontrado.' };

            // 2. Verificação de Permissões
            const isStaff = member.roles.cache.has(staffRoleId);
            const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

            if (!isStaff && !isAdmin) {
                return { 
                    authorized: false, 
                    message: `${EMOJIS.ERRO} **Acesso Negado!**\nVocê precisa do cargo <@&${staffRoleId}> para usar isso.` 
                };
            }

            return { authorized: true };

        } catch (err) {
            ErrorLogger.log('ConfigSystem_Auth', err);
            return { authorized: false, message: 'Erro interno ao validar permissões.' };
        }
    },

    // =========================
    // RESET & UTILS
    // =========================
    resetSettings(guildId) {
        try {
            deleteStmt.run(guildId);
            if (ConfigCache.deleteGuild) ConfigCache.deleteGuild(guildId);
            return true;
        } catch (err) {
            ErrorLogger.log('ConfigSystem_Reset', err);
            return false;
        }
    },

    getFooter(guildName) {
        return {
            text: `✧ Made By: KnustVI | ${guildName || 'Servidor'}`,
            iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png'
        };
    }
};

module.exports = ConfigSystem;