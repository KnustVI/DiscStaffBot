// src/commands/report/reportarbug.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const ContainerBuilder = require('../../utils/ContainerBuilder');
const ContainerFormatter = require('../../utils/ContainerFormatter');

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
        
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        try {
            if (!mensagem || mensagem.trim().length === 0) {
                return await ResponseManager.error(interaction, 'A mensagem não pode estar vazia.');
            }
            
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
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
            
            const feedbackUuid = db.generateUUID();
            
            const tipoIcon = tipo === 'BUG' ? emojis.Error || '🐛' : emojis.How || '💡';
            const tipoColor = tipo === 'BUG' ? 0xF64B4E : 0x3B82F6;
            
            // Container para o desenvolvedor
            const devBuilder = ContainerFormatter.createBuilder(guild.name, tipoColor);
            devBuilder.addTitle(`${tipoIcon} Feedback: ${tipo}`, 1);
            devBuilder.addSeparator();
            devBuilder.addSection([
                `${emojis.user || '👤'} **Enviado por:**`,
                `${user.tag}\n\`${user.id}\``
            ]);
            devBuilder.addSection([
                `${emojis.serverguild || '🌐'} **Servidor:**`,
                `${guild.name}\n\`${guild.id}\``
            ]);
            devBuilder.addSection([
                `${emojis.Rank || '👥'} **Cargo:**`,
                member?.roles.highest ? `${member.roles.highest.name}` : 'Sem cargo'
            ]);
            devBuilder.addSection([
                `${emojis.Note || '📝'} **Mensagem:**`,
                `\`\`\`text\n${mensagem.slice(0, 1800)}\n\`\`\``
            ]);
            devBuilder.addSection([
                `${emojis.ID || '🆔'} **ID do Feedback:**`,
                `\`${feedbackUuid}\``
            ]);
            devBuilder.addFooter(`ID: ${feedbackUuid.slice(0, 8)}`);
            
            let sentMessage = null;
            try {
                sentMessage = await devChannel.send(devBuilder.build());
            } catch (err) {
                console.error('❌ Erro ao enviar feedback:', err);
                db.logActivity(guildId, user.id, 'feedback_send_error', null, {
                    command: 'reportarbug', tipo, feedbackUuid, error: err.message
                });
                return await ResponseManager.error(interaction, 'Ocorreu um erro ao enviar seu feedback.');
            }
            
            db.logActivity(guildId, user.id, 'feedback', null, {
                command: 'reportarbug', tipo, feedbackUuid,
                messageId: sentMessage.id, channelId: devChannel.id,
                messagePreview: mensagem.slice(0, 200), responseTime: Date.now() - startTime
            });
            
            try {
                const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='feedbacks'`).get();
                if (tableExists) {
                    db.prepare(`
                        INSERT INTO feedbacks (uuid, guild_id, user_id, type, message, message_id, channel_id, created_at, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(feedbackUuid, guildId, user.id, tipo, mensagem, sentMessage.id, devChannel.id, Date.now(), 'pending');
                }
            } catch (err) {}
            
            // Container de resposta para o usuário
            const responseBuilder = ContainerFormatter.createBuilder(guild.name, 0xBBF96A);
            responseBuilder.addTitle(`${tipoIcon} ${tipo === 'BUG' ? 'Bug Reportado' : 'Sugestão Enviada'}`, 1);
            responseBuilder.addSeparator();
            responseBuilder.addSection([
                `${emojis.Note || '📝'} **Resumo da Mensagem:**`,
                `\`\`\`text\n${mensagem.slice(0, 200)}${mensagem.length > 200 ? '...' : ''}\n\`\`\``
            ]);
            responseBuilder.addSection([
                `${emojis.ID || '🆔'} **ID do Feedback:**`,
                `\`${feedbackUuid.slice(0, 8)}...\``
            ]);
            responseBuilder.addFooter(`Obrigado por contribuir!`);
            
            await ResponseManager.send(interaction, responseBuilder.build());
            
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
            
            const errorBuilder = ContainerFormatter.createBuilder(guild.name, 0xF64B4E);
            errorBuilder.addTitle(`${emojis.Error || '❌'} Erro ao Enviar Feedback`, 1);
            errorBuilder.addSeparator();
            errorBuilder.addSection([
                `**Tipo:**`,
                tipo
            ]);
            errorBuilder.addSection([
                `**Código do Erro:**`,
                `\`${error.message?.slice(0, 50) || 'Desconhecido'}\``
            ]);
            errorBuilder.addFooter('Caso persista, contate um administrador.');
            
            await ResponseManager.send(interaction, errorBuilder.build());
        }
    }
};