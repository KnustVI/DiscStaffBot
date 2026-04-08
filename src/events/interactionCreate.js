const InteractionHandler = require('../systems/handlers');
const ResponseManager = require('../utils/responseManager');
const ReportChatSystem = require('../systems/reportChatSystem');
const ReportChatFormatter = require('../utils/reportChatFormatter');

let handler = null;
let reportChatSystem = null;

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // Inicializar handler
        if (!handler) {
            handler = new InteractionHandler(client);
        }
        
        // Inicializar reportChatSystem
        if (!reportChatSystem) {
            reportChatSystem = new ReportChatSystem(client);
        }
        
        try {
            // ==================== SLASH COMMANDS ====================
            if (interaction.isCommand()) {
                const isEphemeral = ['config', 'strike', 'unstrike', 'repset', 'config-rep', 'config-strike', 'reportchat'].includes(interaction.commandName);
                await ResponseManager.defer(interaction, isEphemeral);
                await handler.handleCommand(interaction);
                return;
            }
            
            // ==================== REPORCHAT SYSTEM ====================
            
            // Botão criar reportchat
            if (interaction.customId === 'reportchat:create') {
                await reportChatSystem.createTicket(interaction);
                return;
            }
            
            // Botão entrar no reportchat
            if (interaction.customId && interaction.customId.startsWith('reportchat:join:')) {
                const ticketId = interaction.customId.split(':')[2];
                await reportChatSystem.joinTicket(interaction, ticketId);
                return;
            }
            
            // Botão fechar com avaliação
            if (interaction.customId && interaction.customId.startsWith('reportchat:close:rate:')) {
                const ticketId = interaction.customId.split(':')[3];
                const modal = ReportChatFormatter.createRatingModal();
                await interaction.showModal(modal);
                const sessionManager = require('../utils/sessionManager');
                sessionManager.set(
                    interaction.user.id, 
                    interaction.guildId, 
                    'reportchat', 
                    'closing', 
                    { ticketId, withRating: true }, 
                    300000
                );
                return;
            }
            
            // Botão fechar sem avaliação
            if (interaction.customId && interaction.customId.startsWith('reportchat:close:no-rate:')) {
                const ticketId = interaction.customId.split(':')[3];
                await reportChatSystem.closeTicket(interaction, ticketId, null, null);
                return;
            }
            
            // Modal de avaliação
            if (interaction.customId === 'reportchat:rating') {
                const sessionManager = require('../utils/sessionManager');
                const session = sessionManager.get(interaction.user.id, interaction.guildId, 'reportchat', 'closing');
                if (session && session.ticketId) {
                    const nota = parseInt(interaction.fields.getTextInputValue('nota'));
                    const comentario = interaction.fields.getTextInputValue('comentario');
                    await reportChatSystem.closeTicket(interaction, session.ticketId, nota, comentario);
                    sessionManager.delete(interaction.user.id, interaction.guildId, 'reportchat', 'closing');
                }
                return;
            }
            
            // ==================== COMPONENTES ====================
            if (interaction.isButton() || interaction.isStringSelectMenu() || 
                interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
                
                if (!interaction.customId) {
                    return await ResponseManager.error(interaction, 'Configuração inválida.');
                }
                
                const needsDefer = !interaction.customId.endsWith(':modal');
                
                if (needsDefer && !interaction.deferred && !interaction.replied) {
                    await ResponseManager.defer(interaction);
                }
                
                await handler.handleComponent(interaction);
                return;
            }
            
            // ==================== MODAIS ====================
            if (interaction.isModalSubmit()) {
                if (!interaction.customId || !interaction.customId.includes(':')) {
                    return await ResponseManager.error(interaction, 'Formato de modal inválido.');
                }
                
                await ResponseManager.send(interaction, {
                    content: '⏳ Processando...',
                    ephemeral: true
                });
                
                await handler.handleModal(interaction);
                return;
            }
            
        } catch (error) {
            console.error(`❌ Erro fatal no interactionCreate:`, error);
            
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await ResponseManager.error(interaction, 'Ocorreu um erro fatal. Tente novamente mais tarde.');
                } else if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply({ content: '❌ Ocorreu um erro fatal. Tente novamente mais tarde.' });
                }
            } catch (err) {
                console.error('❌ Erro ao enviar mensagem de erro:', err);
            }
        }
    }
};