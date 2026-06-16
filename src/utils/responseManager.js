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

    /**
     * Detecta e converte corretamente builders para o formato de envio
     */
    _normalizePayload(payload) {
        // Se já tem components e flags, está pronto
        if (payload.components && payload.flags !== undefined) {
            return payload;
        }

        // Se é um AdvancedContainerBuilder (tem build() e retorna { components, flags })
        if (payload && typeof payload.build === 'function') {
            const result = payload.build();
            // Se build() retornou { components, flags }
            if (result && result.components && result.flags !== undefined) {
                return result;
            }
            // Se build() retornou apenas o container (fallback)
            if (result && result.toJSON) {
                return { components: [result], flags: ['IsComponentsV2'] };
            }
            // Se result é um array de componentes
            if (Array.isArray(result)) {
                return { components: result, flags: ['IsComponentsV2'] };
            }
            // Fallback: construir manualmente
            return { components: [result], flags: ['IsComponentsV2'] };
        }

        // Se é um ContainerBuilder (tem toJSON)
        if (payload && payload.toJSON && typeof payload.toJSON === 'function') {
            return { components: [payload], flags: ['IsComponentsV2'] };
        }

        // Se é um array de componentes (ex: [container, row])
        if (Array.isArray(payload)) {
            return { components: payload, flags: ['IsComponentsV2'] };
        }

        // Se tem components mas não flags, pode ser container solto
        if (payload && payload.components && Array.isArray(payload.components)) {
            if (payload.components[0] && payload.components[0].toJSON) {
                return { components: payload.components, flags: ['IsComponentsV2'] };
            }
            // Já tem components, adiciona flags
            return { ...payload, flags: payload.flags || ['IsComponentsV2'] };
        }

        // Payload padrão (content, embeds, etc)
        return payload;
    }

    async send(interaction, options = {}) {
        if (this.processing.has(interaction.id)) {
            console.warn(`[ResponseManager] ⚠️ Ignorado: ${interaction.id}`);
            return null;
        }
        this.processing.add(interaction.id);

        try {
            // Normaliza o payload
            let payload = this._normalizePayload(options);

            // Se payload tem flags e components, é Components V2
            if (payload.flags && payload.components) {
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

            // Payload padrão
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