// /home/ubuntu/DiscStaffBot/src/commands/utility/botstatus.js
const { SlashCommandBuilder, PermissionFlagsBits, version } = require('discord.js');
const db = require('../../database/index');
const SystemStatus = require('../../systems/systemStatus');
const AnalyticsSystem = require('../../systems/analyticsSystem');
const ResponseManager = require('../../utils/responseManager');
const ContainerFormatter = require('../../utils/containerFormatter');

const DEVELOPER_ID = '203676076189286412';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botstatus')
        .setDescription('Verifica o estado de saúde do bot e do AutoMod.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, user, member } = interaction;
        const guildId = guild.id;
        const isDeveloper = user.id === DEVELOPER_ID;
        
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {}
        
        try {
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            const ConfigSystem = require('../../systems/configSystem');
            const status = SystemStatus.getBotStatus(client, guildId);
            
            if (!status) {
                return await ResponseManager.error(interaction, 'Erro ao coletar dados do sistema.');
            }
            
            const dbStats = db.getStats();
            
            const totalPunishments = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ?`).get(guildId)?.count || 0;
            const totalUsers = db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM reputation WHERE guild_id = ?`).get(guildId)?.count || 0;
            const avgReputation = db.prepare(`SELECT AVG(points) as avg FROM reputation WHERE guild_id = ?`).get(guildId)?.avg || 100;
            const recentStrikes = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ? AND created_at > ?`).get(guildId, Date.now() - (30 * 24 * 60 * 60 * 1000))?.count || 0;
            
            const isHealthy = SystemStatus.isSystemHealthy(client, guildId);
            const healthEmoji = isHealthy ? '🟢' : '🔴';
            const healthStatus = isHealthy ? 'Saudável' : 'Crítico - Verifique os logs';
            
            let lastLogLink = `${emojis.Error || '❌'} Não definido`;
            const logAutomodId = ConfigSystem.getSetting(guildId, 'log_automod');
            if (logAutomodId) {
                try {
                    const logChannel = await guild.channels.fetch(logAutomodId).catch(() => null);
                    if (logChannel) {
                        const messages = await logChannel.messages.fetch({ limit: 1 }).catch(() => null);
                        if (messages && messages.first()) {
                            lastLogLink = `[Última mensagem](${messages.first().url})`;
                        } else {
                            lastLogLink = `<#${logAutomodId}> (sem mensagens)`;
                        }
                    } else {
                        lastLogLink = `${emojis.Error || '❌'} Canal não encontrado`;
                    }
                } catch (err) {
                    lastLogLink = `${emojis.Error || '❌'} Erro ao buscar`;
                }
            }
            
            const builder = ContainerFormatter.create(guild.name, 0xDCA15E);
            
            builder.addTitle(`${emojis.panel || '🖥️'} Painel de Controle do Bot`, 1);
            builder.addSeparator();
            builder.addTitle(`${emojis.global || '🌐'} Status Global`, 2);
            builder.addText(`Servidores: ${status.totalGuilds}`);
            builder.addText(`Usuários: ${status.totalUsers.toLocaleString('pt-BR')}`);
            builder.addText(`Uptime: ${status.uptime}`);
            builder.addText(`Latência: ${status.ping}`);
            builder.addSeparator();
            
            if (isDeveloper) {
                builder.addTitle(`${emojis.stack || '📦'} Hardware & Sistema`, 2);
                builder.addText(`RAM: ${status.memory}`);
                builder.addText(`Node: ${process.version}`);
                builder.addText(`DJS: v${version}`);
                builder.addText(`CPU Load: ${status.cpuLoad?.toFixed(2) || 'N/A'}`);
                builder.addSeparator();
            }
            
            builder.addTitle(`${emojis.database || '🗄️'} Banco de Dados`, 2);
            builder.addText(`Tamanho: ${dbStats?.fileSize || 'N/A'}`);
            builder.addText(`Tabelas: ${Object.keys(dbStats?.tables || {}).length}`);
            builder.addText(`Punições: ${totalPunishments}`);
            builder.addText(`${emojis.user || '👥'} Penalizados: ${totalUsers}`);
            builder.addText(`${emojis.star || '⭐'} Média: ${Math.round(avgReputation)}/100`);
            builder.addText(`${emojis.strike || '⚠️'} 30d: ${recentStrikes}`);
            builder.addSeparator();
            
            builder.addTitle(`${emojis.AutoMod || '🛡️'} Sistema AutoMod`, 2);
            builder.addText(`Próximo Ciclo: <t:${status.nextAutoModTS}:R>`);
            builder.addText(`Última Execução: ${status.lastRunTS ? `<t:${status.lastRunTS}:f>` : 'Nenhum registro'}`);
            builder.addText(`Logs: ${lastLogLink}`);
            builder.addText(`Health: ${healthEmoji} ${healthStatus}`);
            builder.addFooter();
            
            db.logActivity(guildId, user.id, 'status_command', null, {
                command: 'botstatus', responseTime: Date.now() - startTime,
                systemHealth: isHealthy, totalPunishments
            });
            
            await interaction.editReply({
                components: [builder.build()],
                flags: ['IsComponentsV2']
            });
            
            console.log(`📊 [BOTSTATUS] ${user.tag} em ${guild.name} | ${Date.now() - startTime}ms`);

        } catch (error) {
            console.error('❌ Erro no botstatus:', error);
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao gerar relatório de status.');
        }
    }
};