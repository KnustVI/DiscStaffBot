const { SlashCommandBuilder, EmbedBuilder, version } = require('discord.js');
const db = require('../../database/index');
const SystemStatus = require('../../systems/systemStatus');
const AnalyticsSystem = require('../../systems/analyticsSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botstatus')
        .setDescription('Verifica o estado de saúde do bot e do AutoMod.'),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     * @param {import('discord.js').Client} client 
     */
    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, user, member } = interaction;
        const guildId = guild.id;
        
        // Obter emojis do sistema (se existirem)
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        try {
            // 1. GARANTIR QUE USUÁRIO E GUILD EXISTEM NO BANCO
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            // 2. OBTER CONFIGURAÇÕES DO SERVIDOR
            const ConfigSystem = require('../../systems/configSystem');
            const footerText = ConfigSystem.getSetting(guildId, 'footer_text') || guild.name;
            const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
            
            // 3. COLETA DE DADOS VIA SYSTEM STATUS (já refatorado)
            const status = SystemStatus.getBotStatus(client, guildId);
            
            if (!status) {
                // Registrar erro no banco
                db.logActivity(
                    guildId,
                    user.id,
                    'error',
                    null,
                    { 
                        command: 'botstatus',
                        error: 'Falha ao coletar dados do sistema'
                    }
                );
                
                return await interaction.editReply({ 
                    content: `${emojis.ERRO || '❌'} Erro ao coletar dados do sistema. Verifique os logs.`
                });
            }
            
            // 4. OBTER ESTATÍSTICAS ADICIONAIS DO BANCO
            const dbStats = db.getStats();
            const totalPunishments = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ?`).get(guildId)?.count || 0;
            const activeTickets = db.prepare(`SELECT COUNT(*) as count FROM tickets WHERE guild_id = ? AND status = 'open'`).get(guildId)?.count || 0;
            
            // 5. VERIFICAR SAÚDE DO SISTEMA
            const isHealthy = SystemStatus.isSystemHealthy(client, guildId);
            const healthEmoji = isHealthy ? '🟢' : '🔴';
            const healthStatus = isHealthy ? 'Saudável' : 'Crítico - Verifique os logs';
            
            // 6. CONSTRUÇÃO DA UI
            const embed = new EmbedBuilder()
                .setTitle(`${emojis.PAINEL || '🖥️'} Painel de Controle do Bot`)
                .setColor(0xDCA15E)
                .setThumbnail(client.user.displayAvatarURL())
                .addFields(
                    { 
                        name: `${emojis.BOT || '🤖'} Status Global`, 
                        value: [
                            `**Servidores:** \`${status.totalGuilds}\``,
                            `**Usuários:** \`${status.totalUsers.toLocaleString('pt-BR')}\``,
                            `**Uptime:** \`${status.uptime}\``,
                            `**Latência:** \`${status.ping}\``
                        ].join('\n'), 
                        inline: true 
                    },
                    { 
                        name: `${emojis.INFRA || '📦'} Hardware & Sistema`, 
                        value: [
                            `**RAM:** \`${status.memory}\``,
                            `**Node:** \`${process.version}\``,
                            `**DJS:** \`v${version}\``,
                            `**CPU Load:** \`${status.cpuLoad?.toFixed(2) || 'N/A'}\``
                        ].join('\n'), 
                        inline: true 
                    },
                    { 
                        name: `${emojis.DATABASE || '🗄️'} Banco de Dados`, 
                        value: [
                            `**Tamanho:** \`${dbStats?.fileSize || 'N/A'}\``,
                            `**Tabelas:** \`${Object.keys(dbStats?.tables || {}).length}\``,
                            `**Registros:** \`${dbStats?.tables?.punishments || 0} punições\``,
                            `**Tickets Ativos:** \`${activeTickets}\``
                        ].join('\n'), 
                        inline: true 
                    },
                    { 
                        name: `${emojis.AUTO_MOD || '🛡️'} Contexto Local: ${guild.name}`, 
                        value: [
                            `**Próximo Ciclo:** <t:${status.nextAutoModTS}:R>`,
                            `**Última Execução:** ${status.lastRunTS ? `<t:${status.lastRunTS}:f>` : '`Nenhum registro`'}`,
                            `**Logs:** ${status.logChannel !== "⚠️ Não configurado" ? status.logChannel : '`⚠️ Não definido`'}`,
                            `**Punições no Servidor:** \`${totalPunishments}\``,
                            `**Health:** ${healthEmoji} \`${healthStatus}\``
                        ].join('\n'), 
                        inline: false 
                    }
                )
                .setFooter({ 
                    text: footerText,
                    iconURL: guild.iconURL() || client.user.displayAvatarURL()
                })
                .setTimestamp();
            
            // 7. REGISTRAR ATIVIDADE NO LOG
            const activityId = db.logActivity(
                guildId,
                user.id,
                'status_command',
                null,
                { 
                    command: 'botstatus',
                    responseTime: Date.now() - startTime,
                    systemHealth: isHealthy,
                    totalPunishments,
                    activeTickets
                }
            );
            
            // 8. ATUALIZAR ANALYTICS DO STAFF (se o usuário for staff)
            if (staffRoleId && member.roles.cache.has(staffRoleId)) {
                await AnalyticsSystem.updateStaffAnalytics(guildId, user.id);
            }
            
            // 9. RESPOSTA FINAL
            await interaction.editReply({ embeds: [embed] });
            
            // Log silencioso de performance
            console.log(`📊 [BOTSTATUS] Executado por ${user.tag} em ${guild.name} | ${Date.now() - startTime}ms`);

        } catch (error) {
            // 10. TRATAMENTO DE ERRO COM LOG DETALHADO
            console.error('❌ Erro no comando botstatus:', error);
            
            // Registrar erro no sistema de logs
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            // Registrar no banco
            db.logActivity(
                guildId,
                user.id,
                'error',
                null,
                { 
                    command: 'botstatus',
                    error: error.message,
                    stack: error.stack
                }
            );
            
            // Resposta de erro amigável
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro ao gerar relatório')
                .setDescription('Ocorreu um erro interno ao gerar o relatório de status. A equipe de staff foi notificada.')
                .addFields(
                    { name: 'Código do Erro', value: `\`${error.message?.slice(0, 100) || 'Desconhecido'}\``, inline: false }
                )
                .setFooter({ text: 'Caso persista, contate um administrador.' })
                .setTimestamp();
            
            await interaction.editReply({ 
                embeds: [errorEmbed],
                content: null
            }).catch(() => null);
        }
    }
};