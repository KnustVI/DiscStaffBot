// src/systems/systemStatus.js
const ConfigSystem = require('./configSystem');
const ErrorLogger = require('./errorLogger');
const { AdvancedContainerBuilder, COLORS } = require('../utils/containerBuilder');
const os = require('os');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

let EMOJIS = {};
try {
    const emojisFile = require('../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

const statsCache = new Map();
const CACHE_TTL = 60000;

class SystemStatus {
    
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
                    // As mensagens desse painel são Components V2 — depois de
                    // deferUpdate(), `content` sozinho é rejeitado pelo Discord
                    // (erro 50035), precisa ir como container.
                    await interaction.editReply(new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                        .text(`${EMOJIS.circlealert || '❌'} Ação "${action}" não reconhecida.`).footer(interaction.guild?.name).build());
            }
        } catch (error) {
            console.error('❌ Erro no handleComponent:', error);
            await interaction.editReply(new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`${EMOJIS.circlealert || '❌'} Ocorreu um erro.`).footer(interaction.guild?.name).build());
        }
    }

    static async handleRefreshStatus(interaction) {
        const status = this.getBotStatus(interaction.client, interaction.guildId);
        if (!status) {
            return await interaction.editReply(new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`${EMOJIS.circlealert || '❌'} Erro ao obter status.`).footer(interaction.guild?.name).build());
        }
        
        const builder = this.generateStatusContainer(status, interaction.guild);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('status:refresh').setLabel(`${EMOJIS.refreshccw || '🔄'} Atualizar`).setStyle(ButtonStyle.Secondary)
        );
        
        const { components, flags } = builder.build();
        const replyData = { components, flags: [flags] };
        replyData.components.push(row);
        await interaction.editReply(replyData);
    }
    
    static async handleDetailedStatus(interaction, param) {
        const status = this.getBotStatus(interaction.client, interaction.guildId);
        if (!status) {
            return await interaction.editReply(new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`${EMOJIS.circlealert || '❌'} Erro ao obter status.`).footer(interaction.guild?.name).build());
        }
        const builder = this.generateDetailedStatusContainer(status, interaction.client, interaction.guild);
        const { components, flags } = builder.build();
        await interaction.editReply({ components, flags: [flags] });
    }
    
    static generateStatusContainer(status, guild) {
        let accentColor = COLORS.DEFAULT;
        if (status.ping !== "Calculando...") {
            const pingValue = parseInt(status.ping);
            if (pingValue < 100) accentColor = COLORS.SUCCESS;
            else if (pingValue > 200) accentColor = COLORS.ERROR;
        }
        
        const builder = new AdvancedContainerBuilder({ accentColor });
        builder.title(`${EMOJIS.gauge || '📊'} Status do Sistema`, 1);
        builder.text(`**${status.guildName}** • Sistema operando normalmente`);
        builder.separator();
        builder.text(`**${EMOJIS.robo || '🤖'} Bot**\n${EMOJIS.gauge || '📊'} Uptime: ${status.uptime}\n${EMOJIS.wifi || '📡'} Latência: ${status.ping}\n${EMOJIS.storage || '💾'} Memória: ${status.memory}`);
        builder.separator();
        builder.text(`**${EMOJIS.trendingup || '📈'} Estatísticas**\n🌐 Servidores: ${status.totalGuilds}\n${EMOJIS.users || '👥'} Usuários: ${status.totalUsers.toLocaleString()}\n${EMOJIS.filetext || '📝'} Logs: ${status.logChannel}`);
        builder.separator();
        const nextRunText = status.nextAutoModTS ? `${EMOJIS.clockalert || '⏰'} Próxima: <t:${status.nextAutoModTS}:R>` : `${EMOJIS.circlealert || '❌'} N/A`;
        const lastRunText = status.lastRunTS ? `${EMOJIS.clock || '🕐'} Última: <t:${status.lastRunTS}:R>` : `${EMOJIS.circlealert || '❌'} Nunca`;
        builder.text(`**${EMOJIS.shieldcheck || '🛡️'} Auto Moderação**\n${nextRunText}\n${lastRunText}`);
        builder.footer(guild?.name || status.guildName);

        return builder;
    }
    
    static generateDetailedStatusContainer(status, client, guild) {
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
        const detailAccentColor = healthScore >= 80 ? COLORS.SUCCESS : (healthScore >= 50 ? COLORS.DEFAULT : COLORS.ERROR);
        const builder = new AdvancedContainerBuilder({ accentColor: detailAccentColor });
        
        builder.title(`${EMOJIS.settings || '🔧'} Status Detalhado do Sistema`, 1);
        builder.separator();
        builder.text(`**${EMOJIS.robo || '🤖'} Bot**\n${EMOJIS.clock || '⏱️'} Uptime: ${status.uptime}\n${EMOJIS.wifi || '📡'} Latência: ${status.ping}\n${EMOJIS.storage || '💾'} Memória: ${status.memory}\n🟢 Node: ${nodeVersion}\n📦 DJS: v${discordVersion}`);
        builder.separator();
        builder.text(`**${EMOJIS.terminal || '💻'} Sistema**\n${EMOJIS.tv || '🖥️'} OS: ${platform}\n🧠 CPU: ${totalCores} cores\n${EMOJIS.gauge || '⚙️'} Load: ${cpuUsage.toFixed(2)}\n🏛️ Arquitetura: ${os.arch()}`);
        builder.separator();
        builder.text(`**${EMOJIS.gauge || '📊'} Métricas**\n🌐 Servidores: ${status.totalGuilds}\n${EMOJIS.users || '👥'} Usuários: ${status.totalUsers.toLocaleString()}\n${EMOJIS.messagecircle || '💬'} Canais: ${client.channels.cache.size}\n😀 Emojis: ${client.emojis.cache.size}`);
        builder.separator();
        const nextRunFull = status.nextAutoModTS ? `<t:${status.nextAutoModTS}:F>` : 'N/A';
        const lastRunFull = status.lastRunTS ? `<t:${status.lastRunTS}:F>` : 'Nunca';
        builder.text(`**${EMOJIS.shieldcheck || '🛡️'} Auto Moderação**\n${EMOJIS.clockalert || '⏰'} Próxima: ${nextRunFull}\n${EMOJIS.clock || '🕐'} Última: ${lastRunFull}\n${EMOJIS.filetext || '📝'} Logs: ${status.logChannel}`);
        builder.separator();
        
        let healthMessage = '';
        if (healthScore >= 80) {
            healthMessage = `${EMOJIS.circlecheck || '✅'} Sistema saudável. Nenhuma ação necessária.`;
        } else if (healthScore >= 50) {
            let recommendations = [];
            if (pingValue > 100) recommendations.push('• Latência elevada, verifique a conexão');
            if (memoryUsage > 300) recommendations.push('• Consumo de memória alto, reinicie o bot');
            healthMessage = `${EMOJIS.trianglealert || '⚠️'} Recomendações:\n${recommendations.join('\n')}`;
        } else {
            healthMessage = `${EMOJIS.siren || '🔴'} **AÇÃO URGENTE:**\n• Reinicie o bot imediatamente\n• Verifique os logs\n• Escale recursos do servidor`;
        }
        
        builder.text(`${healthEmoji} **Health Score: ${healthScore}/100**\n${healthMessage}`);
        builder.footer(guild?.name || status.guildName);

        return builder;
    }
    
    static getBotStatus(client, guildId) {
        try {
            if (!client?.isReady()) throw new Error("O Client do Discord não está pronto.");
            
            const uptimeMs = client.uptime || 0;
            const days = Math.floor(uptimeMs / 86400000);
            const hours = Math.floor((uptimeMs % 86400000) / 3600000);
            const minutes = Math.floor((uptimeMs % 3600000) / 60000);
            
            const now = new Date();
            let nextRun = new Date();
            nextRun.setHours(12, 0, 0, 0);
            if (now.getHours() >= 12) nextRun.setDate(nextRun.getDate() + 1);
            
            const usedMem = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
            const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
            const ping = client.ws?.ping > 0 ? `${client.ws.ping}ms` : "Calculando...";
            
            let guildData = {};
            try {
                guildData = ConfigSystem.getMany(guildId, ['log_channel', 'last_automod_run']);
            } catch (err) {
                guildData = { log_channel: null, last_automod_run: null };
            }
            
            const totalUsers = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || g.approximateMemberCount || 0), 0);
            
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
                logChannel: guildData.log_channel ? `<#${guildData.log_channel}>` : `${EMOJIS.circlealert || '⚠️'} Não configurado`,
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
            console.error('❌ Erro ao obter status:', err);
            return null;
        }
    }
    
    // ==================== MÉTODO ADICIONADO ====================
    
    static isSystemHealthy(client, guildId) {
        const status = this.getBotStatus(client, guildId);
        if (!status) return false;
        
        const pingValue = status.ping !== "Calculando..." ? parseInt(status.ping) : 100;
        const isPingOk = pingValue < 200;
        const isMemoryOk = status.memoryRaw < 500;
        
        return isPingOk && isMemoryOk;
    }
}

module.exports = SystemStatus;