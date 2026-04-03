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
                
                await ResponseManager.send(interaction, {
                    content: '⏳ Processando...',
                    ephemeral: true
                });
                
                await handler.handleModal(interaction);
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