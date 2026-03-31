const { MessageFlags } = require('discord.js');

module.exports = {
    name: 'interactionCreate',

    async execute(interaction, client) {
        try {
            // 1. SLASH COMMANDS
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) return;

                // Problema 1: Acorda o Discord imediatamente
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                await command.execute(interaction);
                return;
            }

            // 2. COMPONENTES (Botões e Menus)
            if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
                const parts = interaction.customId?.split(':') || [];
                const prefix = parts[0];

                // Validação de Sessão Contextualizada (Problema 3)
                if (['config', 'ticket', 'hist'].includes(prefix)) {
                    const userSession = client.systems.sessions.get(interaction.guildId, interaction.user.id, prefix);
                    
                    if (!userSession && !interaction.isModalSubmit()) {
                        return await interaction.reply({ 
                            content: '⏳ Sessão expirada. Inicie o comando novamente.', 
                            flags: [MessageFlags.Ephemeral] 
                        }).catch(() => null);
                    }
                }

                // Handler dinâmico (Problema 2: Usando client.systems)
                switch (prefix) {
                    case 'config':
                        if (interaction.isModalSubmit()) await client.systems.config.handleModal?.(interaction, parts);
                        else await client.systems.config.handle(interaction, parts);
                        break;
                    
                    case 'hist':
                        const HistoryHandler = require('../systems/historyHandler'); // Caso não esteja no client.systems ainda
                        await HistoryHandler.handle(interaction, parts);
                        break;

                    // Adicione outros cases conforme necessário
                }
            }

        } catch (error) {
            console.error(`[ERRO] InteractionCreate:`, error);
            client.systems.logger.log('Interaction_Error', error);
        }
    }
};