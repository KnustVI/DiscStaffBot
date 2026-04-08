const InteractionHandler = require('../systems/handlers');
const ResponseManager = require('../utils/responseManager');
const TicketSystem = require('../systems/ticketSystem');
const TicketFormatter = require('../utils/ticketFormatter');

let handler = null;
let ticketSystem = null;

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
            if (interaction.customId === 'ticket:create') {
                await ticketSystem.createTicket(interaction);
                return;
            }
            
            // Botão entrar no ticket
            if (interaction.customId && interaction.customId.startsWith('ticket:join:')) {
                const ticketId = interaction.customId.split(':')[2];
                await ticketSystem.joinTicket(interaction, ticketId);
                return;
            }
            
            // Botão fechar ticket
            if (interaction.customId && interaction.customId.startsWith('ticket:close:')) {
                const ticketId = interaction.customId.split(':')[2];
                const modal = TicketFormatter.createCloseModal();
                await interaction.showModal(modal);
                const sessionManager = require('../utils/sessionManager');
                sessionManager.set(interaction.user.id, interaction.guildId, 'ticket', 'closing', { ticketId }, 300000);
                return;
            }
            
            // Botão avaliar
            if (interaction.customId === 'ticket:rate') {
                const modal = TicketFormatter.createRatingModal();
                await interaction.showModal(modal);
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