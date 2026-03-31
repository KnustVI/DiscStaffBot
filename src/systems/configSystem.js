const { PermissionFlagsBits } = require('discord.js');

const ConfigSystem = {
    /**
     * Busca uma configuração específica
     */
    getSetting(guildId, key) {
        try {
            // Acessamos o cache que deve estar injetado no client ou importado
            // Se o ConfigCache for um Map global, mantemos a lógica
            const ConfigCache = require('./configCache'); 
            
            let value = ConfigCache.get(guildId, key);

            if (value === undefined) {
                // Se não está no cache, faz o lookup (getSettings deve ser síncrono com better-sqlite3)
                const { getSettings } = require('./getSettings');
                const settings = getSettings(guildId);
                
                ConfigCache.setFull(guildId, settings);
                value = settings[key] || null;
            }
            return value;
        } catch (err) {
            console.error('❌ Erro no ConfigSystem_Get:', err);
            return null;
        }
    },

    /**
     * Atualiza no banco e reflete no Cache
     */
    updateSetting(guildId, key, value) {
        try {
            const db = require('../database');
            const ConfigCache = require('./configCache');

            db.prepare(`
                INSERT INTO settings (guild_id, key, value) 
                VALUES (?, ?, ?) 
                ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
            `).run(guildId, key, String(value));

            ConfigCache.set(guildId, key, value);
            return true;
        } catch (err) {
            throw err;
        }
    },

    /**
     * Checagem de Autoridade Rápida
     * Alterado para síncrono (Otimização de Performance)
     */
    checkAuth(interaction) {
        const EMOJIS = interaction.client.systems.emojis || {};
        
        const staffRoleId = this.getSetting(interaction.guildId, 'staff_role');
        const logsChannelId = this.getSetting(interaction.guildId, 'logs_channel');

        // 1. Verifica se o bot foi configurado
        if (!staffRoleId || !logsChannelId) {
            return { 
                authorized: false, 
                message: `${EMOJIS.ERRO || '❌'} **Configuração Incompleta!** Use \`/config\` primeiro.` 
            };
        }

        // 2. Verifica permissões (Admin ignora restrição de cargo)
        const isStaff = interaction.member.roles.cache.has(staffRoleId);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!isStaff && !isAdmin) {
            return { 
                authorized: false, 
                message: `${EMOJIS.ERRO || '❌'} **Acesso Negado!** Apenas a Staff pode usar este comando.` 
            };
        }

        return { authorized: true };
    },

    /**
     * Footer Padronizado (KnustVI)
     */
    getFooter(guildName) {
        return {
            text: `✧ Made By: KnustVI | ${guildName}`,
            iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png'
        };
    }
};

module.exports = ConfigSystem;