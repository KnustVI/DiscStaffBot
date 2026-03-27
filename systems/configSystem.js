const db = require('../database/database');
const ConfigCache = require('./configCache');
const ErrorLogger = require('./errorLogger');
const { EMOJIS } = require('../database/emojis');
const { PermissionFlagsBits } = require('discord.js');

// ==========================
// PREPARED STATEMENTS (PERFORMANCE)
// ==========================
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

            // 🔥 garante consistência no cache
            ConfigCache.set(guildId, key, value);

            return true;

        } catch (err) {
            ErrorLogger.log('ConfigSystem_Update', err);
            throw err;
        }
    },

    // =========================
    // AUTH CHECK (CRÍTICO)
    // =========================
    async checkAuth(interaction) {

        try {

            const guildId = interaction.guild.id;

            const staffRoleId = this.getSetting(guildId, 'staff_role');
            const logsChannelId = this.getSetting(guildId, 'logs_channel');

            // =========================
            // CONFIG VALIDATION
            // =========================
            if (!staffRoleId || !logsChannelId) {
                await interaction.reply({
                    content: `${EMOJIS.ERRO} **Configuração Incompleta!**\nEste comando exige que o cargo de Staff e o canal de Logs estejam configurados.\nUse \`/config-set\` para finalizar a instalação do bot.`,
                    ephemeral: true
                });
                return false;
            }

            // =========================
            // MEMBER SAFETY
            // =========================
            const member = interaction.member;

            if (!member || !member.roles) {
                await interaction.reply({
                    content: `${EMOJIS.ERRO} Não foi possível validar suas permissões.`,
                    ephemeral: true
                });
                return false;
            }

            // =========================
            // PERMISSION CHECK
            // =========================
            const isStaff = member.roles.cache.has(staffRoleId);
            const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

            if (!isStaff && !isAdmin) {
                await interaction.reply({
                    content: `${EMOJIS.ERRO} **Acesso Negado!**\nApenas membros com o cargo de Staff configurado podem usar este comando.`,
                    ephemeral: true
                });
                return false;
            }

            return true;

        } catch (err) {
            ErrorLogger.log('ConfigSystem_Auth', err);

            await interaction.reply({
                content: `${EMOJIS.ERRO} Erro ao validar permissões.`,
                ephemeral: true
            });

            return false;
        }
    },

    // =========================
    // RESET
    // =========================
    resetSettings(guildId) {
        try {

            deleteStmt.run(guildId);

            if (ConfigCache.deleteGuild) {
                ConfigCache.deleteGuild(guildId);
            }

            return true;

        } catch (err) {
            ErrorLogger.log('ConfigSystem_Reset', err);
            return false;
        }
    },

    // =========================
    // FOOTER
    // =========================
    getFooter(guildName) {
        return {
            text: `✧ Made By: KnustVI | ${guildName || 'Servidor'}`,
            iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png'
        };
    }
};

module.exports = ConfigSystem;