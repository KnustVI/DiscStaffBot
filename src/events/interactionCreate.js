const InteractionHandler = require('../systems/handlers');
const ResponseManager = require('../utils/responseManager');
const ReportChatSystem = require('../systems/reportChatSystem');
const ReportChatFormatter = require('../utils/reportChatFormatter');

let handler = null;
let reportChatSystem = null;

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // Inicializar
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
            
            // ==================== REPORCHAT SYSTEM ====================
            
            // Botão criar - NÃO precisa de defer
            if (interaction.customId === 'reportchat:create') {
                await reportChatSystem.createTicket(interaction);
                return;
            }
            
            // Botão entrar - NÃO precisa de defer
            if (interaction.customId?.startsWith('reportchat:join:')) {
                const ticketId = interaction.customId.split(':')[2];
                await reportChatSystem.joinTicket(interaction, ticketId);
                return;
            }
            
            // Botão fechar com motivo (staff na thread) - NÃO precisa de defer (mostra modal)
            if (interaction.customId?.startsWith('reportchat:close:reason:')) {
                const ticketId = interaction.customId.split(':')[3];
                const modal = ReportChatFormatter.createCloseReasonModal();
                await interaction.showModal(modal);
                const sessionManager = require('../utils/sessionManager');
                sessionManager.set(interaction.user.id, interaction.guildId, 'reportchat', 'closing_reason', { ticketId }, 300000);
                return;
            }
            
            // Botão fechar sem motivo (staff na thread) - PRECISA de defer
            if (interaction.customId?.startsWith('reportchat:close:no-reason:')) {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.deferUpdate();
                }
                const ticketId = interaction.customId.split(':')[3];
                await reportChatSystem.closeTicketWithoutReason(interaction, ticketId);
                return;
            }
            
            // Botão fechar com avaliação (usuário na DM) - NÃO precisa de defer (mostra modal)
            if (interaction.customId?.startsWith('reportchat:close:rate:')) {
                const ticketId = interaction.customId.split(':')[3];
                const modal = ReportChatFormatter.createRatingModal();
                await interaction.showModal(modal);
                const sessionManager = require('../utils/sessionManager');
                sessionManager.set(interaction.user.id, interaction.guildId, 'reportchat', 'closing_rating', { ticketId }, 300000);
                return;
            }
            
            // Botão fechar sem avaliação (usuário na DM) - PRECISA de defer
            if (interaction.customId?.startsWith('reportchat:close:no-rate:')) {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.deferUpdate();
                }
                const ticketId = interaction.customId.split(':')[3];
                await reportChatSystem.closeTicketWithoutReason(interaction, ticketId);
                return;
            }
            
            // Botão avaliar (após fechamento) - NÃO precisa de defer (mostra modal)
            if (interaction.customId?.startsWith('reportchat:rate:')) {
                const ticketId = interaction.customId.split(':')[2];
                const modal = ReportChatFormatter.createRatingModal();
                await interaction.showModal(modal);
                const sessionManager = require('../utils/sessionManager');
                sessionManager.set(interaction.user.id, interaction.guildId, 'reportchat', 'rating', { ticketId }, 300000);
                return;
            }
            
            // ==================== MODAIS ====================
            if (interaction.isModalSubmit()) {
                const sessionManager = require('../utils/sessionManager');
                
                // Modal de fechamento com motivo
                if (interaction.customId === 'reportchat:close:reason:modal') {
                    const session = sessionManager.get(interaction.user.id, interaction.guildId, 'reportchat', 'closing_reason');
                    if (session?.ticketId) {
                        const motivo = interaction.fields.getTextInputValue('motivo');
                        const punicao = interaction.fields.getTextInputValue('punicao');
                        await reportChatSystem.closeTicketWithReason(interaction, session.ticketId, motivo, punicao);
                        sessionManager.delete(interaction.user.id, interaction.guildId, 'reportchat', 'closing_reason');
                    }
                    return;
                }
                
                // Modal de avaliação
                if (interaction.customId === 'reportchat:rating') {
                    const session = sessionManager.get(interaction.user.id, interaction.guildId, 'reportchat', 'closing_rating') ||
                                    sessionManager.get(interaction.user.id, interaction.guildId, 'reportchat', 'rating');
                    if (session?.ticketId) {
                        const nota = parseInt(interaction.fields.getTextInputValue('nota'));
                        const comentario = interaction.fields.getTextInputValue('comentario');
                        await reportChatSystem.closeTicketWithRating(interaction, session.ticketId, nota, comentario);
                        sessionManager.delete(interaction.user.id, interaction.guildId, 'reportchat', 'closing_rating');
                        sessionManager.delete(interaction.user.id, interaction.guildId, 'reportchat', 'rating');
                    }
                    return;
                }
                
                // Outros modais
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
                
                const needsDefer = !interaction.customId.endsWith(':modal') && 
                                  !interaction.customId.startsWith('reportchat:close:rate') &&
                                  !interaction.customId.startsWith('reportchat:close:reason') &&
                                  !interaction.customId.startsWith('reportchat:rate');
                
                if (needsDefer && !interaction.replied && !interaction.deferred) {
                    await interaction.deferUpdate();
                }
                
                await handler.handleComponent(interaction);
                return;
            }
            
        } catch (error) {
            console.error(`❌ Erro fatal:`, error);
            
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