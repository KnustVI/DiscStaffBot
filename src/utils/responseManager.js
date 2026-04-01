/**
 * ResponseManager - Sistema Centralizado de Respostas
 * 
 * Decide automaticamente o método correto baseado no estado da interação:
 * - Se não respondida: usa reply()
 * - Se deferida: usa editReply()
 * - Se for componente: usa update()
 * - Se for modal: usa reply() (já tem defer automático)
 */

class ResponseManager {
    /**
     * Envia uma resposta para uma interação
     * @param {import('discord.js').BaseInteraction} interaction - Interação do Discord
     * @param {object} options - Opções da resposta
     * @param {string|object} options.content - Conteúdo da mensagem
     * @param {Array} options.embeds - Embeds para enviar
     * @param {Array} options.components - Componentes (botões, menus)
     * @param {boolean} options.ephemeral - Mensagem efêmera (apenas para reply)
     * @param {boolean} options.fetchReply - Se deve buscar a mensagem após enviar
     * @returns {Promise<import('discord.js').Message>}
     */
    static async send(interaction, options = {}) {
        const {
            content = null,
            embeds = [],
            components = [],
            ephemeral = false,
            fetchReply = false
        } = options;
        
        try {
            // Caso 1: Interação já foi respondida
            if (interaction.replied) {
                return await interaction.followUp({
                    content,
                    embeds,
                    components,
                    ephemeral,
                    fetchReply
                });
            }
            
            // Caso 2: Interação foi deferida
            if (interaction.deferred) {
                return await interaction.editReply({
                    content,
                    embeds,
                    components
                });
            }
            
            // Caso 3: É um componente (botão, select menu)
            if (interaction.isButton() || 
                interaction.isStringSelectMenu() || 
                interaction.isRoleSelectMenu() || 
                interaction.isChannelSelectMenu()) {
                return await interaction.update({
                    content,
                    embeds,
                    components
                });
            }
            
            // Caso 4: É um modal
            if (interaction.isModalSubmit()) {
                return await interaction.reply({
                    content,
                    embeds,
                    components,
                    ephemeral,
                    fetchReply
                });
            }
            
            // Caso 5: Comando slash ou qualquer outro
            return await interaction.reply({
                content,
                embeds,
                components,
                ephemeral,
                fetchReply
            });
            
        } catch (error) {
            console.error('❌ [ResponseManager] Erro ao enviar resposta:', error);
            
            // Fallback: tentar followUp como último recurso
            try {
                return await interaction.followUp({
                    content: content || '❌ Ocorreu um erro ao processar sua solicitação.',
                    embeds,
                    components,
                    ephemeral: true
                });
            } catch (fallbackError) {
                console.error('❌ [ResponseManager] Fallback também falhou:', fallbackError);
                throw error;
            }
        }
    }
    
    /**
     * Envia uma mensagem de sucesso padronizada
     */
    static async success(interaction, message, options = {}) {
        return await this.send(interaction, {
            content: `✅ ${message}`,
            ...options
        });
    }
    
    /**
     * Envia uma mensagem de erro padronizada
     */
    static async error(interaction, message, options = {}) {
        return await this.send(interaction, {
            content: `❌ ${message}`,
            ephemeral: true,
            ...options
        });
    }
    
    /**
     * Envia uma mensagem de aviso padronizada
     */
    static async warning(interaction, message, options = {}) {
        return await this.send(interaction, {
            content: `⚠️ ${message}`,
            ...options
        });
    }
    
    /**
     * Envia uma mensagem de info padronizada
     */
    static async info(interaction, message, options = {}) {
        return await this.send(interaction, {
            content: `ℹ️ ${message}`,
            ...options
        });
    }
    
    /**
     * Atualiza apenas componentes (útil para paginação)
     */
    static async updateComponents(interaction, components, options = {}) {
        const { embeds = [], content = null } = options;
        
        if (interaction.replied) {
            return await interaction.editReply({
                content,
                embeds,
                components
            });
        }
        
        return await interaction.update({
            content,
            embeds,
            components
        });
    }
    
    /**
     * Defer com tratamento automático
     */
    static async defer(interaction, ephemeral = false) {
        if (interaction.replied || interaction.deferred) {
            return;
        }
        
        if (interaction.isCommand()) {
            await interaction.deferReply({ flags: ephemeral ? 64 : 0 });
        } else if (interaction.isButton() || interaction.isAnySelectMenu()) {
            await interaction.deferUpdate();
        }
    }
}

module.exports = ResponseManager;