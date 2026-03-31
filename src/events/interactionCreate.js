const { MessageFlags } = require('discord.js');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        // 1. Garantir resposta imediata (Ponto 1 - Fim do "Não respondeu")
        // O ephemeral: true garante privacidade, ajuste se preferir público.
        await interaction.deferReply({ ephemeral: true });

        try {
            // --- ROTEAMENTO DE COMANDOS (SLASH) ---
            if (interaction.isChatInputCommand()) {
                const command = interaction.client.commands.get(interaction.commandName);
                if (!command) return await interaction.editReply('❌ Comando não encontrado.');
                
                return await command.execute(interaction);
            }

            // --- ROTEAMENTO DE COMPONENTES (BOTÕES/MENUS) ---
            if (interaction.isButton() || interaction.isAnySelectMenu()) {
                // Aqui chamamos o seu handler de sistemas (Ponto 2 - Cache lookup)
                // Exemplo: client.systems.interactionHandler.handle(interaction);
                const handler = interaction.client.systems.interactionHandler;
                if (handler) return await handler.handle(interaction);
            }

            // --- ROTEAMENTO DE MODALS ---
            if (interaction.isModalSubmit()) {
                const modalHandler = interaction.client.systems.modalHandler;
                if (modalHandler) return await modalHandler.handle(interaction);
            }

        } catch (error) {
            console.error('💥 Erro no Roteador de Interações:', error);
            
            // Tratamento de erro padronizado (Boas Práticas)
            const errorMsg = '❌ Ocorreu um erro ao processar esta ação.';
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: errorMsg });
            } else {
                await interaction.reply({ 
                    content: errorMsg, 
                    flags: [MessageFlags.Ephemeral] 
                });
            }
        }
    }
};