// /home/ubuntu/DiscStaffBot/src/commands/utility/botstatus.js
const { SlashCommandBuilder, PermissionFlagsBits, version } = require('discord.js');
const db = require('../../database/index');
const SystemStatus = require('../../systems/systemStatus');
const AnalyticsSystem = require('../../systems/analyticsSystem');
const ResponseManager = require('../../utils/responseManager');
const ContainerFormatter = require('../../utils/ContainerFormatter');

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
            
            builder.title(`${emojis.panel || '🖥️'} Painel de Controle do Bot`, 1);
            builder.line();
            builder.title(`${emojis.global || '🌐'} Status Global`, 2);
            builder.text(`Servidores: ${status.totalGuilds}`);
            builder.text(`Usuários: ${status.totalUsers.toLocaleString('pt-BR')}`);
            builder.text(`Uptime: ${status.uptime}`);
            builder.text(`Latência: ${status.ping}`);
            builder.line();
            
            if (isDeveloper) {
                builder.title(`${emojis.stack || '📦'} Hardware & Sistema`, 2);
                builder.text(`RAM: ${status.memory}`);
                builder.text(`Node: ${process.version}`);
                builder.text(`DJS: v${version}`);
                builder.text(`CPU Load: ${status.cpuLoad?.toFixed(2) || 'N/A'}`);
                builder.line();
            }
            
            builder.title(`${emojis.database || '🗄️'} Banco de Dados`, 2);
            builder.text(`Tamanho: ${dbStats?.fileSize || 'N/A'}`);
            builder.text(`Tabelas: ${Object.keys(dbStats?.tables || {}).length}`);
            builder.text(`Punições: ${totalPunishments}`);
            builder.text(`${emojis.user || '👥'} Penalizados: ${totalUsers}`);
            builder.text(`${emojis.star || '⭐'} Média: ${Math.round(avgReputation)}/100`);
            builder.text(`${emojis.strike || '⚠️'} 30d: ${recentStrikes}`);
            builder.line();
            
            builder.title(`${emojis.AutoMod || '🛡️'} Sistema AutoMod`, 2);
            builder.text(`Próximo Ciclo: <t:${status.nextAutoModTS}:R>`);
            builder.text(`Última Execução: ${status.lastRunTS ? `<t:${status.lastRunTS}:f>` : 'Nenhum registro'}`);
            builder.text(`Logs: ${lastLogLink}`);
            builder.text(`Health: ${healthEmoji} ${healthStatus}`);
            builder.footer();
            
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