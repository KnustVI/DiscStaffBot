const ResponseManager = require('../utils/responseManager');
const processing = new Set(); // Previne dupla execução

let commandHandler = null;
let componentHandler = null;
let modalHandler = null;

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // Previne dupla execução
        if (processing.has(interaction.id)) {
            return;
        }
        processing.add(interaction.id);
        
        // Lazy load handlers
        if (!commandHandler) {
            commandHandler = require('../handlers/commandHandler');
            componentHandler = require('../handlers/componentHandler');
            modalHandler = require('../handlers/modalHandler');
        }
        
        try {
            // ==================== SLASH COMMANDS ====================
            if (interaction.isCommand()) {
                const isEphemeral = ['config', 'strike', 'unstrike', 'repset'].includes(interaction.commandName);
                await ResponseManager.defer(interaction, isEphemeral);
                await commandHandler.execute(interaction);
                return;
            }
            
            // ==================== COMPONENTES ====================
            const isSelectMenu = interaction.isStringSelectMenu() ||
                                 interaction.isUserSelectMenu() ||
                                 interaction.isRoleSelectMenu() ||
                                 interaction.isChannelSelectMenu() ||
                                 interaction.isMentionableSelectMenu();
            
            if (interaction.isButton() || isSelectMenu) {
                if (!interaction.customId) {
                    return await ResponseManager.error(interaction, 'Configuração inválida.');
                }
                // Componentes NÃO precisam de defer automático
                await componentHandler.execute(interaction);
                return;
            }
            
            // ==================== MODAIS ====================
            if (interaction.isModalSubmit()) {
                if (!interaction.customId) {
                    return await ResponseManager.error(interaction, 'Formato inválido.');
                }
                // Modais: handler é responsável por responder
                await modalHandler.execute(interaction);
                return;
            }
            
        } catch (error) {
            console.error(`❌ Erro fatal:`, error);
            
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await ResponseManager.error(interaction, 'Ocorreu um erro fatal.');
                } else if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply({ content: '❌ Erro fatal.' });
                }
            } catch (err) {
                // fallback silencioso
            }
        } finally {
            setTimeout(() => processing.delete(interaction.id), 1000);
        }
    }
};