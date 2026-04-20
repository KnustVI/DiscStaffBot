const ConfigSystem = require('./configSystem');
const ErrorLogger = require('./errorLogger');
const os = require('os');
const { EmbedBuilder } = require('discord.js');

// Carregar emojis do servidor
let EMOJIS = {};
try {
    const emojisFile = require('../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

// Cores padrão do sistema
const COLORS = {
    DEFAULT: 0xDCA15E,
    SUCCESS: 0xBBF96A,
    WARNING: 0xFFBD59,
    DANGER: 0xF64B4E
};

// Cache para estatísticas
const statsCache = new Map();
const CACHE_TTL = 60000; // 1 minuto

class SystemStatus {
    
    // ==================== MÉTODOS PARA HANDLER CENTRAL ====================
    
    static async handleComponent(interaction, action, param) {
        try {
            switch (action) {
                case 'refresh':
                    await this.handleRefreshStatus(interaction);
                    break;
                case 'details':
                    await this.handleDetailedStatus(interaction, param);
                    break;
                default:
                    await interaction.editReply({
                        content: `${EMOJIS.Error || '❌'} Ação "${action}" não reconhecida no sistema de status.`,
                        components: []
                    });
            }
        } catch (error) {
            console.error('❌ Erro no handleComponent do systemStatus:', error);
            await interaction.editReply({
                content: `${EMOJIS.Error || '❌'} Ocorreu um erro ao processar o status do sistema.`,
                components: []
            });
        }
    }
    
    static async handleRefreshStatus(interaction) {
        const status = this.getBotStatus(interaction.client, interaction.guildId);
        
        if (!status) {
            return await interaction.editReply({
                content: `${EMOJIS.Error || '❌'} Erro ao obter status do sistema.`,
                components: []
            });
        }
        
        const embed = this.generateStatusEmbed(status, interaction.guild);
        
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('status:refresh')
                .setLabel(`${EMOJIS.Reset || '🔄'} Atualizar`)
                .setStyle(ButtonStyle.Secondary)
        );
        
        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });
    }
    
    static async handleDetailedStatus(interaction, param) {
        const status = this.getBotStatus(interaction.client, interaction.guildId);
        
        if (!status) {
            return await interaction.editReply({
                content: `${EMOJIS.Error || '❌'} Erro ao obter status detalhado.`,
                components: []
            });
        }
        
        const detailedEmbed = this.generateDetailedStatusEmbed(status, interaction.client, interaction.guild);
        
        await interaction.editReply({
            embeds: [detailedEmbed],
            components: []
        });
    }
    
    // ==================== ESTATÍSTICAS COM CACHE ====================
    
    /**
     * Busca estatísticas de punições com cache
     */
    static async getPunishmentStats(guildId) {
        const db = require('../database/index');
        
        // Verificar cache
        const cached = statsCache.get(guildId);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.data;
        }
        
        // Buscar do banco
        const stats = {
            totalPunishments: db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ?`).get(guildId)?.count || 0,
            totalUsers: db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM reputation WHERE guild_id = ?`).get(guildId)?.count || 0,
            avgReputation: db.prepare(`SELECT AVG(points) as avg FROM reputation WHERE guild_id = ?`).get(guildId)?.avg || 100,
            recentStrikes: db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ? AND created_at > ?`).get(guildId, Date.now() - (30 * 24 * 60 * 60 * 1000))?.count || 0,
            activeReports: db.prepare(`SELECT COUNT(*) as count FROM reports WHERE guild_id = ? AND status = 'open'`).get(guildId)?.count || 0
        };
        
        // Salvar no cache
        statsCache.set(guildId, { data: stats, timestamp: Date.now() });
        
        return stats;
    }
    
    /**
     * Limpa o cache de estatísticas
     */
    static clearStatsCache(guildId = null) {
        if (guildId) {
            statsCache.delete(guildId);
        } else {
            statsCache.clear();
        }
        console.log('🗑️ [SystemStatus] Cache de estatísticas limpo');
    }
    
    // ==================== GERADORES DE UI ====================
    
    static generateStatusEmbed(status, guild) {
        let color = COLORS.DEFAULT;
        if (status.ping !== "Calculando...") {
            const pingValue = parseInt(status.ping);
            if (pingValue < 100) color = COLORS.SUCCESS;
            else if (pingValue > 200) color = COLORS.DANGER;
            else if (pingValue > 100) color = COLORS.WARNING;
        }
        
        const embed = new EmbedBuilder()
            .setAuthor({ name: `${EMOJIS.panel || '📊'} Status do Sistema`, iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' })
            .setColor(color)
            .setDescription(`**${status.guildName}** • Sistema operacional normalmente`)
            .addFields(
                {
                    name: `${EMOJIS.Bot || '🤖'} Bot`,
                    value: `**Uptime:** ${status.uptime}\n**Latência:** ${status.ping}\n**Memória:** ${status.memory}`,
                    inline: true
                },
                {
                    name: `${EMOJIS.Rank || '📈'} Estatísticas`,
                    value: `**Servidores:** ${status.totalGuilds}\n**Usuários:** ${status.totalUsers.toLocaleString()}\n**Logs:** ${status.logChannel}`,
                    inline: true
                },
                {
                    name: `${EMOJIS.AutoMod || '🛡️'} Auto Moderação`,
                    value: `**Próxima Execução:** ${status.nextAutoModTS ? `<t:${status.nextAutoModTS}:R>` : 'N/A'}\n**Última Execução:** ${status.lastRunTS ? `<t:${status.lastRunTS}:R>` : 'Nunca'}`,
                    inline: false
                }
            )
            .setFooter({ text: `Sistema Robin • ${status.guildName}`, iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' })
            .setTimestamp();
        
        return embed;
    }
    
    static generateDetailedStatusEmbed(status, client, guild) {
        const cpuUsage = os.loadavg()[0];
        const totalCores = os.cpus().length;
        const platform = os.platform();
        const nodeVersion = process.version;
        const discordVersion = require('discord.js').version;
        
        let healthScore = 100;
        const pingValue = status.ping !== "Calculando..." ? parseInt(status.ping) : 100;
        if (pingValue > 200) healthScore -= 20;
        else if (pingValue > 100) healthScore -= 10;
        
        const memoryUsage = parseFloat(status.memory.split(' ')[0]);
        if (memoryUsage > 500) healthScore -= 20;
        else if (memoryUsage > 300) healthScore -= 10;
        
        const healthEmoji = healthScore >= 80 ? '🟢' : (healthScore >= 50 ? '🟡' : '🔴');
        
        const embed = new EmbedBuilder()
            .setAuthor({ name: `${EMOJIS.Config || '🔧'} Status Detalhado do Sistema`, iconURL: client.user?.displayAvatarURL() })
            .setColor(COLORS.DEFAULT)
            .addFields(
                {
                    name: `${EMOJIS.Bot || '🤖'} Bot`,
                    value: `**Uptime:** ${status.uptime}\n**Latência:** ${status.ping}\n**Memória:** ${status.memory}\n**Node:** ${nodeVersion}\n**DJS:** v${discordVersion}`,
                    inline: true
                },
                {
                    name: `${EMOJIS.stack || '💻'} Sistema`,
                    value: `**OS:** ${platform}\n**CPU:** ${totalCores} cores\n**Load:** ${cpuUsage.toFixed(2)}\n**Arquitetura:** ${os.arch()}`,
                    inline: true
                },
                {
                    name: `${EMOJIS.global || '📊'} Métricas`,
                    value: `**Servidores:** ${status.totalGuilds}\n**Usuários:** ${status.totalUsers.toLocaleString()}\n**Canais:** ${client.channels.cache.size}\n**Emojis:** ${client.emojis.cache.size}`,
                    inline: true
                },
                {
                    name: `${EMOJIS.AutoMod || '🛡️'} Auto Moderação`,
                    value: `**Próxima Execução:** ${status.nextAutoModTS ? `<t:${status.nextAutoModTS}:F>` : 'N/A'}\n**Última Execução:** ${status.lastRunTS ? `<t:${status.lastRunTS}:F>` : 'Nunca'}\n**Logs:** ${status.logChannel}`,
                    inline: false
                },
                {
                    name: `${healthEmoji} Health Score`,
                    value: `**${healthScore}/100**\n${this.getHealthRecommendations(healthScore, pingValue, memoryUsage)}`,
                    inline: false
                }
            )
            .setFooter({ text: `PID: ${process.pid} • ${new Date().toLocaleString('pt-BR')}`, iconURL: client.user?.displayAvatarURL() })
            .setTimestamp();
        
        return embed;
    }
    
    static getHealthRecommendations(healthScore, ping, memory) {
        if (healthScore >= 80) {
            return `${EMOJIS.Check || '✅'} Sistema saudável. Nenhuma ação necessária.`;
        } else if (healthScore >= 50) {
            let recommendations = [];
            if (ping > 100) recommendations.push('• Latência elevada, verifique a conexão');
            if (memory > 300) recommendations.push('• Consumo de memória alto, reinicie o bot');
            return `${EMOJIS.Warning || '⚠️'} Recomendações:\n${recommendations.join('\n')}`;
        } else {
            return `${EMOJIS.DANGER || '🔴'} **AÇÃO URGENTE:**\n• Reinicie o bot imediatamente\n• Verifique os logs\n• Escale recursos do servidor`;
        }
    }
    
    // ==================== FUNÇÕES PRINCIPAIS ====================
    
    static getBotStatus(client, guildId) {
        try {
            if (!client?.isReady()) {
                throw new Error("O Client do Discord não está pronto ou não foi inicializado.");
            }
            
            const uptimeMs = client.uptime || 0;
            const days = Math.floor(uptimeMs / 86400000);
            const hours = Math.floor((uptimeMs % 86400000) / 3600000);
            const minutes = Math.floor((uptimeMs % 3600000) / 60000);
            
            const now = new Date();
            let nextRun = new Date();
            nextRun.setHours(12, 0, 0, 0);
            
            if (now.getHours() >= 12) {
                nextRun.setDate(nextRun.getDate() + 1);
            }
            
            const usedMem = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
            const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
            const ping = client.ws?.ping > 0 ? `${client.ws.ping}ms` : "Calculando...";
            
            let guildData = {};
            try {
                guildData = ConfigSystem.getMany(guildId, ['log_channel', 'last_automod_run']);
            } catch (err) {
                console.error('❌ Erro ao buscar dados do servidor:', err);
                guildData = { log_channel: null, last_automod_run: null };
            }
            
            const totalUsers = client.guilds.cache.reduce((acc, g) => {
                return acc + (g.memberCount || g.approximateMemberCount || 0);
            }, 0);
            
            return {
                uptime: `${days}d ${hours}h ${minutes}m`,
                uptimeMs: uptimeMs,
                ping: ping,
                memory: `${usedMem} MB / ${totalMem} GB`,
                memoryRaw: parseFloat(usedMem),
                nextAutoModTS: Math.floor(nextRun.getTime() / 1000),
                lastRunTS: guildData.last_automod_run ? Math.floor(Number(guildData.last_automod_run) / 1000) : null,
                totalGuilds: client.guilds.cache.size,
                totalUsers: totalUsers,
                totalChannels: client.channels.cache.size,
                totalEmojis: client.emojis.cache.size,
                logChannel: guildData.log_channel ? `<#${guildData.log_channel}>` : `${EMOJIS.Error || '⚠️'} Não configurado`,
                logChannelId: guildData.log_channel,
                guildName: client.guilds.cache.get(guildId)?.name || "Este Servidor",
                guildId: guildId,
                cpuLoad: os.loadavg()[0],
                cpuCores: os.cpus().length,
                platform: os.platform(),
                nodeVersion: process.version,
                currentTimestamp: Math.floor(Date.now() / 1000)
            };
            
        } catch (err) {
            console.error('❌ Erro ao obter status do sistema:', err);
            if (ErrorLogger && ErrorLogger.log) {
                ErrorLogger.log('SystemStatus_Logic_Error', err);
            }
            return null;
        }
    }
    
    static isSystemHealthy(client, guildId) {
        const status = this.getBotStatus(client, guildId);
        if (!status) return false;
        
        const pingValue = status.ping !== "Calculando..." ? parseInt(status.ping) : 100;
        const isPingOk = pingValue < 200;
        const isMemoryOk = status.memoryRaw < 500;
        
        return isPingOk && isMemoryOk;
    }
    
    static getQuickStatus(client, guildId) {
        const status = this.getBotStatus(client, guildId);
        if (!status) return `${EMOJIS.Error || '❌'} Sistema indisponível`;
        
        return `${EMOJIS.Check || '✅'} Online | ${status.uptime} | ${status.ping} | ${status.memory}`;
    }
    
    static getPerformanceReport(client) {
        const startTime = process.hrtime();
        
        return {
            timestamp: Date.now(),
            bot: {
                uptime: client.uptime,
                guilds: client.guilds.cache.size,
                users: client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0),
                ping: client.ws?.ping || 0
            },
            system: {
                memory: process.memoryUsage(),
                cpu: os.loadavg(),
                platform: os.platform(),
                nodeVersion: process.version
            },
            performance: {
                eventLoopLag: process.hrtime(startTime)[1] / 1000000
            }
        };
    }
}

module.exports = SystemStatus;