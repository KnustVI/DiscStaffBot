// /home/ubuntu/DiscStaffBot/src/commands/utility/reportarbug.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

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
            
            const tipoIcon = tipo === 'BUG' ? emojis.circlealert || '🐛' : emojis.compass || '💡';
            const tipoColor = tipo === 'BUG' ? COLORS.ERROR : COLORS.DEFAULT;
            
            const devBuilder = new AdvancedContainerBuilder({ accentColor: tipoColor });
            devBuilder.title(`${tipoIcon} Feedback: ${tipo}`, 1);
            devBuilder.separator();
            devBuilder.text(`${emojis.user || '👤'} **Enviado por:** ${user.tag} \`${user.id}\``);
            devBuilder.text(`${emojis.flag || '🌐'} **Servidor:** ${guild.name} \`${guild.id}\``);
            devBuilder.text(`${emojis.badge || '👥'} **Cargo:** ${member?.roles.highest ? member.roles.highest.name : 'Sem cargo'}`);
            devBuilder.text(`${emojis.mensagem || '📝'} **Mensagem:**\n\`\`\`text\n${mensagem.slice(0, 1800)}\n\`\`\``);
            devBuilder.text(`${emojis.idcard || '🆔'} **ID do Feedback:** \`${feedbackUuid}\``);
            devBuilder.footer(guild.name, `ID: ${feedbackUuid.slice(0, 8)}`);
            
            const { components: devComponents, flags: devFlags } = devBuilder.build();
            
            let sentMessage = null;
            try {
                sentMessage = await devChannel.send({
                    components: devComponents,
                    flags: [devFlags]
                });
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
            
            const responseBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });
            responseBuilder.title(`${tipoIcon} ${tipo === 'BUG' ? 'Bug Reportado' : 'Sugestão Enviada'}`, 1);
            responseBuilder.separator();
            responseBuilder.text(`${emojis.mensagem || '📝'} **Resumo da Mensagem:**\n\`\`\`text\n${mensagem.slice(0, 200)}${mensagem.length > 200 ? '...' : ''}\n\`\`\``);
            responseBuilder.text(`${emojis.idcard || '🆔'} **ID do Feedback:** \`${feedbackUuid.slice(0, 8)}...\``);
            responseBuilder.footer(guild.name, `Obrigado por contribuir!`);
            
            const { components: responseComponents, flags: responseFlags } = responseBuilder.build();
            await interaction.editReply({
                components: responseComponents,
                flags: [responseFlags]
            });
            
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
            
            const errorBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });
            errorBuilder.title(`${emojis.circlealert || '❌'} Erro ao Enviar Feedback`, 1);
            errorBuilder.separator();
            errorBuilder.text(`**Tipo:** ${tipo}`);
            errorBuilder.text(`**Código do Erro:** \`${error.message?.slice(0, 50) || 'Desconhecido'}\``);
            errorBuilder.footer(guild?.name, 'Caso persista, contate um administrador.');
            
            const { components: errorComponents, flags: errorFlags } = errorBuilder.build();
            await interaction.editReply({
                components: errorComponents,
                flags: [errorFlags]
            });
        }
    }
};