// /home/ubuntu/DiscStaffBot/src/utils/responseManager.js
/**
 * ResponseManager - Centraliza respostas
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
        if (this.processing.has(interaction.id)) {
            console.warn(`[ResponseManager] ⚠️ Ignorado: ${interaction.id}`);
            return null;
        }
        this.processing.add(interaction.id);

        try {
            // CORREÇÃO: Detecta se é um payload de Container V2
            if (options.flags && options.components) {
                if (interaction.replied) {
                    return await interaction.followUp(options);
                }
                if (interaction.deferred) {
                    return await interaction.editReply(options);
                }
                if (this._isComponent(interaction)) {
                    return await interaction.update(options);
                }
                return await interaction.reply(options);
            }

            // Payload padrão (content, embeds, components)
            const { content, embeds = [], components = [], ephemeral = false, flags } = options;
            const replyOptions = { content, embeds, components };
            if (ephemeral || flags === 64) replyOptions.flags = 64;

            if (interaction.replied) {
                return await interaction.followUp(replyOptions);
            }
            
            if (interaction.deferred) {
                return await interaction.editReply(replyOptions);
            }
            
            if (this._isComponent(interaction)) {
                return await interaction.update(replyOptions);
            }
            
            return await interaction.reply(replyOptions);

        } catch (error) {
            console.error(`[ResponseManager] ❌ Erro:`, {
                id: interaction.id,
                error: error.message
            });
            
            try {
                return await interaction.followUp({ 
                    content: '❌ Ocorreu um erro.', 
                    flags: 64
                });
            } catch (fallbackError) {
                console.error(`[ResponseManager] ❌ Fallback falhou:`, fallbackError.message);
                return null;
            }
        } finally {
            this.processing.delete(interaction.id);
        }
    }

    async defer(interaction, ephemeral = false) {
        if (interaction.replied || interaction.deferred) {
            return false;
        }

        try {
            if (interaction.isCommand()) {
                await interaction.deferReply({ flags: ephemeral ? 64 : 0 });
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
        return this.send(interaction, { content: `✅ ${message}`, flags: 64, ...opts });
    }

    async error(interaction, message, opts = {}) {
        return this.send(interaction, { content: `❌ ${message}`, flags: 64, ...opts });
    }

    async warning(interaction, message, opts = {}) {
        return this.send(interaction, { content: `⚠️ ${message}`, ...opts });
    }

    async updateComponents(interaction, components, opts = {}) {
        const { embeds = [], content } = opts;
        return this.send(interaction, { content, embeds, components });
    }
}

module.exports = new ResponseManager();