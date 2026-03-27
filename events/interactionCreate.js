const session = require('../utils/sessionManager');

module.exports = {
    name: 'interactionCreate',

    async execute(interaction, client) {

        // =========================
        // SLASH COMMANDS
        // =========================
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`[Slash Error] ${interaction.commandName}:`, error);

                if (!interaction.replied) {
                    await interaction.reply({
                        content: '❌ Erro ao executar comando.',
                        ephemeral: true
                    });
                }
            }

            return;
        }

        // =========================
        // COMPONENTES (BOTÕES / MENUS)
        // =========================
        if (interaction.isButton() || interaction.isStringSelectMenu()) {

            const customId = interaction.customId;

            // 🔥 Novo padrão (suporta futuro)
            const parts = customId.split(':');
            const prefix = parts[0]; // config, hist, ticket...

            try {

                // =========================
                // SESSION CHECK (IMPORTANTE)
                // =========================
                const userSession = session.get(interaction.user.id);

                if (!userSession) {
                    return interaction.reply({
                        content: '⏳ Sessão expirada. Use o comando novamente.',
                        ephemeral: true
                    });
                }

                // =========================
                // HANDLERS
                // =========================
                switch (prefix) {

                    case 'config': {
                        const ConfigHandler = require('../systems/configHandler');
                        await ConfigHandler.handle(interaction, parts);
                        break;
                    }

                    case 'hist': {
                        const HistoryHandler = require('../systems/historyHandler');
                        await HistoryHandler.handle(interaction, parts);
                        break;
                    }

                    // 🔥 FUTURO (ticket já preparado)
                    case 'ticket': {
                        const TicketHandler = require('../systems/ticketHandler');
                        await TicketHandler.handle(interaction, parts);
                        break;
                    }

                }

            } catch (error) {
                console.error(`[Component Error] ID: ${customId}`, error);

                if (!interaction.replied) {
                    await interaction.reply({
                        content: '❌ Erro ao processar interação.',
                        ephemeral: true
                    });
                }
            }
        }

        // =========================
        // MODAIS
        // =========================
        if (interaction.isModalSubmit()) {

            const customId = interaction.customId;
            const parts = customId.split(':');
            const prefix = parts[0];

            try {

                const userSession = session.get(interaction.user.id);

                if (!userSession) {
                    return interaction.reply({
                        content: '⏳ Sessão expirada. Use o comando novamente.',
                        ephemeral: true
                    });
                }

                switch (prefix) {

                    case 'config': {
                        const ConfigHandler = require('../systems/configHandler');
                        await ConfigHandler.handleModal(interaction, parts);
                        break;
                    }

                    case 'ticket': {
                        const TicketHandler = require('../systems/ticketHandler');
                        await TicketHandler.handleModal(interaction, parts);
                        break;
                    }

                }

            } catch (error) {
                console.error(`[Modal Error] ID: ${customId}`, error);

                if (!interaction.replied) {
                    await interaction.reply({
                        content: '❌ Erro ao processar formulário.',
                        ephemeral: true
                    });
                }
            }
        }
    }
};