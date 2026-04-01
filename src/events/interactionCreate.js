const InteractionHandler = require('../systems/handlers');
const ResponseManager = require('../utils/responseManager');

let handler = null;

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // Inicializa o handler uma única vez
        if (!handler) {
            handler = new InteractionHandler(client);
        }
        
        try {
            // ==================== SLASH COMMANDS ====================
            if (interaction.isCommand()) {
                const isEphemeral = ['config', 'strike', 'unstrike', 'repset'].includes(interaction.commandName);
                await ResponseManager.defer(interaction, isEphemeral);
                await handler.handleCommand(interaction);
                return;
            }
            
            // ==================== COMPONENTES (Botões e Select Menus) ====================
            if (interaction.isButton() || interaction.isStringSelectMenu() || 
                interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
                
                // Validar customId
                if (!interaction.customId) {
                    return await ResponseManager.error(interaction, 'Configuração inválida. Tente novamente.');
                }
                
                // Defer para componentes
                await ResponseManager.defer(interaction);
                await handler.handleComponent(interaction);
                return;
            }
            
            // ==================== MODAIS ====================
            if (interaction.isModalSubmit()) {
                // Validar customId
                if (!interaction.customId || !interaction.customId.includes(':')) {
                    return await ResponseManager.error(interaction, 'Formato de modal inválido.');
                }
                
                // Modais precisam de reply imediato
                await ResponseManager.send(interaction, {
                    content: '⏳ Processando...',
                    ephemeral: true
                });
                
                await handler.handleModal(interaction);
                return;
            }
            
        } catch (error) {
            console.error(`❌ Erro fatal no interactionCreate:`, error);
            
            // Tentar responder com erro amigável
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await ResponseManager.error(interaction, 'Ocorreu um erro fatal. Tente novamente mais tarde.');
                } else if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply({ 
                        content: '❌ Ocorreu um erro fatal. Tente novamente mais tarde.' 
                    });
                }
            } catch (err) {
                console.error('❌ Erro ao enviar mensagem de erro:', err);
            }
        }
    }
};