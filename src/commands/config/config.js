const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    RoleSelectMenuBuilder, 
    ChannelSelectMenuBuilder, 
    ChannelType 
} = require('discord.js');
const db = require('../../database/index');
const SessionManager = require('../../utils/sessionManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Painel de configuração do sistema de integridade.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

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
            // 1. VERIFICAR PERMISSÕES (segurança extra)
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Permissão Negada')
                    .setDescription('Apenas administradores podem configurar o sistema.')
                    .setTimestamp();
                
                return await interaction.editReply({ embeds: [errorEmbed] });
            }
            
            // 2. GARANTIR QUE USUÁRIO E GUILD EXISTEM NO BANCO
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            // 3. OBTER SISTEMAS
            const ConfigSystem = require('../../systems/configSystem');
            
            // 4. CRIAR SESSÃO PARA CONTROLE DE CONFIGURAÇÃO (contexto completo)
            SessionManager.set(
                user.id,
                guildId,
                'config_panel',
                { 
                    timestamp: Date.now(),
                    userId: user.id,
                    guildId: guildId
                },
                300000 // 5 minutos de sessão
            );
            
            // 5. COLETAR CONFIGURAÇÕES ATUAIS (Cache-first)
            const staffRole = ConfigSystem.getSetting(guildId, 'staff_role');
            const logChannel = ConfigSystem.getSetting(guildId, 'log_channel');
            const strikeRole = ConfigSystem.getSetting(guildId, 'strike_role');
            const automodEnabled = ConfigSystem.getSetting(guildId, 'automod_enabled') === 'true';
            const exemplarLimit = ConfigSystem.getSetting(guildId, 'limit_exemplar') || '95';
            const problematicLimit = ConfigSystem.getSetting(guildId, 'limit_problematico') || '30';
            
            // 6. OBTER ESTATÍSTICAS PARA EXIBIR NO PAINEL
            const totalPunishments = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ?`).get(guildId)?.count || 0;
            const totalUsers = db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM reputation WHERE guild_id = ?`).get(guildId)?.count || 0;
            
            // 7. CONSTRUÇÃO DO EMBED PRINCIPAL
            const embed = new EmbedBuilder()
                .setTitle(`${emojis.SETTINGS || '⚙️'} Configuração do Servidor`)
                .setColor(0xDCA15E) // Mantendo cor padrão do sistema
                .setDescription('Selecione abaixo os cargos e canais que o bot deve utilizar para o sistema de reputação.')
                .addFields(
                    { 
                        name: '🛡️ Cargo Staff', 
                        value: staffRole ? `<@&${staffRole}>` : '`❌ Não definido`', 
                        inline: true 
                    },
                    { 
                        name: '📜 Canal de Logs', 
                        value: logChannel ? `<#${logChannel}>` : '`❌ Não definido`', 
                        inline: true 
                    },
                    { 
                        name: '⚠️ Cargo de Strike', 
                        value: strikeRole ? `<@&${strikeRole}>` : '`❌ Não definido`', 
                        inline: true 
                    },
                    { 
                        name: '🛡️ Auto Moderação', 
                        value: automodEnabled ? '✅ Ativada' : '❌ Desativada', 
                        inline: true 
                    },
                    { 
                        name: '🎖️ Limite Exemplar', 
                        value: `\`${exemplarLimit} pontos\``, 
                        inline: true 
                    },
                    { 
                        name: '⚠️ Limite Problemático', 
                        value: `\`${problematicLimit} pontos\``, 
                        inline: true 
                    },
                    { 
                        name: '📊 Estatísticas do Servidor', 
                        value: [
                            `**Total de Punições:** \`${totalPunishments}\``,
                            `**Usuários Penalizados:** \`${totalUsers}\``
                        ].join('\n'), 
                        inline: false 
                    }
                )
                .setFooter({ 
                    text: ConfigSystem.getFooter(guild.name).text,
                    iconURL: ConfigSystem.getFooter(guild.name).iconURL
                })
                .setTimestamp();
            
            // 8. COMPONENTES DE SELEÇÃO (customIds padronizados)
            // Menu para selecionar Cargo Staff
            const staffRow = new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId('config:set:staff_role')
                    .setPlaceholder('Selecionar Cargo de Moderadores')
            );
            
            // Menu para selecionar Canal de Logs
            const logRow = new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('config:set:log_channel')
                    .setPlaceholder('Selecionar Canal de Logs')
                    .addChannelTypes(ChannelType.GuildText)
            );
            
            // Menu para selecionar Cargo de Punidos (Strike)
            const strikeRow = new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId('config:set:strike_role')
                    .setPlaceholder('Selecionar Cargo de Strike')
            );
            
            // 9. REGISTRAR ATIVIDADE NO LOG
            const activityId = db.logActivity(
                guildId,
                user.id,
                'config_panel_open',
                null,
                { 
                    command: 'config',
                    responseTime: Date.now() - startTime,
                    currentConfig: {
                        staffRole: staffRole || null,
                        logChannel: logChannel || null,
                        strikeRole: strikeRole || null,
                        automodEnabled,
                        exemplarLimit,
                        problematicLimit
                    }
                }
            );
            
            // 10. ATUALIZAR ANALYTICS DO STAFF (se for staff/administrador)
            await AnalyticsSystem.updateStaffAnalytics(guildId, user.id);
            
            // 11. RESPOSTA FINAL
            await interaction.editReply({
                embeds: [embed],
                components: [staffRow, logRow, strikeRow]
            });
            
            // Log silencioso de performance
            console.log(`📊 [CONFIG] Painel aberto por ${user.tag} em ${guild.name} | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            // 12. TRATAMENTO DE ERRO COM LOG DETALHADO
            console.error('❌ Erro no comando config:', error);
            
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
                    command: 'config',
                    error: error.message,
                    stack: error.stack
                }
            );
            
            // Limpar sessão em caso de erro
            SessionManager.delete(user.id, guildId, 'config_panel');
            
            // Resposta de erro amigável
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro ao abrir painel de configuração')
                .setDescription('Ocorreu um erro interno ao carregar o painel de configuração. A equipe de staff foi notificada.')
                .addFields(
                    { name: 'Código do Erro', value: `\`${error.message?.slice(0, 100) || 'Desconhecido'}\``, inline: false }
                )
                .setFooter({ text: 'Caso persista, contate um administrador.' })
                .setTimestamp();
            
            await interaction.editReply({ 
                embeds: [errorEmbed],
                components: [],
                content: null
            }).catch(() => null);
        }
    }
};