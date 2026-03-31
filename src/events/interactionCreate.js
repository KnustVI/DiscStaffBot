const { MessageFlags, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'interactionCreate',
    /**
     * @param {import('discord.js').Interaction} interaction 
     */
    async execute(interaction) {
        const { client, guildId, user } = interaction;
        const { punishment, config, logger, emojis } = client.systems;
        const EMOJIS = emojis || {};

        try {
            // --- 1. COMANDOS SLASH ---
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) return;

                // Defer automático se o comando não o fizer (Segurança de 3s)
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                }

                return await command.execute(interaction);
            }

            // --- 2. PAGINAÇÃO DE HISTÓRICO (EXEMPLO DE COMPONENTE FIXO) ---
            if (interaction.isButton() && interaction.customId.startsWith('hist_')) {
                // Formato esperado: hist_[prev/next]_[targetId]_[page]
                const [ , action, targetId, page] = interaction.customId.split('_');
                
                await interaction.deferUpdate();

                const target = await client.users.fetch(targetId).catch(() => null);
                if (!target) return;

                const pageNum = parseInt(page);
                const historyData = await punishment.getUserHistory(guildId, targetId, pageNum);
                
                // Gera os novos elementos visuais via System
                const embed = punishment.generateHistoryEmbed(target, historyData, pageNum);
                const components = punishment.generateHistoryButtons(targetId, pageNum, historyData.totalPages);

                return await interaction.editReply({
                    embeds: [embed],
                    components: components ? [components] : []
                });
            }

            // --- 3. HANDLERS DINÂMICOS (BOTÕES, MENUS E MODALS) ---
            // Delegamos para sistemas específicos para não poluir este arquivo
            
            if (interaction.isButton() || interaction.isAnySelectMenu()) {
                const handler = client.systems.interactionHandler;
                if (handler) return await handler.handle(interaction);
            }

            if (interaction.isModalSubmit()) {
                const modalHandler = client.systems.modalHandler;
                if (modalHandler) return await modalHandler.handle(interaction);
            }

        } catch (error) {
            // Log centralizado de erros de interação
            if (logger) logger.log('Interaction_Router_Critical', error);
            console.error('💥 Erro no Roteador:', error);
            
            const errorMsg = `${EMOJIS.ERRO || '❌'} Ocorreu um erro ao processar sua solicitação.`;
            
            // Tratamento de Resposta Resiliente
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: errorMsg, components: [] });
                } else {
                    await interaction.reply({ 
                        content: errorMsg, 
                        flags: [MessageFlags.Ephemeral] 
                    });
                }
            } catch (retryError) {
                // Se até o erro falhar (ex: bot perdeu permissão de ver o canal), silenciamos para não crashar a instância
                if (logger) logger.log('Interaction_Error_Fallback_Fail', retryError);
            }
        }
    }
};