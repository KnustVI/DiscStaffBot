const db = require('../database/database');
const ConfigCache = require('./configCache');
const ErrorLogger = require('./errorLogger');
const { EMOJIS } = require('../database/emojis');

/**
 * Sistema de Configuração Centralizado
 * Responsável pela persistência (SQLite) e performance (Cache)
 */
const ConfigSystem = {
    
    /**
     * Busca uma configuração.
     * @param {string} guildId - ID do servidor.
     * @param {string} key - Chave da config (ex: 'staff_role', 'logs_channel').
     * @returns {string|null} - O valor salvo ou null se não existir.
     */
    getSetting(guildId, key) {
        try {
            // 1. Tenta buscar na RAM primeiro (Velocidade máxima)
            let value = ConfigCache.get(guildId, key);
            
            // 2. Se não estiver no Cache (undefined), busca no Banco de Dados
            if (value === undefined) { 
                const row = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, key);
                
                // Se existir no banco, pega o valor. Se não, define como null.
                value = row ? row.value : null;
                
                // 3. Alimenta o Cache para que a próxima consulta não precise ir ao disco
                ConfigCache.set(guildId, key, value);
            }
            
            return value;
        } catch (err) {
            ErrorLogger.log('ConfigSystem_Get', err);
            return null;
        }
    },

    /**
     * Salva ou Atualiza uma configuração.
     */
    updateSetting(guildId, key, value) {
        try {
            db.prepare(`
                INSERT INTO settings (guild_id, key, value) 
                VALUES (?, ?, ?) 
                ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
            `).run(guildId, key, value);
            
            ConfigCache.set(guildId, key, value);
            return true;
        } catch (err) {
            ErrorLogger.log('ConfigSystem_Update', err);
            throw err;
        }
    },

    /**
     * TRAVA DE SEGURANÇA: Valida Staff e Configurações Essenciais
     * @param {object} interaction - A interação do Discord.
     * @returns {boolean} - True se autorizado, False se bloqueado.
     */
    async checkAuth(interaction) {
        const guildId = interaction.guild.id;

        // 1. Busca configurações usando o getSetting (que já usa o Cache)
        const staffRoleId = this.getSetting(guildId, 'staff_role');
        const logsChannelId = this.getSetting(guildId, 'logs_channel');

        // 2. Validação de Configuração Completa
        if (!staffRoleId || !logsChannelId) {
            await interaction.reply({
                content: `${EMOJIS.ERRO} **Configuração Incompleta!**\nEste comando exige que o cargo de Staff e o canal de Logs estejam configurados.\nUse \`/config-set\` para finalizar a instalação do bot.`,
                ephemeral: true
            });
            return false;
        }

        // 3. Validação de Permissão (Cargo de Staff OU Admin do Servidor)
        const isStaff = interaction.member.roles.cache.has(staffRoleId);
        const isAdmin = interaction.member.permissions.has('Administrator');

        if (!isStaff && !isAdmin) {
            await interaction.reply({
                content: `${EMOJIS.ERRO} **Acesso Negado!**\nApenas membros com o cargo de Staff configurado podem usar este comando.`,
                ephemeral: true
            });
            return false;
        }

        return true; // Tudo limpo, pode prosseguir
    },

    /**
     * Remove todas as configurações de um servidor.
     */
    resetSettings(guildId) {
        try {
            db.prepare(`DELETE FROM settings WHERE guild_id = ?`).run(guildId);
            
            if (ConfigCache.deleteGuild) {
                ConfigCache.deleteGuild(guildId); 
            }
            
            return true;
        } catch (err) {
            ErrorLogger.log('ConfigSystem_Reset', err);
            return false;
        }
    },
    /**
     * Gera a assinatura padrão para todas as embeds do bot.
     * @param {string} guildName - Nome do servidor atual.
     * @returns {object} - Objeto formatado para o .setFooter()
     */
    getFooter(guildName) {
        return {
            text: `✧ Made By: KnustVI | ${guildName || 'Servidor'}`,
            iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png'
        };
    }
};

module.exports = ConfigSystem;