const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const EmbedFormatter = require('../../utils/embedFormatter');

// ID Centralizado de Suporte
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

    async execute(interaction, client) {
        const startTime = Date.now();
        const { options, user, guild, member } = interaction;
        const guildId = guild.id;
        
        const tipo = options.getString('tipo');
        const mensagem = options.getString('mensagem');
        
        // Obter emojis do sistema
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        try {
            // Validar mensagem
            if (!mensagem || mensagem.trim().length === 0) {
                return await ResponseManager.error(interaction, 'A mensagem não pode estar vazia.');
            }
            
            // Garantir registros no banco
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            // Buscar canal de reports
            let devChannel = client.channels.cache.get(SEU_CANAL_DE_REPORTS_ID);
            if (!devChannel) {
                try {
                    devChannel = await client.channels.fetch(SEU_CANAL_DE_REPORTS_ID).catch(() => null);
                } catch (err) {
                    devChannel = null;
                }
            }
            
            if (!devChannel) {
                db.logActivity(guildId, user.id, 'feedback_channel_error', null, {
                    command: 'reportarbug', tipo,
                    error: 'Canal de suporte não encontrado',
                    channelId: SEU_CANAL_DE_REPORTS_ID
                });
                
                return await ResponseManager.error(interaction, 'A central de suporte está temporariamente offline.');
            }
            
            // Gerar UUID
            const feedbackUuid = db.generateUUID();
            
            // Embed para o desenvolvedor (canal de reports)
            const tipoIcon = tipo === 'BUG' ? emojis.Error || '🐛' : emojis.How || '💡';
            const tipoColor = tipo === 'BUG' ? 0xF64B4E : 0x3B82F6;
            
            const devEmbed = new EmbedBuilder()
                .setColor(tipoColor)
                .setDescription(`# ${tipoIcon} Feedback: ${tipo}`)
                .addFields(
                    { 
                        name: `${emojis.user || '👤'} Enviado por:`, 
                        value: `${user.tag}\n\`${user.id}\``, 
                        inline: true 
                    },
                    { 
                        name: `${emojis.serverguild || '🌐'} Servidor:`, 
                        value: `${guild.name}\n\`${guild.id}\``, 
                        inline: true 
                    },
                    { 
                        name: `${emojis.Rank || '👥'} Cargo:`, 
                        value: member?.roles.highest ? `${member.roles.highest.name}` : 'Sem cargo', 
                        inline: true 
                    },
                    { 
                        name: `${emojis.Note || '📝'} Mensagem:`, 
                        value: `\`\`\`text\n${mensagem.slice(0, 1800)}\n\`\`\``,
                        inline: false 
                    },
                    { 
                        name: `${emojis.ID || '🆔'} ID do Feedback:`, 
                        value: `\`${feedbackUuid}\``, 
                        inline: true 
                    }
                )
                .setFooter({ text: `Sistema Robin Feedback • ID: ${feedbackUuid.slice(0, 8)}`, iconURL: client.user.displayAvatarURL() })
                .setTimestamp();
            
            // Enviar para o canal
            let sentMessage = null;
            try {
                sentMessage = await devChannel.send({ embeds: [devEmbed] });
            } catch (err) {
                console.error('❌ Erro ao enviar feedback:', err);
                db.logActivity(guildId, user.id, 'feedback_send_error', null, {
                    command: 'reportarbug', tipo, feedbackUuid, error: err.message
                });
                return await ResponseManager.error(interaction, 'Ocorreu um erro ao enviar seu feedback.');
            }
            
            // Registrar atividade
            db.logActivity(guildId, user.id, 'feedback', null, {
                command: 'reportarbug', tipo, feedbackUuid,
                messageId: sentMessage.id, channelId: devChannel.id,
                messagePreview: mensagem.slice(0, 200), responseTime: Date.now() - startTime
            });
            
            // Registrar na tabela feedbacks (se existir)
            try {
                const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='feedbacks'`).get();
                if (tableExists) {
                    db.prepare(`
                        INSERT INTO feedbacks (uuid, guild_id, user_id, type, message, message_id, channel_id, created_at, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(feedbackUuid, guildId, user.id, tipo, mensagem, sentMessage.id, devChannel.id, Date.now(), 'pending');
                }
            } catch (err) {}
            
            // Resposta para o usuário
            const responseEmbed = new EmbedBuilder()
                .setColor(0xBBF96A)
                .setDescription(`# ${tipoIcon} ${tipo === 'BUG' ? 'Bug Reportado' : 'Sugestão Enviada'}`)
                .addFields(
                    { 
                        name: `${emojis.Note || '📝'} Resumo da Mensagem`, 
                        value: `\`\`\`text\n${mensagem.slice(0, 200)}${mensagem.length > 200 ? '...' : ''}\n\`\`\``,
                        inline: false 
                    },
                    { 
                        name: `${emojis.ID || '🆔'} ID do Feedback`, 
                        value: `\`${feedbackUuid.slice(0, 8)}...\``, 
                        inline: true 
                    },
                )
                .setFooter({ text: `Obrigado por contribuir!`, iconURL: user.displayAvatarURL() })
                .setTimestamp();
            
            await ResponseManager.send(interaction, { embeds: [responseEmbed] });
            
            // Atualizar analytics se for staff
            const ConfigSystem = require('../../systems/configSystem');
            const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
            if (staffRoleId && member.roles.cache.has(staffRoleId)) {
                const AnalyticsSystem = require('../../systems/analyticsSystem');
                await AnalyticsSystem.updateStaffAnalytics(guildId, user.id);
            }
            
            console.log(`📊 [FEEDBACK] ${user.tag} enviou ${tipo} em ${guild.name} | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            console.error('❌ Erro no reportarbug:', error);
            
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            db.logActivity(guildId, user.id, 'error', null, {
                command: 'reportarbug', tipo, error: error.message
            });
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xF64B4E)
                .setDescription(`# ${emojis.Error || '❌'} Erro ao Enviar Feedback`)
                .addFields(
                    { name: 'Tipo', value: tipo, inline: true },
                    { name: 'Código do Erro', value: `\`${error.message?.slice(0, 50) || 'Desconhecido'}\``, inline: true }
                )
                .setFooter({ text: 'Caso persista, contate um administrador.' })
                .setTimestamp();
            
            await ResponseManager.send(interaction, { embeds: [errorEmbed] });
        }
    }
};