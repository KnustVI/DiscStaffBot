// src/utils/paginationBuilder.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { AdvancedContainerBuilder } = require('./containerBuilder');

let EMOJIS = {};
try {
    EMOJIS = require('../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

/**
 * Sistema de paginação para AdvancedContainerBuilder
 * Gerencia múltiplas páginas com navegação por botões
 */
class PaginationBuilder {
    /**
     * @param {Object} options
     * @param {number} [options.accentColor=0xDCA15E] - Cor padrão do container
     * @param {number} [options.timeout=120000] - Tempo de expiração em ms (padrão: 2min)
     *
     * Nota: o rodapé (com a assinatura padrão do bot) é responsabilidade de
     * cada página — chame builder.footer(guildName) dentro da função que
     * monta a página, igual a qualquer outro container. O número da página
     * já aparece no botão central de navegação, então a paginação não
     * precisa adicionar um rodapé próprio.
     */
    constructor(options = {}) {
        this.accentColor = options.accentColor || 0xDCA15E;
        this.timeout = options.timeout || 120000;
        this.pages = [];
        this.currentPage = 0;
        this.interaction = null;
        this.collector = null;
        this.buttons = {
            prev: { label: 'Anterior', style: ButtonStyle.Secondary },
            next: { label: 'Próxima', style: ButtonStyle.Secondary },
        };

        // ── NOVO: arquivos (attachments) a serem enviados em TODA mensagem
        // da paginação (ex: banner de título referenciado via attachment://
        // dentro do container). O Discord exige que o attachment seja
        // reenviado em cada editReply para a referência continuar válida,
        // então guardamos aqui e reutilizamos em toda transição de página. ──
        this.files = [];
    }

    /**
     * NOVO: Define os arquivos (AttachmentBuilder[]) que devem acompanhar
     * TODAS as mensagens desta paginação (ex: banner de título referenciado
     * via attachment:// dentro do container).
     *
     * @param {Array} files - Array de AttachmentBuilder (ou compatível)
     * @returns {this}
     */
    setFiles(files) {
        this.files = Array.isArray(files) ? files.filter(Boolean) : (files ? [files] : []);
        return this;
    }

    /**
     * Adiciona uma página ao sistema
     * @param {Function|AdvancedContainerBuilder} pageBuilder - Função que retorna um builder ou um builder pronto
     * @returns {this}
     */
    addPage(pageBuilder) {
        if (typeof pageBuilder === 'function') {
            this.pages.push({ builder: pageBuilder });
        } else if (pageBuilder instanceof AdvancedContainerBuilder) {
            this.pages.push({ builder: () => pageBuilder });
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
     * @param {number} totalPages - Total de páginas
     * @returns {ActionRowBuilder}
     */
    _buildNavRow(customIdPrefix, totalPages) {
        const { prev, next } = this.buttons;
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${customIdPrefix}_prev_${this.currentPage}`)
                .setLabel(prev.label)
                .setEmoji(EMOJIS.paginaanterior || '◀')
                .setStyle(prev.style)
                .setDisabled(this.currentPage === 0),
            new ButtonBuilder()
                .setCustomId(`${customIdPrefix}_next_${this.currentPage}`)
                .setLabel(next.label)
                .setEmoji(EMOJIS.paginaproxima || '▶')
                .setStyle(next.style)
                .setDisabled(this.currentPage === totalPages - 1),
            new ButtonBuilder()
                .setCustomId(`${customIdPrefix}_page_${this.currentPage}`)
                .setLabel(`${this.currentPage + 1}/${totalPages}`)
                .setEmoji(EMOJIS.filetext || '📄')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );
    }

    /**
     * Gera os botões desabilitados (fim do coletor)
     * @param {string} customIdPrefix - Prefixo para os IDs dos botões
     * @returns {ActionRowBuilder}
     */
    _buildDisabledNavRow(customIdPrefix) {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${customIdPrefix}_prev_disabled`)
                .setLabel(this.buttons.prev.label)
                .setEmoji(EMOJIS.paginaanterior || '◀')
                .setStyle(this.buttons.prev.style)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`${customIdPrefix}_next_disabled`)
                .setLabel(this.buttons.next.label)
                .setEmoji(EMOJIS.paginaproxima || '▶')
                .setStyle(this.buttons.next.style)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`${customIdPrefix}_page_disabled`)
                .setLabel(`${this.currentPage + 1}/${this.pages.length}`)
                .setEmoji(EMOJIS.filetext || '📄')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );
    }

    /**
     * Constrói uma página específica
     * @param {number} index - Índice da página
     * @returns {Object} { components, flags }
     */
    _buildPage(index) {
        const page = this.pages[index];
        const builder = page.builder();
        return builder.build();
    }

    /**
     * Prepara o payload para envio
     * @param {number} index - Índice da página
     * @param {string} customIdPrefix - Prefixo para os IDs
     * @returns {Object}
     */
    _buildPayload(index, customIdPrefix) {
        const { components, flags, files: pageFiles } = this._buildPage(index);
        const navRow = this._buildNavRow(customIdPrefix, this.pages.length);
        const payload = {
            components: [...components, navRow],
            flags,
        };

        // ── Reanexa os arquivos em toda transição de página. Precisa incluir
        // TANTO os arquivos globais da paginação (this.files, via setFiles())
        // QUANTO os registrados pela própria página (ex: builder.assetThumbnail()
        // dentro da função que monta aquela página) — sem isso, um thumbnail
        // via attachment:// fica referenciando um arquivo que nunca foi
        // anexado, e o Discord rejeita com 50035 "Invalid Form Body" em
        // components. editReply também não preserva attachments anteriores
        // automaticamente quando o payload de components é substituído. ──────
        const allFiles = [...this.files, ...(pageFiles || [])];
        if (allFiles.length > 0) {
            payload.files = allFiles;
        }

        return payload;
    }

    /**
     * Inicia a paginação em uma interação
     * @param {CommandInteraction} interaction - A interação do comando
     * @param {Object} options
     * @param {string} [options.customIdPrefix] - Prefixo para IDs dos botões (auto-gerado se não especificado)
     * @param {boolean} [options.ephemeral] - Se a mensagem deve ser efêmera
     * @param {Array} [options.files] - NOVO: Attachments a enviar (alternativa a setFiles())
     * @returns {Promise<Object>} - O payload final para resposta
     */
    async start(interaction, options = {}) {
        this.interaction = interaction;
        const customIdPrefix = options.customIdPrefix || `pag_${Date.now()}_${interaction.user.id}`;
        const ephemeral = options.ephemeral || false;

        // NOVO: permite passar files também via options de start(), não só setFiles()
        if (options.files) {
            this.setFiles(options.files);
        }

        // Payload inicial.
        // IMPORTANTE: nunca incluir `content` junto de MessageFlags.IsComponentsV2 —
        // o Discord rejeita com "MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2".
        // Toda informação visível deve estar dentro do próprio Container (title/text/footer).
        const payload = this._buildPayload(0, customIdPrefix);

        if (ephemeral) {
            payload.flags = payload.flags | MessageFlags.Ephemeral;
        }

        // Envia a mensagem inicial verificando se já está deferida
        try {
            if (interaction.deferred) {
                await interaction.editReply(payload);
            } else if (interaction.replied) {
                await interaction.followUp(payload);
            } else {
                await interaction.reply(payload);
            }
        } catch (error) {
            // ── console.error(msg, error) trunca objetos aninhados a partir do
            // 3º nível (ex: error.rawError.errors.components vira "[Object]"),
            // escondendo exatamente o campo que o Discord rejeitou. Aqui o
            // detalhe importa, então força profundidade total. ─────────────
            console.error('❌ Erro ao enviar resposta inicial da paginação:', require('util').inspect(error, { depth: null }));
            throw error;
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
            try {
                // Verifica se a interação ainda é válida
                if (!i.isRepliable()) {
                    console.warn('⚠️ Interação não pode ser respondida');
                    return;
                }

                // Defesa contra dupla resposta: só deferimos se a interação ainda
                // não tiver sido respondida/deferida por nenhum outro handler
                // (ex: um bloco genérico no interactionCreate.js capturando o
                // mesmo customId antes deste collector). Tentar deferUpdate()
                // duas vezes na mesma interação gera "Unknown interaction" (10062).
                if (!i.deferred && !i.replied) {
                    await i.deferUpdate();
                }

                const isPrev = i.customId.startsWith(`${customIdPrefix}_prev_`);
                const isNext = i.customId.startsWith(`${customIdPrefix}_next_`);

                if (isPrev) {
                    this.currentPage = Math.max(0, this.currentPage - 1);
                } else if (isNext) {
                    this.currentPage = Math.min(this.pages.length - 1, this.currentPage + 1);
                }

                const newPayload = this._buildPayload(this.currentPage, customIdPrefix);
                await i.editReply(newPayload);
            } catch (error) {
                console.error('❌ Erro no coletor de paginação:', error);
            }
        });

        this.collector.on('end', async () => {
            try {
                const { components, flags, files: pageFiles } = this._buildPage(this.currentPage);
                const disabledRow = this._buildDisabledNavRow(customIdPrefix);

                // Reanexa os arquivos também na mensagem final (collector expirado) —
                // mesmo motivo do _buildPayload acima.
                const finalPayload = {
                    components: [...components, disabledRow],
                    flags,
                };
                const allFiles = [...this.files, ...(pageFiles || [])];
                if (allFiles.length > 0) {
                    finalPayload.files = allFiles;
                }

                await interaction.editReply(finalPayload);
            } catch (err) {
                // Interação pode ter expirado, ignorar
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
     * Reseta a paginação para a primeira página
     */
    reset() {
        this.currentPage = 0;
    }

    /**
     * Retorna o número total de páginas
     * @returns {number}
     */
    getTotalPages() {
        return this.pages.length;
    }

    /**
     * Retorna a página atual
     * @returns {number}
     */
    getCurrentPage() {
        return this.currentPage;
    }

    /**
     * Verifica se há próxima página
     * @returns {boolean}
     */
    hasNext() {
        return this.currentPage < this.pages.length - 1;
    }

    /**
     * Verifica se há página anterior
     * @returns {boolean}
     */
    hasPrev() {
        return this.currentPage > 0;
    }
}

module.exports = { PaginationBuilder };