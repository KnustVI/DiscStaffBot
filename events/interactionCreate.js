module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        // 1. Comandos de Barra (Slash)
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) return;
            try { await command.execute(interaction); } catch (e) { console.error(e); }
            return;
        }

        // 2. Componentes (Botões, Menus, Modals)
        if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
            const args = interaction.customId.split('_'); // Ex: ['config', 'staff', 'role']
            const prefix = args[0];

            // Roteador de Sistemas
            switch (prefix) {
                case 'config':
                    const ConfigHandler = require('../systems/configHandler');
                    await ConfigHandler.handle(interaction, args);
                    break;

                case 'hist':
                    // Você pode criar um systems/historyHandler.js depois
                    break;
                
                // Futuros sistemas: case 'ticket':, case 'verify':
            }
        }
    }
};