// src/events/interactionCreate.js
const InteractionHandler = require('../systems/handlers');
const ResponseManager = require('../utils/responseManager');
const ReportChatSystem = require('../systems/reportChatSystem');
const ReportChatFormatter = require('../utils/reportChatFormatter');
const sessionManager = require('../utils/sessionManager');
const db = require('../database/index');
const ConfigSystem = require('../systems/configSystem');

// ==================== FALLBACK PARA CONFIGSYSTEM ====================
// Garantir que getSetting existe (caso o método original não exista)
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
        
        // Inicializar handlers
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
            
            // ==================== REPORTCHAT SYSTEM ====================
            if (interaction.isButton()) {
                
                // Botão que ABRE o modal de criação
                if (interaction.customId === 'reportchat:create') {
                    console.log('📌 Abrindo modal de criação');
                    const modal = ReportChatFormatter.createOpenModal();
                    await interaction.showModal(modal);
                    return;
                }

                // Botão entrar no report (STAFF no LOG)
                if (interaction.customId?.startsWith('reportchat:join:')) {
                    console.log('📌 Staff entrando no report');
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.deferUpdate();
                    }
                    const reportId = interaction.customId.split(':')[2];
                    await reportChatSystem.joinReport(interaction, reportId);
                    return;
                }

                // Botão fechar sem motivo (STAFF no LOG)
                if (interaction.customId?.startsWith('reportchat:close:no-reason:')) {
                    console.log('📌 Staff fechando report sem motivo');
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.deferUpdate();
                    }
                    const reportId = interaction.customId.split(':')[3];
                    await reportChatSystem.closeReport(interaction, reportId, null, null, false, true);
                    return;
                }
                
                // Botão fechar com motivo (STAFF no LOG)
                if (interaction.customId?.startsWith('reportchat:close:reason:')) {
                    console.log('📌 Staff abrindo modal de fechamento com motivo');
                    const reportId = interaction.customId.split(':')[3];
                    const modal = ReportChatFormatter.createCloseReasonModal();
                    await interaction.showModal(modal);
                    if (interaction.guildId) {
                        sessionManager.set(
                            interaction.user.id,
                            interaction.guildId,
                            'reportchat',
                            'closing_staff',
                            { reportId },
                            300000
                        );
                    }
                    return;
                }
                
                // Botão fechar sem motivo (USUÁRIO na DM)
                if (interaction.customId?.startsWith('reportchat:user:close:no-reason:')) {
                    console.log('📌 Usuário fechando report sem motivo');
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.deferUpdate();
                    }
                    const reportId = interaction.customId.split(':')[3];
                    await reportChatSystem.closeReport(interaction, reportId, null, null, false, false);
                    return;
                }
                
                // Botão fechar com motivo (USUÁRIO na DM)
                if (interaction.customId?.startsWith('reportchat:user:close:reason:')) {
                    console.log('📌 Usuário abrindo modal de fechamento com motivo');
                    const reportId = interaction.customId.split(':')[3];
                    const modal = ReportChatFormatter.createUserCloseReasonModal();
                    await interaction.showModal(modal);
                    if (interaction.guildId) {
                        sessionManager.set(
                            interaction.user.id,
                            interaction.guildId,
                            'reportchat',
                            'closing_user',
                            { reportId },
                            300000
                        );
                    }
                    return;
                }

                // Botão avaliar - abre modal
                if (interaction.customId?.startsWith('reportchat:rate:')) {
                    console.log('📌 Abrindo modal de avaliação');
                    const reportId = interaction.customId.split(':')[2];
                    const modal = ReportChatFormatter.createRatingModal();
                    await interaction.showModal(modal);
                    if (interaction.guildId) {
                        sessionManager.set(
                            interaction.user.id,
                            interaction.guildId,
                            'reportchat',
                            'rating',
                            { reportId },
                            300000
                        );
                    }
                    return;
                }
            }

            // ==================== MODAIS ====================
            if (interaction.isModalSubmit()) {
                
                // MODAL DE ABERTURA - processa os dados
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
                
                // Modal de fechamento com motivo (STAFF)
                if (interaction.customId === 'reportchat:close:reason:modal') {
                    console.log('📌 Processando modal de fechamento (staff)');
                    if (interaction.guildId) {
                        const session = sessionManager.get(
                            interaction.user.id,
                            interaction.guildId,
                            'reportchat',
                            'closing_staff'
                        );
                    
                        if (session && session.reportId) {
                            const motivo = interaction.fields.getTextInputValue('motivo');
                            const punicao = interaction.fields.getTextInputValue('punicao');
                            await reportChatSystem.closeReport(interaction, session.reportId, motivo, punicao, true, true);
                            sessionManager.delete(
                                interaction.user.id,
                                interaction.guildId,
                                'reportchat',
                                'closing_staff'
                            );
                        }
                    }
                    return;
                }
                
                // Modal de fechamento com motivo (USUÁRIO)
                if (interaction.customId === 'reportchat:user:close:reason:modal') {
                    console.log('📌 Processando modal de fechamento (usuário)');
                    if (interaction.guildId) {
                        const session = sessionManager.get(
                            interaction.user.id,
                            interaction.guildId,
                            'reportchat',
                            'closing_user'
                        );
                        
                        if (session && session.reportId) {
                            const motivo = interaction.fields.getTextInputValue('motivo');
                            await reportChatSystem.closeReport(interaction, session.reportId, motivo, null, true, false);
                            sessionManager.delete(
                                interaction.user.id,
                                interaction.guildId,
                                'reportchat',
                                'closing_user'
                            );
                        }
                    }
                    return;
                }
                
                // Modal de avaliação
                if (interaction.customId === 'reportchat:rating') {
                    console.log('📌 Processando modal de avaliação');
                    if (interaction.guildId) {
                        const session = sessionManager.get(
                            interaction.user.id,
                            interaction.guildId,
                            'reportchat',
                            'rating'
                        );
                        
                        if (session && session.reportId) {
                            const nota = parseInt(interaction.fields.getTextInputValue('nota'));
                            const comentario = interaction.fields.getTextInputValue('comentario');
                            await reportChatSystem.rateReport(interaction, session.reportId, nota, comentario);
                            sessionManager.delete(
                                interaction.user.id,
                                interaction.guildId,
                                'reportchat',
                                'rating'
                            );
                        }
                    }
                    return;
                }

                // ==================== OUTROS MODAIS ====================
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '⏳ Processando...', flags: 64 });
                }
                await handler.handleModal(interaction);
                return;
            }
            
            // ==================== COMPONENTES GERAIS ====================
            if (interaction.isButton() || interaction.isStringSelectMenu() || 
                interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
                
                if (!interaction.customId) {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '❌ Configuração inválida.', flags: 64 });
                    }
                    return;
                }
                
                // Verificar se é componente do reportchat (já tratado acima)
                if (interaction.customId.startsWith('reportchat') || 
                    interaction.customId.startsWith('reportchat:user')) {
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
            
            // Tentar recuperar a interação
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