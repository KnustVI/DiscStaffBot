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

                if (!interaction.replied && !interaction.deferred) {
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
        if (
            interaction.isButton() ||
            interaction.isStringSelectMenu() ||
            interaction.isRoleSelectMenu() ||
            interaction.isChannelSelectMenu()
        ) {

            const customId = interaction.customId;
            const parts = customId.split(':');
            const prefix = parts[0];

            try {

                // =========================
                // SESSION CHECK
                // =========================
                const userSession = session.get(interaction.user.id);

                if (!userSession) {
                    return interaction.reply({
                        content: '⏳ Sessão expirada. Use o comando novamente.',
                        ephemeral: true
                    });
                }

                // =========================
                // ANTI-TIMEOUT (CRÍTICO)
                // =========================
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferUpdate().catch(() => null);
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

                    case 'ticket': {
                        const TicketHandler = require('../systems/ticketHandler');
                        await TicketHandler.handle(interaction, parts);
                        break;
                    }

                }

            } catch (error) {
                console.error(`[Component Error] ID: ${customId}`, error);

                if (!interaction.replied && !interaction.deferred) {
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

                // 🔥 evita timeout também em modal
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferReply({ ephemeral: true }).catch(() => null);
                }

                switch (prefix) {

                    case 'config': {
                        const ConfigHandler = require('../systems/configHandler');
                        if (ConfigHandler.handleModal) {
                            await ConfigHandler.handleModal(interaction, parts);
                        }
                        break;
                    }

                    case 'ticket': {
                        const TicketHandler = require('../systems/ticketHandler');
                        if (TicketHandler.handleModal) {
                            await TicketHandler.handleModal(interaction, parts);
                        }
                        break;
                    }

                }

            } catch (error) {
                console.error(`[Modal Error] ID: ${customId}`, error);

                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ Erro ao processar formulário.',
                        ephemeral: true
                    });
                }
            }
        }
    }
};