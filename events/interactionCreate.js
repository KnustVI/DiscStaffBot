const session = require('../systems/sessionManager');
const ErrorLogger = require('../systems/errorLogger');
const ConfigSystem = require('../systems/configSystem');

module.exports = {
    name: 'interactionCreate',

    async execute(interaction, client) {
        // 1. LOG DE ENTRADA (Para você saber que o evento disparou)
        console.log(`[EVENTO] Iniciando processamento: ${interaction.commandName || interaction.customId}`);

        try {
            // ==========================================
            // AÇÃO IMEDIATA: ACORDAR O DISCORD (APENAS COMPONENTES)
            // ==========================================
            if (interaction.isButton() || interaction.isAnySelectMenu()) {
                await interaction.deferUpdate().catch(() => null);
            }

            // ==========================================
            // LÓGICA DE SLASH COMMANDS
            // ==========================================
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) return;

                await command.execute(interaction);
                return;
            }

            // ==========================================
            // LÓGICA DE COMPONENTES (BOTÕES/MODAIS)
            // ==========================================
            const customId = interaction.customId;
            const parts = customId.split(':');
            const prefix = parts[0];

            // Verificação de Sessão (Apenas para CONFIG)
            if (prefix === 'config') {
                const userSession = session.get(interaction.user.id);
                if (!userSession) {
                    const msg = '⏳ **Sessão expirada.** Use `/config` novamente.';
                    return interaction.isModalSubmit() 
                        ? interaction.editReply({ content: msg }) 
                        : interaction.followUp({ content: msg, ephemeral: true });
                }
            }

            // DIRECIONAMENTO PARA OS HANDLERS
            switch (prefix) {
                case 'config': {
                    const ConfigHandler = require('../systems/configHandler');
                    interaction.isModalSubmit() 
                        ? await ConfigHandler.handleModal?.(interaction, parts)
                        : await ConfigHandler.handle(interaction, parts);
                    break;
                }
                case 'ticket': {
                    const TicketHandler = require('../systems/ticketHandler');
                    interaction.isModalSubmit()
                        ? await TicketHandler.handleModal?.(interaction, parts)
                        : await TicketHandler.handle(interaction, parts);
                    break;
                }
                case 'hist': {
                    const HistoryHandler = require('../systems/historyHandler');
                    await HistoryHandler.handle(interaction, parts);
                    break;
                }
            }

        } catch (error) {
            console.error(`[ERRO CRÍTICO] Interaction: ${interaction.customId || interaction.commandName}`, error);
            ErrorLogger.log('Interaction_Error', error);

            const errorMsg = '❌ Ocorreu um erro ao processar sua solicitação.';
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: errorMsg }).catch(() => null);
            } else {
                await interaction.reply({ content: errorMsg, ephemeral: true }).catch(() => null);
            }
        }
    }
};