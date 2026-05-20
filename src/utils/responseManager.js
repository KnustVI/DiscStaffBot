// /home/ubuntu/DiscStaffBot/src/utils/responseManager.js
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
            // CORREÇÃO: Garantir que o payload de Container V2 tenha o formato correto
            let payload = options;
            
            // Se for um builder (tem build()), chama build()
            if (options && typeof options.build === 'function') {
                payload = options.build();
            }
            
            // Se for payload de Container V2 (tem flags e components)
            if (payload.flags && payload.components) {
                // Garantir que components é um array
                if (!Array.isArray(payload.components)) {
                    payload.components = [payload.components];
                }
                // Garantir que a flag está no formato correto
                if (!payload.flags.includes('IsComponentsV2')) {
                    payload.flags = ['IsComponentsV2'];
                }
                
                if (interaction.replied) {
                    return await interaction.followUp(payload);
                }
                if (interaction.deferred) {
                    return await interaction.editReply(payload);
                }
                if (this._isComponent(interaction)) {
                    return await interaction.update(payload);
                }
                return await interaction.reply(payload);
            }

            // Payload padrão (content, embeds)
            const { content, embeds = [], components = [], ephemeral = false } = payload;
            const replyOptions = { content, embeds, components };
            if (ephemeral) replyOptions.flags = 64;

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
            console.error(`[ResponseManager] ❌ Erro:`, { id: interaction.id, error: error.message });
            try {
                return await interaction.followUp({ content: '❌ Ocorreu um erro.', flags: 64 });
            } catch (fallbackError) {
                return null;
            }
        } finally {
            this.processing.delete(interaction.id);
        }
    }

    async defer(interaction, ephemeral = false) {
        if (interaction.replied || interaction.deferred) return false;
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
}

module.exports = new ResponseManager();