const InteractionHandler = require('../systems/handlers');

let handler = null;

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // Inicializa o handler uma única vez (cache)
        if (!handler) {
            handler = new InteractionHandler(client);
        }
        
        try {
            // Slash Commands
            if (interaction.isCommand()) {
                // Defer padrão (ephemeral para comandos que começam com 'config' ou privados)
                const isEphemeral = interaction.commandName === 'config' || 
                                    interaction.commandName === 'strike' ||
                                    interaction.commandName === 'unstrike';
                
                await interaction.deferReply({ ephemeral: isEphemeral });
                await handler.handleCommand(interaction);
                return;
            }
            
            // Componentes (Botões e Select Menus)
            if (interaction.isButton() || interaction.isStringSelectMenu()) {
                // Validação do customId antes de tudo
                if (!interaction.customId || !interaction.customId.includes(':')) {
                    await interaction.update({ 
                        content: '❌ Formato de interação inválido.', 
                        components: [] 
                    });
                    return;
                }
                
                await interaction.update({});
                await handler.handleComponent(interaction);
                return;
            }
            
            // Modais
            if (interaction.isModalSubmit()) {
                // Validação do customId
                if (!interaction.customId || !interaction.customId.includes(':')) {
                    await interaction.reply({ 
                        content: '❌ Formato de modal inválido.', 
                        ephemeral: true 
                    });
                    return;
                }
                
                await interaction.reply({ content: '⏳ Processando...', ephemeral: true });
                await handler.handleModal(interaction);
                return;
            }
            
        } catch (error) {
            console.error(`❌ Erro fatal no interactionCreate:`, error);
            
            // Fallback de segurança: garantir resposta
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: '❌ Ocorreu um erro fatal ao processar esta interação.', 
                    ephemeral: true 
                }).catch(() => {});
            } else if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ 
                    content: '❌ Ocorreu um erro fatal ao processar esta interação.' 
                }).catch(() => {});
            }
        }
    }
};