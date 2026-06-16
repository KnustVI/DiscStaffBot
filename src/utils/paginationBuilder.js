// src/utils/paginationBuilder.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { AdvancedContainerBuilder } = require('./containerBuilder');

/**
 * Sistema de paginação para AdvancedContainerBuilder
 * Gerencia múltiplas páginas com navegação por botões
 */
class PaginationBuilder {
    /**
     * @param {Object} options
     * @param {number} [options.accentColor=0xDCA15E] - Cor padrão do container
     * @param {number} [options.timeout=120000] - Tempo de expiração em ms (padrão: 2min)
     * @param {string} [options.footerText] - Texto padrão do rodapé
     */
    constructor(options = {}) {
        this.accentColor = options.accentColor || 0xDCA15E;
        this.timeout = options.timeout || 120000;
        this.footerText = options.footerText || '';
        this.pages = [];
        this.currentPage = 0;
        this.interaction = null;
        this.collector = null;
        this.buttons = {
            prev: { label: '◀ Anterior', style: ButtonStyle.Secondary },
            next: { label: 'Próxima ▶', style: ButtonStyle.Secondary },
        };
    }

    /**
     * Adiciona uma página ao sistema
     * @param {Function|AdvancedContainerBuilder} pageBuilder - Função que retorna um builder ou um builder pronto
     * @param {string} [footer] - Rodapé específico da página (sobrescreve o padrão)
     * @returns {this}
     */
    addPage(pageBuilder, footer = null) {
        if (typeof pageBuilder === 'function') {
            this.pages.push({ builder: pageBuilder, footer });
        } else if (pageBuilder instanceof AdvancedContainerBuilder) {
            this.pages.push({ builder: () => pageBuilder, footer });
        } else {
            throw new TypeError('pageBuilder deve ser uma função ou AdvancedContainerBuilder');
        }
        return this;
    }

    /**
     * Adiciona múltiplas páginas de uma vez
     * @param {Array<Function|AdvancedContainerBuilder>} pages
     * @returns {this}
     */
    addPages(...pages) {
        pages.forEach(page => this.addPage(page));
        return this;
    }

    /**
     * Configura os botões de navegação
     * @param {Object} buttons
     * @param {string} [buttons.prev.label] - Label do botão anterior
     * @param {string} [buttons.next.label] - Label do botão próximo
     * @param {ButtonStyle} [buttons.prev.style] - Estilo do botão anterior
     * @param {ButtonStyle} [buttons.next.style] - Estilo do botão próximo
     * @returns {this}
     */
    setButtons(buttons = {}) {
        if (buttons.prev) {
            this.buttons.prev = { ...this.buttons.prev, ...buttons.prev };
        }
        if (buttons.next) {
            this.buttons.next = { ...this.buttons.next, ...buttons.next };
        }
        return this;
    }

    /**
     * Gera os botões de navegação para a página atual
     * @param {string} customIdPrefix - Prefixo para os IDs dos botões
     * @returns {ActionRowBuilder}
     */
    _buildNavRow(customIdPrefix, totalPages) {
        const { prev, next } = this.buttons;
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${customIdPrefix}_prev_${this.currentPage}`)
                .setLabel(prev.label)
                .setStyle(prev.style)
                .setDisabled(this.currentPage === 0),
            new ButtonBuilder()
                .setCustomId(`${customIdPrefix}_next_${this.currentPage}`)
                .setLabel(next.label)
                .setStyle(next.style)
                .setDisabled(this.currentPage === totalPages - 1),
            // Adiciona um indicador de página
            new ButtonBuilder()
                .setCustomId(`${customIdPrefix}_page_${this.currentPage}`)
                .setLabel(`📄 ${this.currentPage + 1}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );
    }

    /**
     * Gera os botões desabilitados (fim do coletor)
     */
    _buildDisabledNavRow(customIdPrefix) {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${customIdPrefix}_prev_disabled`)
                .setLabel(this.buttons.prev.label)
                .setStyle(this.buttons.prev.style)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`${customIdPrefix}_next_disabled`)
                .setLabel(this.buttons.next.label)
                .setStyle(this.buttons.next.style)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`${customIdPrefix}_page_disabled`)
                .setLabel(`📄 ${this.currentPage + 1}/${this.pages.length}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );
    }

    /**
     * Constrói uma página específica
     * @param {number} index - Índice da página
     * @param {string} [customFooter] - Rodapé customizado
     * @returns {Object} { components, flags }
     */
    _buildPage(index, customFooter = null) {
        const page = this.pages[index];
        const builder = page.builder();
        const total = this.pages.length;
        const footer = customFooter || page.footer || this.footerText;
        
        // Se tiver rodapé e não foi adicionado ainda
        if (footer && !builder._hasFooter) {
            builder.footer(footer.replace('{page}', `${index + 1}/${total}`));
        }
        
        return builder.build();
    }

    /**
     * Prepara o payload para envio
     * @param {number} index - Índice da página
     * @param {string} customIdPrefix - Prefixo para os IDs
     * @param {string} [customFooter] - Rodapé customizado
     * @returns {Object}
     */
    _buildPayload(index, customIdPrefix, customFooter = null) {
        const { components, flags } = this._buildPage(index, customFooter);
        const navRow = this._buildNavRow(customIdPrefix, this.pages.length);
        return {
            components: [...components, navRow],
            flags,
        };
    }

    /**
     * Inicia a paginação em uma interação
     * @param {CommandInteraction} interaction - A interação do comando
     * @param {Object} options
     * @param {string} [options.customIdPrefix] - Prefixo para IDs dos botões (auto-gerado se não especificado)
     * @param {string} [options.footer] - Rodapé padrão
     * @param {boolean} [options.ephemeral] - Se a mensagem deve ser efêmera
     * @returns {Promise<Object>} - O payload final para resposta
     */
    async start(interaction, options = {}) {
        this.interaction = interaction;
        const customIdPrefix = options.customIdPrefix || `pag_${Date.now()}_${interaction.user.id}`;
        const footer = options.footer || this.footerText;
        const ephemeral = options.ephemeral || false;

        // Payload inicial
        const payload = this._buildPayload(0, customIdPrefix, footer);
        
        // Se for ephemeral, adiciona a flag
        if (ephemeral) {
            payload.flags = payload.flags | MessageFlags.Ephemeral;
        }

        // ✅ CORREÇÃO: Verifica se a interação já está deferida
        if (interaction.deferred) {
            await interaction.editReply(payload);
        } else {
            await interaction.reply(payload);
        }

        // Configura o coletor
        const filter = (i) => {
            return i.user.id === interaction.user.id && 
                   (i.customId.startsWith(`${customIdPrefix}_prev_`) || 
                    i.customId.startsWith(`${customIdPrefix}_next_`));
        };

        this.collector = interaction.channel.createMessageComponentCollector({
            filter,
            time: this.timeout,
        });

        this.collector.on('collect', async (i) => {
            // DeferUpdate é obrigatório para responder ao clique
            await i.deferUpdate();

            const isPrev = i.customId.startsWith(`${customIdPrefix}_prev_`);
            const isNext = i.customId.startsWith(`${customIdPrefix}_next_`);

            if (isPrev) {
                this.currentPage = Math.max(0, this.currentPage - 1);
            } else if (isNext) {
                this.currentPage = Math.min(this.pages.length - 1, this.currentPage + 1);
            }

            // Atualiza a mensagem
            const newPayload = this._buildPayload(this.currentPage, customIdPrefix, footer);
            await i.editReply(newPayload);
        });

        this.collector.on('end', async () => {
            try {
                const { components, flags } = this._buildPage(this.currentPage);
                const disabledRow = this._buildDisabledNavRow(customIdPrefix);
                await interaction.editReply({
                    components: [...components, disabledRow],
                    flags,
                });
            } catch (err) {
                // Interação pode ter expirado
            }
        });

        return payload;
    }

    /**
     * Para a paginação manualmente
     */
    stop() {
        if (this.collector) {
            this.collector.stop();
        }
    }

    /**
     * Verifica se o builder já tem footer
     */
    _hasFooter() {
        return this._footerAdded || false;
    }
}

module.exports = { PaginationBuilder };