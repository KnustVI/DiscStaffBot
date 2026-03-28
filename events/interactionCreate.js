const { MessageFlags } = require('discord.js');
// Caminho correto: saindo de /events para /utils
const session = require('../utils/sessionManager');
const ErrorLogger = require('../systems/errorLogger');

module.exports = {
    name: 'interactionCreate',

    async execute(interaction, client) {
        // 1. LOG DE ENTRADA (Essencial para depuração no PM2)
        console.log(`[EVENTO] Interaction recebida: ${interaction.commandName || interaction.customId} por ${interaction.user.tag}`);

        try {
            // ==========================================
            // LÓGICA DE SLASH COMMANDS (CHAT INPUT)
            // ==========================================
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) {
                    console.error(`[ERRO] Comando não encontrado: ${interaction.commandName}`);
                    return;
                }

                // 2. ACORDA O DISCORD PRIMEIRO (Evita o "O aplicativo não respondeu")
                // Usamos o 'await' aqui para garantir que o comando só rode APÓS o defer ser aceito
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }).catch(err => {
                    console.error("[ERRO] Falha ao dar defer no comando:", err);
                });

                // 3. EXECUTA O COMANDO
                await command.execute(interaction);
                return; // Finaliza aqui para comandos
            }

            // ==========================================
            // AÇÃO PARA COMPONENTES (BOTÕES/MENUS)
            // ==========================================
            if (interaction.isButton() || interaction.isAnySelectMenu()) {
                // DeferUpdate avisa o Discord que recebemos o clique
                await interaction.deferUpdate().catch(() => null);
            }

            // LÓGICA DE PREFIXOS E HANDLERS
            const customId = interaction.customId;
            if (!customId) return;

            const parts = customId.split(':');
            const prefix = parts[0];

            // Verificação de Sessão (Exclusivo para Configurações)
            if (prefix === 'config') {
                const userSession = session.get(interaction.user.id);
                if (!userSession) {
                    const msg = '⏳ **Sessão expirada.** Use `/config` novamente.';
                    return await interaction.followUp({ content: msg, flags: [MessageFlags.Ephemeral] }).catch(() => null);
                }
            }

            // DIRECIONAMENTO PARA OS HANDLERS
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
                case 'ticket': {
                    const TicketHandler = require('../systems/ticketHandler');
                    if (interaction.isModalSubmit()) {
                        await TicketHandler.handleModal?.(interaction, parts);
                    } else {
                        await TicketHandler.handle(interaction, parts);
                    }
                    break;
                }
                case 'hist': {
                    const HistoryHandler = require('../systems/historyHandler');
                    await HistoryHandler.handle(interaction, parts);
                    break;
                }
            }

        } catch (error) {
            console.error(`[ERRO CRÍTICO] No evento interactionCreate:`, error);
            ErrorLogger.log('Interaction_Error', error);

            const errorMsg = '❌ Ocorreu um erro interno ao processar esta ação.';
            
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: errorMsg });
                } else {
                    await interaction.reply({ content: errorMsg, flags: [MessageFlags.Ephemeral] });
                }
            } catch (sendError) {
                // Silencia erros caso a interação já tenha expirado totalmente
            }
        }
    }
};