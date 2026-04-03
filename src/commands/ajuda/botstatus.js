const { SlashCommandBuilder, EmbedBuilder, version } = require('discord.js');
const db = require('../../database/index');
const SystemStatus = require('../../systems/systemStatus');
const AnalyticsSystem = require('../../systems/analyticsSystem');
const ResponseManager = require('../../utils/responseManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botstatus')
        .setDescription('Verifica o estado de saúde do bot e do AutoMod.'),

    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, user, member } = interaction;
        const guildId = guild.id;
        
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        try {
            // Garantir registros no banco
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            const ConfigSystem = require('../../systems/configSystem');
            const footerText = ConfigSystem.getSetting(guildId, 'footer_text') || guild.name;
            const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
            
            // Coletar status do sistema
            const status = SystemStatus.getBotStatus(client, guildId);
            
            if (!status) {
                db.logActivity(guildId, user.id, 'error', null, { 
                    command: 'botstatus', error: 'Falha ao coletar dados'
                });
                return await ResponseManager.error(interaction, 'Erro ao coletar dados do sistema.');
            }
            
            // Estatísticas adicionais
            const dbStats = db.getStats();
            const totalPunishments = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ?`).get(guildId)?.count || 0;
            const activeTickets = db.prepare(`SELECT COUNT(*) as count FROM tickets WHERE guild_id = ? AND status = 'open'`).get(guildId)?.count || 0;
            
            // Verificar saúde
            const isHealthy = SystemStatus.isSystemHealthy(client, guildId);
            const healthEmoji = isHealthy ? '🟢' : '🔴';
            const healthStatus = isHealthy ? 'Saudável' : 'Crítico - Verifique os logs';
            
            // Construir embed
            const embed = new EmbedBuilder()
                .setTitle(`${emojis.panel || '🖥️'} Painel de Controle do Bot`)
                .setColor(0xDCA15E)
                .setThumbnail(client.user.displayAvatarURL())
                .addFields(
                    { 
                        name: `${emojis.global || '🤖'} Status Global`, 
                        value: [
                            `**Servidores:** \`${status.totalGuilds}\``,
                            `**Usuários:** \`${status.totalUsers.toLocaleString('pt-BR')}\``,
                            `**Uptime:** \`${status.uptime}\``,
                            `**Latência:** \`${status.ping}\``
                        ].join('\n'), 
                        inline: true 
                    },
                    { 
                        name: `${emojis.stack || '📦'} Hardware & Sistema`, 
                        value: [
                            `**RAM:** \`${status.memory}\``,
                            `**Node:** \`${process.version}\``,
                            `**DJS:** \`v${version}\``,
                            `**CPU Load:** \`${status.cpuLoad?.toFixed(2) || 'N/A'}\``
                        ].join('\n'), 
                        inline: true 
                    },
                    { 
                        name: `${emojis.database || '🗄️'} Banco de Dados`, 
                        value: [
                            `**Tamanho:** \`${dbStats?.fileSize || 'N/A'}\``,
                            `**Tabelas:** \`${Object.keys(dbStats?.tables || {}).length}\``,
                            `**Punições:** \`${dbStats?.tables?.punishments || 0}\``,
                            `**Tickets Ativos:** \`${activeTickets}\``
                        ].join('\n'), 
                        inline: true 
                    },
                    { 
                        name: `${emojis.AutoMod || '🛡️'} Contexto Local: ${guild.name}`, 
                        value: [
                            `**Próximo Ciclo:** <t:${status.nextAutoModTS}:R>`,
                            `**Última Execução:** ${status.lastRunTS ? `<t:${status.lastRunTS}:f>` : '`Nenhum registro`'}`,
                            `**Logs:** ${status.logChannel !== "⚠️ Não configurado" ? status.logChannel : '`⚠️ Não definido`'}`,
                            `**Punições:** \`${totalPunishments}\``,
                            `**Health:** ${healthEmoji} \`${healthStatus}\``
                        ].join('\n'), 
                        inline: false 
                    }
                )
                .setFooter({ text: footerText, iconURL: guild.iconURL() || client.user.displayAvatarURL() })
                .setTimestamp();
            
            // Registrar atividade
            db.logActivity(guildId, user.id, 'status_command', null, {
                command: 'botstatus', responseTime: Date.now() - startTime,
                systemHealth: isHealthy, totalPunishments, activeTickets
            });
            
            // Atualizar analytics se for staff
            if (staffRoleId && member.roles.cache.has(staffRoleId)) {
                await AnalyticsSystem.updateStaffAnalytics(guildId, user.id);
            }
            
            // Resposta final usando ResponseManager
            await ResponseManager.send(interaction, { embeds: [embed] });
            
            console.log(`📊 [BOTSTATUS] ${user.tag} em ${guild.name} | ${Date.now() - startTime}ms`);

        } catch (error) {
            console.error('❌ Erro no botstatus:', error);
            
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            db.logActivity(guildId, user.id, 'error', null, { 
                command: 'botstatus', error: error.message
            });
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro ao gerar relatório')
                .setDescription('Ocorreu um erro interno. A equipe foi notificada.')
                .addFields({ name: 'Código do Erro', value: `\`${error.message?.slice(0, 100) || 'Desconhecido'}\`` })
                .setFooter({ text: 'Caso persista, contate um administrador.' })
                .setTimestamp();
            
            await ResponseManager.send(interaction, { embeds: [errorEmbed] });
        }
    }
};