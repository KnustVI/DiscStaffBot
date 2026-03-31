const ConfigSystem = require('./configSystem');
const ErrorLogger = require('./errorLogger');
const os = require('os');
const { EmbedBuilder } = require('discord.js');

// Cores padrão do sistema
const COLORS = {
    DEFAULT: 0xDCA15E,      // Cor padrão
    SUCCESS: 0x00FF00,      // Verde para status bom
    WARNING: 0xFFA500,      // Laranja para status moderado
    DANGER: 0xFF0000        // Vermelho para status crítico
};

class SystemStatus {
    
    // ==================== MÉTODOS PARA HANDLER CENTRAL ====================
    
    /**
     * Handler para componentes (botões e selects)
     * Chamado pelo InteractionHandler quando customId começa com "status:"
     */
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
                        content: `❌ Ação "${action}" não reconhecida no sistema de status.`,
                        components: []
                    });
            }
        } catch (error) {
            console.error('❌ Erro no handleComponent do systemStatus:', error);
            await interaction.editReply({
                content: '❌ Ocorreu um erro ao processar o status do sistema.',
                components: []
            });
        }
    }
    
    /**
     * Atualiza o status (refresh)
     */
    static async handleRefreshStatus(interaction) {
        const status = this.getBotStatus(interaction.client, interaction.guildId);
        
        if (!status) {
            return await interaction.editReply({
                content: '❌ Erro ao obter status do sistema.',
                components: []
            });
        }
        
        const embed = this.generateStatusEmbed(status);
        
        // Adicionar botão de refresh
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('status:refresh')
                .setLabel('🔄 Atualizar')
                .setStyle(ButtonStyle.Secondary)
        );
        
        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });
    }
    
    /**
     * Mostra status detalhado (com informações do sistema)
     */
    static async handleDetailedStatus(interaction, param) {
        const status = this.getBotStatus(interaction.client, interaction.guildId);
        
        if (!status) {
            return await interaction.editReply({
                content: '❌ Erro ao obter status detalhado.',
                components: []
            });
        }
        
        const detailedEmbed = this.generateDetailedStatusEmbed(status, interaction.client);
        
        await interaction.editReply({
            embeds: [detailedEmbed],
            components: []
        });
    }
    
    // ==================== GERADORES DE UI ====================
    
    /**
     * Gera embed de status principal
     */
    static generateStatusEmbed(status) {
        // Determinar cor baseada na saúde do sistema
        let color = COLORS.DEFAULT;
        if (status.ping !== "Calculando...") {
            const pingValue = parseInt(status.ping);
            if (pingValue < 100) color = COLORS.SUCCESS;
            else if (pingValue > 200) color = COLORS.DANGER;
            else if (pingValue > 100) color = COLORS.WARNING;
        }
        
        const embed = new EmbedBuilder()
            .setAuthor({ name: '📊 Status do Sistema', iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' })
            .setColor(color)
            .setDescription(`**${status.guildName}** • Sistema operacional normalmente`)
            .addFields(
                {
                    name: '🤖 Bot',
                    value: `**Uptime:** ${status.uptime}\n**Latência:** ${status.ping}\n**Memória:** ${status.memory}`,
                    inline: true
                },
                {
                    name: '📈 Estatísticas',
                    value: `**Servidores:** ${status.totalGuilds}\n**Usuários:** ${status.totalUsers.toLocaleString()}\n**Canais de Log:** ${status.logChannel}`,
                    inline: true
                },
                {
                    name: '🛡️ Auto Moderação',
                    value: `**Próxima Execução:** ${status.nextAutoModTS ? `<t:${status.nextAutoModTS}:R>` : 'N/A'}\n**Última Execução:** ${status.lastRunTS ? `<t:${status.lastRunTS}:R>` : 'Nunca'}`,
                    inline: false
                }
            )
            .setFooter({ text: `Sistema Robin • ${status.guildName}`, iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' })
            .setTimestamp();
        
        return embed;
    }
    
    /**
     * Gera embed de status detalhado
     */
    static generateDetailedStatusEmbed(status, client) {
        // Informações adicionais do sistema
        const cpuUsage = os.loadavg()[0];
        const totalCores = os.cpus().length;
        const platform = os.platform();
        const nodeVersion = process.version;
        const discordVersion = require('discord.js').version;
        
        // Cálculo de health score
        let healthScore = 100;
        const pingValue = status.ping !== "Calculando..." ? parseInt(status.ping) : 100;
        if (pingValue > 200) healthScore -= 20;
        else if (pingValue > 100) healthScore -= 10;
        
        const memoryUsage = parseFloat(status.memory.split(' ')[0]);
        if (memoryUsage > 500) healthScore -= 20;
        else if (memoryUsage > 300) healthScore -= 10;
        
        const healthEmoji = healthScore >= 80 ? '🟢' : (healthScore >= 50 ? '🟡' : '🔴');
        
        const embed = new EmbedBuilder()
            .setAuthor({ name: '🔧 Status Detalhado do Sistema', iconURL: client.user?.displayAvatarURL() })
            .setColor(COLORS.DEFAULT)
            .addFields(
                {
                    name: '🤖 Bot',
                    value: `**Uptime:** ${status.uptime}\n**Latência:** ${status.ping}\n**Memória RAM:** ${status.memory}\n**Node.js:** ${nodeVersion}\n**Discord.js:** v${discordVersion}`,
                    inline: true
                },
                {
                    name: '💻 Sistema Operacional',
                    value: `**OS:** ${platform}\n**CPU:** ${totalCores} cores\n**Load Avg:** ${cpuUsage.toFixed(2)}\n**Arquitetura:** ${os.arch()}`,
                    inline: true
                },
                {
                    name: '📊 Métricas do Servidor',
                    value: `**Servidores:** ${status.totalGuilds}\n**Usuários:** ${status.totalUsers.toLocaleString()}\n**Canais:** ${client.channels.cache.size}\n**Emojis:** ${client.emojis.cache.size}`,
                    inline: true
                },
                {
                    name: '🛡️ Auto Moderação',
                    value: `**Próxima Execução:** ${status.nextAutoModTS ? `<t:${status.nextAutoModTS}:F>` : 'N/A'}\n**Última Execução:** ${status.lastRunTS ? `<t:${status.lastRunTS}:F>` : 'Nunca'}\n**Canal de Logs:** ${status.logChannel}`,
                    inline: false
                },
                {
                    name: `${healthEmoji} Health Score`,
                    value: `**${healthScore}/100**\n${this.getHealthRecommendations(healthScore, pingValue, memoryUsage)}`,
                    inline: false
                }
            )
            .setFooter({ text: `ID do Cluster: ${process.pid} • Gerado em tempo real`, iconURL: client.user?.displayAvatarURL() })
            .setTimestamp();
        
        return embed;
    }
    
    /**
     * Retorna recomendações baseadas no health score
     */
    static getHealthRecommendations(healthScore, ping, memory) {
        if (healthScore >= 80) {
            return '✅ Sistema saudável. Nenhuma ação necessária.';
        } else if (healthScore >= 50) {
            let recommendations = [];
            if (ping > 100) recommendations.push('• Latência elevada, verifique a conexão com Discord');
            if (memory > 300) recommendations.push('• Consumo de memória alto, considere reiniciar o bot');
            return `⚠️ Recomendações:\n${recommendations.join('\n')}`;
        } else {
            return '🔴 **AÇÃO URGENTE:**\n• Reinicie o bot imediatamente\n• Verifique logs de erro\n• Considere escalar recursos do servidor';
        }
    }
    
    // ==================== FUNÇÕES PRINCIPAIS ====================
    
    /**
     * Coleta informações detalhadas sobre a saúde do bot e do ciclo AutoMod.
     */
    static getBotStatus(client, guildId) {
        try {
            // 1. Verificação de Integridade do Client
            if (!client?.isReady()) {
                throw new Error("O Client do Discord não está pronto ou não foi inicializado.");
            }
            
            // 2. Cálculo de Uptime (Formatado para humanos)
            const uptimeMs = client.uptime || 0;
            const days = Math.floor(uptimeMs / 86400000);
            const hours = Math.floor((uptimeMs % 86400000) / 3600000);
            const minutes = Math.floor((uptimeMs % 3600000) / 60000);
            
            // 3. Previsão do Próximo Ciclo AutoMod (Lógica baseada em 12h BRT)
            const now = new Date();
            let nextRun = new Date();
            nextRun.setHours(12, 0, 0, 0);
            
            // Se já passou das 12h hoje, a próxima execução é amanhã
            if (now.getHours() >= 12) {
                nextRun.setDate(nextRun.getDate() + 1);
            }
            
            // Ajuste para fuso horário de Brasília (UTC-3)
            const brtOffset = -3 * 60;
            const nextRunBRT = new Date(nextRun.getTime() + (brtOffset * 60 * 1000));
            
            // 4. Métricas de Hardware & Network
            const usedMem = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
            const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
            const ping = client.ws?.ping > 0 ? `${client.ws.ping}ms` : "Calculando...";
            
            // 5. Dados do Servidor Atual (Guild-Specific)
            let guildData = {};
            try {
                guildData = ConfigSystem.getMany(guildId, ['log_channel', 'last_automod_run']);
            } catch (err) {
                console.error('❌ Erro ao buscar dados do servidor:', err);
                guildData = { log_channel: null, last_automod_run: null };
            }
            
            // 6. Contagem total de usuários (mais precisa)
            const totalUsers = client.guilds.cache.reduce((acc, g) => {
                return acc + (g.memberCount || g.approximateMemberCount || 0);
            }, 0);
            
            return {
                // Métricas do Bot
                uptime: `${days}d ${hours}h ${minutes}m`,
                uptimeMs: uptimeMs,
                ping: ping,
                memory: `${usedMem} MB / ${totalMem} GB`,
                memoryRaw: parseFloat(usedMem),
                
                // Ciclo AutoMod (Retornando em segundos para Timestamps do Discord)
                nextAutoModTS: Math.floor(nextRun.getTime() / 1000),
                nextAutoModBRT: nextRunBRT,
                lastRunTS: guildData.last_automod_run ? Math.floor(Number(guildData.last_automod_run) / 1000) : null,
                
                // Estatísticas Globais
                totalGuilds: client.guilds.cache.size,
                totalUsers: totalUsers,
                totalChannels: client.channels.cache.size,
                totalEmojis: client.emojis.cache.size,
                
                // Contexto Local
                logChannel: guildData.log_channel ? `<#${guildData.log_channel}>` : "⚠️ Não configurado",
                logChannelId: guildData.log_channel,
                guildName: client.guilds.cache.get(guildId)?.name || "Este Servidor",
                guildId: guildId,
                
                // Métricas de Hardware
                cpuLoad: os.loadavg()[0],
                cpuCores: os.cpus().length,
                platform: os.platform(),
                nodeVersion: process.version,
                
                // Timestamp atual para referência
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
    
    /**
     * Verifica se o sistema está saudável (retorna boolean)
     */
    static isSystemHealthy(client, guildId) {
        const status = this.getBotStatus(client, guildId);
        if (!status) return false;
        
        const pingValue = status.ping !== "Calculando..." ? parseInt(status.ping) : 100;
        const isPingOk = pingValue < 200;
        const isMemoryOk = status.memoryRaw < 500;
        
        return isPingOk && isMemoryOk;
    }
    
    /**
     * Retorna um resumo rápido do status (para logs)
     */
    static getQuickStatus(client, guildId) {
        const status = this.getBotStatus(client, guildId);
        if (!status) return "❌ Sistema indisponível";
        
        return `✅ Online | ${status.uptime} | ${status.ping} | ${status.memory}`;
    }
    
    /**
     * Gera relatório de performance para análise
     */
    static getPerformanceReport(client) {
        const startTime = process.hrtime();
        
        const report = {
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
        
        return report;
    }
}

module.exports = SystemStatus;