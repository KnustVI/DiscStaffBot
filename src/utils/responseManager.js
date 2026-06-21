// /home/ubuntu/DiscStaffBot/src/utils/responseManager.js
const { MessageFlags } = require('discord.js');

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
     * Detecta e converte corretamente builders para o formato de envio.
     *
     * IMPORTANTE: MessageFlags.IsComponentsV2 é um valor NUMÉRICO (bitfield).
     * Nunca usar a string 'IsComponentsV2' — isso silenciosamente gera um
     * payload de flags inválido e pode causar comportamento inconsistente
     * nas respostas (incluindo falhas que parecem "interação expirada").
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
                return { components: [result], flags: MessageFlags.IsComponentsV2 };
            }
            // Se result é um array de componentes
            if (Array.isArray(result)) {
                return { components: result, flags: MessageFlags.IsComponentsV2 };
            }
            // Fallback: construir manualmente
            return { components: [result], flags: MessageFlags.IsComponentsV2 };
        }

        // Se é um ContainerBuilder (tem toJSON)
        if (payload && payload.toJSON && typeof payload.toJSON === 'function') {
            return { components: [payload], flags: MessageFlags.IsComponentsV2 };
        }

        // Se é um array de componentes (ex: [container, row])
        if (Array.isArray(payload)) {
            return { components: payload, flags: MessageFlags.IsComponentsV2 };
        }

        // Se tem components mas não flags, pode ser container solto
        if (payload && payload.components && Array.isArray(payload.components)) {
            if (payload.components[0] && payload.components[0].toJSON) {
                return { components: payload.components, flags: MessageFlags.IsComponentsV2 };
            }
            // Já tem components, adiciona flags
            return { ...payload, flags: payload.flags ?? MessageFlags.IsComponentsV2 };
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

            // Se payload tem flags e components, é Components V2.
            // REGRA DO DISCORD: uma mensagem com MessageFlags.IsComponentsV2
            // NUNCA pode incluir `content` ou `embeds` — isso é rejeitado com
            // "MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2". Por isso,
            // ao detectar Components V2, removemos esses campos legados
            // explicitamente, mesmo que tenham vindo por engano em `opts`.
            if (payload.components && payload.flags !== undefined) {
                const { content, embeds, ...safePayload } = payload;
                if (content !== undefined || embeds !== undefined) {
                    console.warn(
                        `[ResponseManager] ⚠️ 'content'/'embeds' removidos de um payload Components V2 (interaction ${interaction.id})`
                    );
                }

                if (interaction.replied) {
                    return await interaction.followUp(safePayload);
                }
                if (interaction.deferred) {
                    return await interaction.editReply(safePayload);
                }
                if (this._isComponent(interaction)) {
                    return await interaction.update(safePayload);
                }
                return await interaction.reply(safePayload);
            }

            // Payload padrão (legado: content, embeds, components clássicos)
            const { content, embeds = [], components = [], ephemeral = false } = payload;
            const replyOptions = { content, embeds, components };
            if (ephemeral) replyOptions.flags = MessageFlags.Ephemeral;

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
                return await interaction.followUp({ content: '❌ Ocorreu um erro.', flags: MessageFlags.Ephemeral });
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
                await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });
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
        return this.send(interaction, { content: `✅ ${message}`, flags: MessageFlags.Ephemeral, ...opts });
    }

    async error(interaction, message, opts = {}) {
        return this.send(interaction, { content: `❌ ${message}`, flags: MessageFlags.Ephemeral, ...opts });
    }

    async warning(interaction, message, opts = {}) {
        return this.send(interaction, { content: `⚠️ ${message}`, ...opts });
    }
}

module.exports = new ResponseManager();