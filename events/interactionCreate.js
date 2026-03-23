module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        // --- 1. COMANDOS SLASH ---
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) return;
            try { 
                await command.execute(interaction); 
            } catch (e) { 
                console.error(`[Slash Error: ${interaction.commandName}]`, e);
            }
            return;
        }

        // --- 2. COMPONENTES (BOTÕES, MENUS, ETC) ---
        if (interaction.isButton() || interaction.isAnySelectMenu()) {
            const args = interaction.customId.split('_');
            const prefix = args[0]; // 'hist', 'config', etc.

            switch (prefix) {
                case 'hist':
                    const HistoryHandler = require('../systems/historyHandler');
                    await HistoryHandler.handle(interaction, args);
                    break;

                case 'config':
                    const ConfigHandler = require('../systems/configHandler');
                    await ConfigHandler.handle(interaction, args);
                    break;

                // Futuros sistemas como 'ticket' entram aqui com uma linha só!
            }
        }
    }
};