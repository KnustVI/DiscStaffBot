const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const SessionManager = require('../../utils/sessionManager');
const PunishmentSystem = require('../../systems/punishmentSystem');
const AnalyticsSystem = require('../../systems/analyticsSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Consulta a reputação e punições de um usuário.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a consultar').setRequired(true)),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     * @param {import('discord.js').Client} client 
     */
    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, user, options } = interaction;
        const guildId = guild.id;
        const target = options.getUser('usuario');
        
        // Obter emojis do sistema (se existirem)
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        try {
            // 1. VALIDAR SE O USUÁRIO EXISTE
            if (!target) {
                return await interaction.editReply({ 
                    content: `${emojis.ERRO || '❌'} Usuário não encontrado.`
                });
            }
            
            // 2. GARANTIR QUE USUÁRIO E GUILD EXISTEM NO BANCO
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            db.ensureUser(target.id, target.username, target.discriminator, target.avatar);
            
            // 3. OBTER CONFIGURAÇÕES DO SERVIDOR
            const ConfigSystem = require('../../systems/configSystem');
            const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
            
            // 4. BUSCAR HISTÓRICO DO USUÁRIO
            const history = await PunishmentSystem.getUserHistory(guildId, target.id, 1);
            
            // 5. BUSCAR DADOS ADICIONAIS DO USUÁRIO
            const userData = await PunishmentSystem.getUserData(guildId, target.id);
            const totalStrikes = userData.totalStrikes;
            const lastPunishments = userData.lastPunishments;
            
            // 6. VERIFICAR SE O USUÁRIO TEM REGISTROS
            if (!history || history.totalRecords === 0) {
                // Registrar consulta sem registros
                db.logActivity(
                    guildId,
                    user.id,
                    'history_view',
                    target.id,
                    { 
                        command: 'historico',
                        hasRecords: false,
                        responseTime: Date.now() - startTime
                    }
                );
                
                const noRecordsEmbed = new EmbedBuilder()
                    .setColor(0xDCA15E)
                    .setTitle(`${emojis.CHECK || '✅'} Histórico de ${target.username}`)
                    .setDescription(`**${target.username}** não possui registros de punição.`)
                    .addFields(
                        { 
                            name: '⭐ Reputação', 
                            value: `\`${history?.reputation || 100}/100\``, 
                            inline: true 
                        },
                        { 
                            name: '📊 Total de Strikes', 
                            value: `\`0\``, 
                            inline: true 
                        }
                    )
                    .setFooter({ 
                        text: `Consultado por ${user.tag}`, 
                        iconURL: user.displayAvatarURL() 
                    })
                    .setTimestamp();
                
                return await interaction.editReply({ embeds: [noRecordsEmbed] });
            }
            
            // 7. CRIAR SESSÃO COM CONTEXTO COMPLETO (userId_guildId_action)
            SessionManager.set(
                user.id,
                guildId,
                'history',
                { 
                    targetId: target.id,
                    targetTag: target.tag,
                    currentPage: 1,
                    totalPages: history.totalPages,
                    timestamp: Date.now()
                },
                600000 // 10 minutos de sessão
            );
            
            // 8. GERAR UI USANDO O PUNISHMENT SYSTEM (já refatorado)
            const embed = PunishmentSystem.generateHistoryEmbed(target, history, 1);
            const components = PunishmentSystem.generateHistoryButtons(target.id, 1, history.totalPages);
            
            // 9. REGISTRAR ATIVIDADE NO LOG
            const activityId = db.logActivity(
                guildId,
                user.id,
                'history_view',
                target.id,
                { 
                    command: 'historico',
                    targetTag: target.tag,
                    targetId: target.id,
                    totalRecords: history.totalRecords,
                    totalPages: history.totalPages,
                    reputation: history.reputation,
                    totalStrikes: totalStrikes,
                    responseTime: Date.now() - startTime
                }
            );
            
            // 10. ATUALIZAR ANALYTICS DO STAFF (se o usuário for staff)
            if (staffRoleId && interaction.member.roles.cache.has(staffRoleId)) {
                await AnalyticsSystem.updateStaffAnalytics(guildId, user.id);
            }
            
            // 11. ADICIONAR FOOTER COM ID DA TRANSAÇÃO
            embed.setFooter({ 
                text: `Consulta #${activityId?.slice(0, 8) || 'N/A'} • ${embed.data.footer?.text || ''}`,
                iconURL: embed.data.footer?.iconURL || user.displayAvatarURL()
            });
            
            // 12. RESPOSTA FINAL
            await interaction.editReply({ 
                embeds: [embed], 
                components: components ? [components] : [] 
            });
            
            // Log silencioso de performance
            console.log(`📊 [HISTORICO] ${user.tag} consultou ${target.tag} em ${guild.name} | ${Date.now() - startTime}ms | ${history.totalRecords} registros`);
            
        } catch (error) {
            // 13. TRATAMENTO DE ERRO COM LOG DETALHADO
            console.error('❌ Erro no comando historico:', error);
            
            // Registrar erro no sistema de logs
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            // Registrar no banco
            db.logActivity(
                guildId,
                user.id,
                'error',
                target?.id || null,
                { 
                    command: 'historico',
                    targetTag: target?.tag || 'unknown',
                    error: error.message,
                    stack: error.stack
                }
            );
            
            // Limpar sessão em caso de erro
            SessionManager.delete(user.id, guildId, 'history');
            
            // Resposta de erro amigável
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro ao Carregar Histórico')
                .setDescription('Ocorreu um erro interno ao carregar o histórico do usuário. A equipe de staff foi notificada.')
                .addFields(
                    { name: 'Usuário', value: target?.tag || 'Desconhecido', inline: true },
                    { name: 'Código do Erro', value: `\`${error.message?.slice(0, 50) || 'Desconhecido'}\``, inline: true },
                    { name: 'ID da Transação', value: `\`${Date.now()}\``, inline: false }
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