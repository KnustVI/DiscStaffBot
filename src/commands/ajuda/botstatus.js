const { SlashCommandBuilder, EmbedBuilder, version } = require('discord.js');
const db = require('../../database/index');
const SystemStatus = require('../../systems/systemStatus');
const AnalyticsSystem = require('../../systems/analyticsSystem');
const ResponseManager = require('../../utils/responseManager');
const EmbedFormatter = require('../../utils/embedFormatter');

// ID do desenvolvedor (dono do bot)
const DEVELOPER_ID = '203676076189286412';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botstatus')
        .setDescription('Verifica o estado de saúde do bot e do AutoMod.'),

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
            const activeTickets = db.prepare(`SELECT COUNT(*) as count FROM tickets WHERE guild_id = ? AND status = 'open'`).get(guildId)?.count || 0;
            
            // Verificar saúde
            const isHealthy = SystemStatus.isSystemHealthy(client, guildId);
            const healthEmoji = isHealthy ? '🟢' : '🔴';
            const healthStatus = isHealthy ? 'Saudável' : 'Crítico - Verifique os logs';
            
            // Buscar última mensagem do log de automod
            let lastLogLink = '`❌ Não definido`';
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
                        lastLogLink = `Canal não encontrado`;
                    }
                } catch (err) {
                    lastLogLink = `Erro ao buscar`;
                }
            }
            
            // Título em description com #
            const description = `# ${emojis.panel || '🖥️'} Painel de Controle do Bot`;
            
            const embed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setDescription(description)
                .setThumbnail(client.user.displayAvatarURL())
                .setTimestamp();
            
            // Fields organizados
            embed.addFields(
                { 
                    name: `${emojis.global || '🌐'} Status Global`, 
                    value: `**Servidores:** ${status.totalGuilds}\n**Usuários:** ${status.totalUsers.toLocaleString('pt-BR')}\n**Uptime:** ${status.uptime}\n**Latência:** ${status.ping}`,
                    inline: true 
                }
            );
            
            // Só mostra Hardware se for o desenvolvedor
            if (isDeveloper) {
                embed.addFields({ 
                    name: `${emojis.stack || '📦'} Hardware & Sistema`, 
                    value: `**RAM:** ${status.memory}\n**Node:** ${process.version}\n**DJS:** v${version}\n**CPU Load:** ${status.cpuLoad?.toFixed(2) || 'N/A'}`,
                    inline: true 
                });
            }
            
            embed.addFields(
                { 
                    name: `${emojis.database || '🗄️'} Banco de Dados`, 
                    value: `**Tamanho:** ${dbStats?.fileSize || 'N/A'}\n**Tabelas:** ${Object.keys(dbStats?.tables || {}).length}\n**Punições:** ${dbStats?.tables?.punishments || 0}\n**Tickets Ativos:** ${activeTickets}`,
                    inline: true 
                },
                { 
                    name: `${emojis.AutoMod || '🛡️'} Sistema AutoMod`, 
                    value: `**Próximo Ciclo:** <t:${status.nextAutoModTS}:R>\n**Última Execução:** ${status.lastRunTS ? `<t:${status.lastRunTS}:f>` : 'Nenhum registro'}\n**Logs:** ${lastLogLink}\n**Health:** ${healthEmoji} ${healthStatus}`,
                    inline: false 
                }
            );
            
            embed.setFooter(EmbedFormatter.getFooter(guild.name));
            
            // Registrar atividade
            db.logActivity(guildId, user.id, 'status_command', null, {
                command: 'botstatus', responseTime: Date.now() - startTime,
                systemHealth: isHealthy, totalPunishments, activeTickets
            });
            
            await ResponseManager.send(interaction, { embeds: [embed] });
            
            console.log(`📊 [BOTSTATUS] ${user.tag} em ${guild.name} | ${Date.now() - startTime}ms`);

        } catch (error) {
            console.error('❌ Erro no botstatus:', error);
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao gerar relatório de status.');
        }
    }
};