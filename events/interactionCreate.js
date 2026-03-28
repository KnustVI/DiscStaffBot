const session = require('../systems/sessionManager');
const ErrorLogger = require('../systems/errorLogger');
const ConfigSystem = require('../systems/configSystem'); // Importação que faltava!

module.exports = {
    name: 'interactionCreate',

    async execute(interaction, client) {
        // ADICIONE ESTA LINHA:
        console.log(`[EVENTO] Interação detectada: ${interaction.commandName || 'Botão/Modal'}`);
        // =========================
        // 1. SLASH COMMANDS (Comandos /)
        // =========================
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                // [NOVO] Validação Automática de Permissão/Configuração
                // Isso impede que o comando rode se o bot não estiver configurado
                const auth = await ConfigSystem.checkAuth(interaction);
                if (!auth.authorized) {
                    return interaction.reply({
                        content: auth.message || '❌ Você não tem permissão para usar este comando.',
                        ephemeral: true
                    }).catch(() => null);
                }

                console.log(`[EXEC] /${interaction.commandName} por ${interaction.user.tag}`);
                await command.execute(interaction);

            } catch (error) {
                ErrorLogger.log(`SlashError_${interaction.commandName}`, error);
                console.error(`[Slash Error] ${interaction.commandName}:`, error);

                const errorMsg = { content: '❌ Erro interno ao executar este comando.', ephemeral: true };
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(errorMsg).catch(() => null);
                } else {
                    await interaction.reply(errorMsg).catch(() => null);
                }
            }
            return;
        }

        // =========================
        // 2. COMPONENTES (Botões, Menus, Modais)
        // =========================
        if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
            const customId = interaction.customId;
            const parts = customId.split(':');
            const prefix = parts[0];

            try {
                // Lógica de Sessão para o prefixo 'config'
                if (prefix === 'config') {
                    const userSession = session.get(interaction.user.id);
                    if (!userSession) {
                        return interaction.reply({
                            content: '⏳ **Sessão expirada.** Use `/config` novamente.',
                            ephemeral: true
                        }).catch(() => null);
                    }
                }

                // ANTI-TIMEOUT: Deferir antes de processar
                if (!interaction.deferred && !interaction.replied) {
                    if (interaction.isModalSubmit()) {
                        await interaction.deferReply({ ephemeral: true }).catch(() => null);
                    } else {
                        await interaction.deferUpdate().catch(() => null);
                    }
                }

                // Direcionamento para Handlers
                switch (prefix) {
                    case 'config': {
                        const ConfigHandler = require('../systems/configHandler');
                        interaction.isModalSubmit() 
                            ? await ConfigHandler.handleModal?.(interaction, parts)
                            : await ConfigHandler.handle(interaction, parts);
                        break;
                    }

                    case 'hist': {
                        const HistoryHandler = require('../systems/historyHandler');
                        await HistoryHandler.handle(interaction, parts);
                        break;
                    }

                    case 'ticket': {
                        const TicketHandler = require('../systems/ticketHandler');
                        interaction.isModalSubmit()
                            ? await TicketHandler.handleModal?.(interaction, parts)
                            : await TicketHandler.handle(interaction, parts);
                        break;
                    }
                }

            } catch (error) {
                ErrorLogger.log(`InteractionError_${customId}`, error);
                console.error(`[Interaction Error] ID: ${customId}`, error);

                const errorMsg = { content: '❌ Erro ao processar ação.', ephemeral: true };
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp(errorMsg).catch(() => null);
                } else {
                    await interaction.reply(errorMsg).catch(() => null);
                }
            }
        }
    }
};