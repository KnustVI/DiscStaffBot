module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        // 1. Comandos de Barra (Slash)
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) return;
            try { 
                await command.execute(interaction); 
            } catch (error) { 
                console.error(`[Slash Error] ${interaction.commandName}:`, error);
            }
            return;
        }

        // 2. Componentes (Botões e Menus)
        if (interaction.isButton() || interaction.isAnySelectMenu()) {
            const args = interaction.customId.split('_');
            const prefix = args[0]; // 'config' ou 'hist'

            try {
                switch (prefix) {
                    case 'config':
                        const ConfigHandler = require('../systems/configHandler');
                        await ConfigHandler.handle(interaction, args);
                        break;

                    case 'hist':
                        const HistoryHandler = require('../systems/historyHandler');
                        await HistoryHandler.handle(interaction, args);
                        break;
                }
            } catch (error) {
                console.error(`[Component Error] ID: ${interaction.customId}`, error);
            }
        }
    }
};