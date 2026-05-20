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
            let payload = options;
            
            // Se for um builder (tem build()), chama build()
            if (options && typeof options.build === 'function') {
                payload = { components: [options.build()], flags: ['IsComponentsV2'] };
            }
            
            // Se for um Container (tem toJSON ou é um builder)
            if (payload && payload.toJSON && typeof payload.toJSON === 'function') {
                payload = { components: [payload], flags: ['IsComponentsV2'] };
            }
            
            // Se já tem components mas não tem flags, pode ser container solto
            if (payload.components && !payload.flags) {
                // Verifica se o primeiro componente é um ContainerBuilder
                if (payload.components[0] && payload.components[0].toJSON) {
                    payload = { components: [payload.components[0]], flags: ['IsComponentsV2'] };
                }
            }
            
            // Payload de Container V2
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