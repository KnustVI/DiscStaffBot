const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const SessionManager = require('../../utils/sessionManager');

// ID Centralizado de Suporte (Pode ser movido para o ConfigSystem futuramente)
// TODO: Mover para ConfigSystem para permitir configuração por servidor
const SEU_CANAL_DE_REPORTS_ID = '1485403522395672717'; 

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reportarbug')
        .setDescription('Envia uma sugestão ou reporta um bug diretamente para o desenvolvedor.')
        .addStringOption(opt => 
            opt.setName('tipo')
                .setDescription('Selecione o tipo de feedback')
                .setRequired(true)
                .addChoices(
                    { name: 'Sugerir Melhoria', value: 'SUGESTÃO' },
                    { name: 'Reportar Bug/Erro', value: 'BUG' }
                ))
        .addStringOption(opt => 
            opt.setName('mensagem')
                .setDescription('Detalhe sua sugestão ou o erro encontrado')
                .setRequired(true)),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     * @param {import('discord.js').Client} client 
     */
    async execute(interaction, client) {
        const startTime = Date.now();
        const { options, user, guild, member } = interaction;
        const guildId = guild.id;
        
        const tipo = options.getString('tipo');
        const mensagem = options.getString('mensagem');
        
        // Obter emojis do sistema (se existirem)
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        try {
            // 1. VALIDAR MENSAGEM (não pode estar vazia)
            if (!mensagem || mensagem.trim().length === 0) {
                return await interaction.editReply({ 
                    content: `${emojis.ERRO || '❌'} A mensagem não pode estar vazia.` 
                });
            }
            
            // 2. GARANTIR QUE USUÁRIO E GUILD EXISTEM NO BANCO
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            // 3. OBTER SISTEMAS
            const ConfigSystem = require('../../systems/configSystem');
            
            // 4. BUSCAR CANAL DE REPORTS (primeiro no cache, depois fetch)
            let devChannel = client.channels.cache.get(SEU_CANAL_DE_REPORTS_ID);
            if (!devChannel) {
                try {
                    devChannel = await client.channels.fetch(SEU_CANAL_DE_REPORTS_ID).catch(() => null);
                } catch (err) {
                    devChannel = null;
                }
            }
            
            if (!devChannel) {
                // Registrar erro no banco
                db.logActivity(
                    guildId,
                    user.id,
                    'feedback_channel_error',
                    null,
                    { 
                        command: 'reportarbug',
                        tipo,
                        error: 'Canal de suporte não encontrado',
                        channelId: SEU_CANAL_DE_REPORTS_ID
                    }
                );
                
                return await interaction.editReply({ 
                    content: `${emojis.ERRO || '❌'} A central de suporte está temporariamente offline. Tente novamente mais tarde.` 
                });
            }
            
            // 5. GERAR UUID ÚNICO PARA O FEEDBACK
            const feedbackUuid = db.generateUUID();
            
            // 6. CONSTRUÇÃO DA EMBED PARA O DESENVOLVEDOR
            const tipoIcon = tipo === 'BUG' ? '🐛' : '💡';
            const tipoColor = tipo === 'BUG' ? 0xEF4444 : 0x3B82F6;
            const tipoEmoji = tipo === 'BUG' ? emojis.ERRO || '🐛' : emojis.CHECK || '💡';
            
            const devEmbed = new EmbedBuilder()
                .setAuthor({ 
                    name: `📬 Feedback: ${tipo}`, 
                    iconURL: user.displayAvatarURL() 
                })
                .setColor(tipoColor)
                .addFields(
                    { 
                        name: '👤 Enviado por:', 
                        value: `${user.tag}\n\`${user.id}\``, 
                        inline: true 
                    },
                    { 
                        name: '🌐 Servidor:', 
                        value: `${guild.name}\n\`${guild.id}\``, 
                        inline: true 
                    },
                    { 
                        name: '👥 Cargo:', 
                        value: member?.roles.highest ? `${member.roles.highest.name}` : 'Sem cargo', 
                        inline: true 
                    },
                    { 
                        name: '📝 Mensagem:', 
                        value: `\`\`\`text\n${mensagem.slice(0, 1800)}\n\`\`\``,
                        inline: false 
                    },
                    { 
                        name: '🆔 ID do Feedback:', 
                        value: `\`${feedbackUuid}\``, 
                        inline: true 
                    }
                )
                .setFooter({ 
                    text: `Sistema Robin Feedback • ID: ${feedbackUuid.slice(0, 8)}`, 
                    iconURL: client.user.displayAvatarURL() 
                })
                .setTimestamp();
            
            // 7. ENVIAR PARA O CANAL DE FEEDBACK
            let sentMessage = null;
            try {
                sentMessage = await devChannel.send({ embeds: [devEmbed] });
            } catch (err) {
                console.error('❌ Erro ao enviar feedback:', err);
                
                db.logActivity(
                    guildId,
                    user.id,
                    'feedback_send_error',
                    null,
                    { 
                        command: 'reportarbug',
                        tipo,
                        feedbackUuid,
                        error: err.message
                    }
                );
                
                return await interaction.editReply({ 
                    content: `${emojis.ERRO || '❌'} Ocorreu um erro ao enviar seu feedback. Tente novamente mais tarde.` 
                });
            }
            
            // 8. REGISTRAR ATIVIDADE NO LOG
            const activityId = db.logActivity(
                guildId,
                user.id,
                'feedback',
                null,
                { 
                    command: 'reportarbug',
                    tipo,
                    feedbackUuid,
                    messageId: sentMessage.id,
                    channelId: devChannel.id,
                    messagePreview: mensagem.slice(0, 200),
                    messageLength: mensagem.length,
                    responseTime: Date.now() - startTime
                }
            );
            
            // 9. REGISTRAR FEEDBACK NA TABELA (se existir - opcional)
            // Opcional: criar tabela de feedbacks para rastreamento
            try {
                // Verificar se a tabela de feedbacks existe
                const tableExists = db.prepare(`
                    SELECT name FROM sqlite_master 
                    WHERE type='table' AND name='feedbacks'
                `).get();
                
                if (tableExists) {
                    db.prepare(`
                        INSERT INTO feedbacks (
                            uuid, guild_id, user_id, type, message, 
                            message_id, channel_id, created_at, status
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        feedbackUuid, guildId, user.id, tipo, mensagem,
                        sentMessage.id, devChannel.id, Date.now(), 'pending'
                    );
                }
            } catch (err) {
                // Silenciar erro - tabela pode não existir ainda
            }
            
            // 10. RESPOSTA PARA O USUÁRIO
            const responseEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle(`${tipoIcon} ${tipo === 'BUG' ? 'Bug Reportado' : 'Sugestão Enviada'}`)
                .setDescription(`${emojis.CHECK || '✅'} **Sucesso!** Seu feedback foi enviado para minha central de suporte.`)
                .addFields(
                    { 
                        name: '📝 Resumo da Mensagem', 
                        value: `\`\`\`text\n${mensagem.slice(0, 200)}${mensagem.length > 200 ? '...' : ''}\n\`\`\``,
                        inline: false 
                    },
                    { 
                        name: '🆔 ID do Feedback', 
                        value: `\`${feedbackUuid.slice(0, 8)}...\``, 
                        inline: true 
                    },
                    { 
                        name: '📊 Status', 
                        value: '`Aguardando análise`', 
                        inline: true 
                    }
                )
                .setFooter({ 
                    text: `Obrigado por contribuir! ID: ${activityId?.slice(0, 8) || feedbackUuid.slice(0, 8)}`, 
                    iconURL: user.displayAvatarURL() 
                })
                .setTimestamp();
            
            await interaction.editReply({ 
                embeds: [responseEmbed],
                content: null
            });
            
            // 11. ATUALIZAR ANALYTICS DO STAFF (se o usuário for staff)
            const ConfigSystem = require('../../systems/configSystem');
            const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
            if (staffRoleId && member.roles.cache.has(staffRoleId)) {
                const AnalyticsSystem = require('../../systems/analyticsSystem');
                await AnalyticsSystem.updateStaffAnalytics(guildId, user.id);
            }
            
            // Log silencioso de performance
            console.log(`📊 [FEEDBACK] ${user.tag} enviou ${tipo} em ${guild.name} | ${Date.now() - startTime}ms | ID: ${feedbackUuid.slice(0, 8)}`);
            
        } catch (error) {
            // 12. TRATAMENTO DE ERRO COM LOG DETALHADO
            console.error('❌ Erro no comando reportarbug:', error);
            
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
                    command: 'reportarbug',
                    tipo,
                    error: error.message,
                    stack: error.stack,
                    messagePreview: mensagem?.slice(0, 200)
                }
            );
            
            // Resposta de erro amigável
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro ao Enviar Feedback')
                .setDescription('Ocorreu um erro interno ao processar seu envio. A equipe de desenvolvimento foi notificada.')
                .addFields(
                    { name: 'Tipo', value: tipo, inline: true },
                    { name: 'Código do Erro', value: `\`${error.message?.slice(0, 50) || 'Desconhecido'}\``, inline: true },
                    { name: 'ID da Transação', value: `\`${Date.now()}\``, inline: false }
                )
                .setFooter({ text: 'Caso persista, contate um administrador diretamente.' })
                .setTimestamp();
            
            await interaction.editReply({ 
                embeds: [errorEmbed],
                content: null
            }).catch(() => null);
        }
    }
};