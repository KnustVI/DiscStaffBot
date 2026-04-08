const InteractionHandler = require('../systems/handlers');
const ResponseManager = require('../utils/responseManager');
const TicketSystem = require('../systems/reportChatSystem');
const TicketFormatter = require('../utils/reportChatFormatter');
const sessionManager = require('../utils/sessionManager');

let handler = null;
let reportChatSystem = null;

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // Inicializar handler
        if (!handler) {
            handler = new InteractionHandler(client);
        }
        
        // Inicializar ticketSystem
        if (!ticketSystem) {
            ticketSystem = new TicketSystem(client);
        }
        
        try {
            // ==================== SLASH COMMANDS ====================
            if (interaction.isCommand()) {
                const isEphemeral = ['config', 'strike', 'unstrike', 'repset', 'config-rep', 'config-strike', 'ticket'].includes(interaction.commandName);
                await ResponseManager.defer(interaction, isEphemeral);
                await handler.handleCommand(interaction);
                return;
            }
            
            // ==================== TICKET SYSTEM (ANTES DOS COMPONENTES) ====================
            
            // Botão criar ticket
            if (interaction.customId === 'reportchat:create') {
                await reportChatSystem.createTicket(interaction);
                return;
            }
            
            // Botão entrar no ticket
            if (interaction.customId && interaction.customId.startsWith('reportchat:join:')) {
                const ticketId = interaction.customId.split(':')[2];
                await ticketSystem.joinTicket(interaction, ticketId);
                return;
            }
            
            // Botão fechar ticket
            if (interaction.customId && interaction.customId.startsWith('reportchat:close:rate:')) {
            const ticketId = interaction.customId.split(':')[3];
            const modal = ReportChatFormatter.createRatingModal();
            await interaction.showModal(modal);
            sessionManager.set(interaction.user.id, interaction.guildId, 'reportchat', 'closing', { ticketId, withRating: true }, 300000);
            return;
            }

            if (interaction.customId && interaction.customId.startsWith('reportchat:close:no-rate:')) {
            const ticketId = interaction.customId.split(':')[3];
            await reportChatSystem.closeTicket(interaction, ticketId, null, null);
            return;
            }
            
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
                
                // 🔥 REGRA: Botões que terminam com ':modal' NÃO recebem defer
                const needsDefer = !interaction.customId.endsWith(':modal');
                
                if (needsDefer && !interaction.deferred && !interaction.replied) {
                    await ResponseManager.defer(interaction);
                }
                
                await handler.handleComponent(interaction);
                return;
            }
            
            // ==================== MODAIS ====================
            if (interaction.isModalSubmit()) {
                // Modal fechar ticket
                if (interaction.customId === 'ticket:close:modal') {
                    const sessionManager = require('../utils/sessionManager');
                    const session = sessionManager.get(interaction.user.id, interaction.guildId, 'ticket', 'closing');
                    if (session && session.ticketId) {
                        const motivo = interaction.fields.getTextInputValue('motivo');
                        const resumo = interaction.fields.getTextInputValue('resumo');
                        const punicao = interaction.fields.getTextInputValue('punicao');
                        await ticketSystem.closeTicket(interaction, session.ticketId, motivo, resumo, punicao);
                        sessionManager.delete(interaction.user.id, interaction.guildId, 'ticket', 'closing');
                    }
                    return;
                }
                
                // Modal avaliar
                if (interaction.customId === 'ticket:rating') {
                    const nota = parseInt(interaction.fields.getTextInputValue('nota'));
                    const comentario = interaction.fields.getTextInputValue('comentario');
                    await ticketSystem.rateTicket(interaction, nota, comentario);
                    return;
                }
                
                // Outros modais
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