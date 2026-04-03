/**
 * ResponseManager - Centraliza respostas
 * Usa propriedades nativas do Discord como fonte da verdade
 */
class ResponseManager {
    constructor() {
        this.processing = new Set();
        setInterval(() => this.processing.clear(), 5 * 60 * 1000);
    }

    _isSelectMenu(interaction) {
        return interaction.isStringSelectMenu() ||
               interaction.isUserSelectMenu() ||
               interaction.isRoleSelectMenu() ||
               interaction.isChannelSelectMenu() ||
               interaction.isMentionableSelectMenu();
    }

    _isComponent(interaction) {
        return interaction.isButton() || this._isSelectMenu(interaction);
    }

    async send(interaction, options = {}) {
        // 🔒 Previne race condition
        if (this.processing.has(interaction.id)) {
            console.warn(`[ResponseManager] ⚠️ Ignorado: ${interaction.id}`);
            return null;
        }
        this.processing.add(interaction.id);

        const { content, embeds = [], components = [], ephemeral = false } = options;

        try {
            if (interaction.replied) {
                return await interaction.followUp({ content, embeds, components, ephemeral });
            }
            
            if (interaction.deferred) {
                return await interaction.editReply({ content, embeds, components });
            }
            
            if (this._isComponent(interaction)) {
                return await interaction.update({ content, embeds, components });
            }
            
            return await interaction.reply({ content, embeds, components, ephemeral });

        } catch (error) {
            console.error(`[ResponseManager] ❌ Erro:`, {
                id: interaction.id,
                error: error.message
            });
            
            try {
                return await interaction.followUp({ 
                    content: '❌ Ocorreu um erro.', 
                    ephemeral: true 
                });
            } catch (fallbackError) {
                console.error(`[ResponseManager] ❌ Fallback falhou:`, {
                    id: interaction.id,
                    error: fallbackError.message
                });
                return null;
            }
        } finally {
            // ✅ Libera imediatamente após finalizar
            this.processing.delete(interaction.id);
        }
    }

    async defer(interaction, ephemeral = false) {
        if (interaction.replied || interaction.deferred) {
            return false;
        }

        try {
            if (interaction.isCommand()) {
                await interaction.deferReply({ ephemeral });
            } else if (this._isComponent(interaction)) {
                await interaction.deferUpdate();
            } else {
                return false;
            }
            return true;
        } catch (error) {
            console.error(`[ResponseManager] ❌ defer error:`, error.message);
            return false;
        }
    }

    async success(interaction, message, opts = {}) {
        return this.send(interaction, { content: `✅ ${message}`, ephemeral: true, ...opts });
    }

    async error(interaction, message, opts = {}) {
        return this.send(interaction, { content: `❌ ${message}`, ephemeral: true, ...opts });
    }

    async warning(interaction, message, opts = {}) {
        return this.send(interaction, { content: `⚠️ ${message}`, ...opts });
    }

    async updateComponents(interaction, components, opts = {}) {
        const { embeds = [], content } = opts;
        return this.send(interaction, { content, embeds, components });
    }

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

module.exports = new ResponseManager();