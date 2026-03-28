const session = require('../utils/sessionManager');
const ErrorLogger = require('../systems/errorLogger');

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
                ErrorLogger.log(`SlashError_${interaction.commandName}`, error);
                console.error(`[Slash Error] ${interaction.commandName}:`, error);

                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ Erro interno ao executar este comando.',
                        ephemeral: true
                    });
                }
            }
            return;
        }

        // =========================
        // COMPONENTES (BOTÕES / MENUS / MODAIS)
        // =========================
        if (
            interaction.isButton() || 
            interaction.isAnySelectMenu() || 
            interaction.isModalSubmit()
        ) {
            const customId = interaction.customId;
            const parts = customId.split(':');
            const prefix = parts[0];

            try {
                // =========================
                // LÓGICA DE SESSÃO FILTRADA
                // =========================
                // Apenas prefixos de CONFIGURAÇÃO exigem sessão ativa.
                // Tickets e Histórico devem funcionar sempre.
                const needsSession = ['config'].includes(prefix);
                
                if (needsSession) {
                    const userSession = session.get(interaction.user.id);
                    if (!userSession) {
                        return interaction.reply({
                            content: '⏳ **Sessão expirada.** Por segurança, use o comando de configuração novamente.',
                            ephemeral: true
                        });
                    }
                }

                // =========================
                // ANTI-TIMEOUT (DEFER)
                // =========================
                // Se for Modal, usamos deferReply. Se for Botão/Menu, deferUpdate.
                if (!interaction.deferred && !interaction.replied) {
                    if (interaction.isModalSubmit()) {
                        await interaction.deferReply({ ephemeral: true }).catch(() => null);
                    } else {
                        // Botões de ticket as vezes precisam de Reply, não Update. 
                        // Mas o deferUpdate é mais seguro para menus.
                        await interaction.deferUpdate().catch(() => null);
                    }
                }

                // =========================
                // DIRECIONAMENTO DE HANDLERS
                // =========================
                switch (prefix) {
                    case 'config': {
                        const ConfigHandler = require('../systems/configHandler');
                        if (interaction.isModalSubmit()) {
                            await ConfigHandler.handleModal?.(interaction, parts);
                        } else {
                            await ConfigHandler.handle(interaction, parts);
                        }
                        break;
                    }

                    case 'hist': {
                        const HistoryHandler = require('../systems/historyHandler');
                        await HistoryHandler.handle(interaction, parts);
                        break;
                    }

                    case 'ticket': {
                        const TicketHandler = require('../systems/ticketHandler');
                        if (interaction.isModalSubmit()) {
                            await TicketHandler.handleModal?.(interaction, parts);
                        } else {
                            await TicketHandler.handle(interaction, parts);
                        }
                        break;
                    }
                }

            } catch (error) {
                ErrorLogger.log(`InteractionError_${customId}`, error);
                console.error(`[Interaction Error] ID: ${customId}`, error);

                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ Ocorreu um erro ao processar sua ação.',
                        ephemeral: true
                    });
                }
            }
        }
    }
};