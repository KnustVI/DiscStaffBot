const InteractionHandler = require('../systems/handlers');
const ResponseManager = require('../utils/responseManager');

let handler = null;

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (!handler) {
            handler = new InteractionHandler(client);
        }
        
        try {
            // ==================== SLASH COMMANDS ====================
            if (interaction.isCommand()) {
                const isEphemeral = ['config', 'strike', 'unstrike', 'repset', 'config-rep', 'config-strike'].includes(interaction.commandName);
                await ResponseManager.defer(interaction, isEphemeral);
                await handler.handleCommand(interaction);
                return;
            }
            
            // ==================== COMPONENTES ====================
            if (interaction.isButton() || interaction.isStringSelectMenu() || 
                interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
                
                if (!interaction.customId) {
                    return await ResponseManager.error(interaction, 'Configuração inválida.');
                }
                
                // 🔥 REGRA: Botões que terminam com ':modal' NÃO recebem defer
                // Exemplo: config-strike:edit (sem modal) vs config-strike:modal (com modal)
                const needsDefer = !interaction.customId.endsWith(':modal');
                
                if (needsDefer) {
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
                
                //await ResponseManager.send(interaction, {
                //    content: '⏳ Processando...',
                //    ephemeral: true
                //});
                
                await handler.handleModal(interaction);
                return;
            }

            // ==================== TICKET SYSTEM ====================
            const TicketSystem = require('../systems/ticketSystem');
            const ticketSystem = new TicketSystem(client);

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
            
        } catch (error) {
            console.error(`❌ Erro fatal:`, error);
            
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await ResponseManager.error(interaction, 'Ocorreu um erro fatal.');
                } else if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply({ content: '❌ Ocorreu um erro fatal.' });
                }
            } catch (err) {
                console.error('❌ Erro ao enviar mensagem:', err);
            }
        }
    }
};