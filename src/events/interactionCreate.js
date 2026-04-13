// src/events/interactionCreate.js
const InteractionHandler = require('../systems/handlers');
const ResponseManager = require('../utils/responseManager');
const ReportChatSystem = require('../systems/reportChatSystem');
const ReportChatFormatter = require('../utils/reportChatFormatter');
const sessionManager = require('../utils/sessionManager');
const db = require('../database/index');
const ConfigSystem = require('../systems/configSystem');

// Fallback para ConfigSystem.getSetting
if (!ConfigSystem.getSetting) {
    ConfigSystem.getSetting = (guildId, key) => {
        try {
            const setting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, key);
            return setting?.value || null;
        } catch (err) {
            console.error(`❌ Erro no fallback getSetting:`, err);
            return null;
        }
    };
}

let handler = null;
let reportChatSystem = null;

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        console.log(`🔍 Interação recebida: ${interaction.customId || interaction.commandName}`);
        
        if (!handler) handler = new InteractionHandler(client);
        if (!reportChatSystem) reportChatSystem = new ReportChatSystem(client);
        
        try {
            // ==================== SLASH COMMANDS ====================
            if (interaction.isCommand()) {
                const isEphemeral = ['config', 'strike', 'unstrike', 'repset', 'config-rep', 'config-strike', 'reportchat'].includes(interaction.commandName);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.deferReply({ flags: isEphemeral ? 64 : 0 });
                }
                await handler.handleCommand(interaction);
                return;
            }
            
            // ==================== REPORTCHAT BUTTONS ====================
            if (interaction.isButton()) {
                
                if (interaction.customId === 'reportchat:create') {
                    console.log('📌 Abrindo modal de criação');
                    const modal = ReportChatFormatter.createOpenModal();
                    await interaction.showModal(modal);
                    return;
                }

                if (interaction.customId?.startsWith('reportchat:join:')) {
                    console.log('📌 Staff entrando no report');
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.deferUpdate();
                    }
                    const reportId = interaction.customId.split(':')[2];
                    await reportChatSystem.joinReport(interaction, reportId);
                    return;
                }

                if (interaction.customId?.startsWith('reportchat:close:no-reason:')) {
                    console.log('📌 Staff fechando report sem motivo');
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.deferUpdate();
                    }
                    const reportId = interaction.customId.split(':')[3];
                    await reportChatSystem.closeReport(interaction, reportId, null, null, false, true);
                    return;
                }
                
                if (interaction.customId?.startsWith('reportchat:close:reason:')) {
                    console.log('📌 Staff abrindo modal de fechamento com motivo');
                    const reportId = interaction.customId.split(':')[3];
                    const modal = ReportChatFormatter.createCloseReasonModal();
                    await interaction.showModal(modal);
                    if (interaction.guildId) {
                        sessionManager.set(interaction.user.id, interaction.guildId, 'reportchat', 'closing_staff', { reportId }, 300000);
                    }
                    return;
                }
                
                if (interaction.customId?.startsWith('reportchat:user:close:no-reason:')) {
                    console.log('📌 Usuário fechando report sem motivo');
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.deferUpdate();
                    }
                    const reportId = interaction.customId.split(':')[3];
                    await reportChatSystem.closeReport(interaction, reportId, null, null, false, false);
                    return;
                }
                
                if (interaction.customId?.startsWith('reportchat:user:close:reason:')) {
                    console.log('📌 Usuário abrindo modal de fechamento com motivo');
                    const reportId = interaction.customId.split(':')[3];
                    const modal = ReportChatFormatter.createUserCloseReasonModal();
                    await interaction.showModal(modal);
                    if (interaction.guildId) {
                        sessionManager.set(interaction.user.id, interaction.guildId, 'reportchat', 'closing_user', { reportId }, 300000);
                    }
                    return;
                }

                if (interaction.customId?.startsWith('reportchat:rate:')) {
                    console.log('📌 Abrindo modal de avaliação');
                    const reportId = interaction.customId.split(':')[2];
                    const modal = ReportChatFormatter.createRatingModal();
                    await interaction.showModal(modal);
                    if (interaction.guildId) {
                        sessionManager.set(interaction.user.id, interaction.guildId, 'reportchat', 'rating', { reportId }, 300000);
                    }
                    return;
                }
            }

            // ==================== REPORTCHAT MODALS ====================
            if (interaction.isModalSubmit()) {
                
                if (interaction.customId === 'reportchat:open:modal') {
                    console.log('📌 Processando modal de abertura');
                    const data = {
                        seuNick: interaction.fields.getTextInputValue('seu_nick'),
                        alvoNick: interaction.fields.getTextInputValue('alvo_nick'),
                        dataHora: interaction.fields.getTextInputValue('data_hora'),
                        regra: interaction.fields.getTextInputValue('regra'),
                        descricao: interaction.fields.getTextInputValue('descricao')
                    };
                    await reportChatSystem.openReport(interaction, data);
                    return;
                }
                
                if (interaction.customId === 'reportchat:close:reason:modal') {
                    console.log('📌 Processando modal de fechamento (staff)');
                    // Deferir a resposta do modal
                    await interaction.deferReply({ flags: 64 });
                    
                    if (interaction.guildId) {
                        const session = sessionManager.get(interaction.user.id, interaction.guildId, 'reportchat', 'closing_staff');
                        if (session && session.reportId) {
                            const motivo = interaction.fields.getTextInputValue('motivo');
                            const punicao = interaction.fields.getTextInputValue('punicao');
                            await reportChatSystem.closeReport(interaction, session.reportId, motivo, punicao, true, true);
                            sessionManager.delete(interaction.user.id, interaction.guildId, 'reportchat', 'closing_staff');
                        }
                    }
                    return;
                }
                
                if (interaction.customId === 'reportchat:user:close:reason:modal') {
                    console.log('📌 Processando modal de fechamento (usuário)');
                    await interaction.deferReply({ flags: 64 });
                    
                    if (interaction.guildId) {
                        const session = sessionManager.get(interaction.user.id, interaction.guildId, 'reportchat', 'closing_user');
                        if (session && session.reportId) {
                            const motivo = interaction.fields.getTextInputValue('motivo');
                            await reportChatSystem.closeReport(interaction, session.reportId, motivo, null, true, false);
                            sessionManager.delete(interaction.user.id, interaction.guildId, 'reportchat', 'closing_user');
                        }
                    }
                    return;
                }
                
                if (interaction.customId === 'reportchat:rating') {
                    console.log('📌 Processando modal de avaliação');
                    await interaction.deferReply({ flags: 64 });
                    
                    if (interaction.guildId) {
                        const session = sessionManager.get(interaction.user.id, interaction.guildId, 'reportchat', 'rating');
                        if (session && session.reportId) {
                            const nota = parseInt(interaction.fields.getTextInputValue('nota'));
                            const comentario = interaction.fields.getTextInputValue('comentario');
                            await reportChatSystem.rateReport(interaction, session.reportId, nota, comentario);
                            sessionManager.delete(interaction.user.id, interaction.guildId, 'reportchat', 'rating');
                        }
                    }
                    return;
                }

                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '⏳ Processando...', flags: 64 });
                }
                await handler.handleModal(interaction);
                return;
            }
            
            // ==================== OUTROS COMPONENTES ====================
            if (interaction.isButton() || interaction.isStringSelectMenu() || 
                interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
                
                if (!interaction.customId) {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '❌ Configuração inválida.', flags: 64 });
                    }
                    return;
                }
                
                if (interaction.customId.startsWith('reportchat')) {
                    return;
                }
                
                const needsDefer = !interaction.customId.endsWith(':modal');
                if (needsDefer && !interaction.replied && !interaction.deferred) {
                    await interaction.deferUpdate();
                }
                
                await handler.handleComponent(interaction);
                return;
            }
            
        } catch (error) {
            console.error(`❌ Erro fatal em interactionCreate:`, error);
            
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '❌ Ocorreu um erro. Tente novamente.', flags: 64 });
                } else if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply({ content: '❌ Ocorreu um erro. Tente novamente.' });
                }
            } catch (err) {
                console.error('❌ Falha ao responder:', err);
            }
        }
    }
};