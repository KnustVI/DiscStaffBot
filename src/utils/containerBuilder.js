'use strict';

/**
 * containerBuilder.js
 *
 * API simples para construção de interfaces Components V2 do Discord.
 * Compatível com Discord.js 14.26.4 (API Components V2).
 *
 * Uso:
 *   const { AdvancedContainerBuilder, COLORS } = require('./containerBuilder');
 *
 *   const builder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });
 *   builder
 *     .banner('title_strike') // opcional: imagem de assets/images no lugar do title()
 *     .section('**Usuário:** Fulano', AdvancedContainerBuilder.thumbnail(avatarUrl))
 *     .separator()
 *     .block(['🛡️ Moderador: Staff', '📉 Pontos: -10'])
 *     .separator()
 *     .footer(guild.name); // -# Produzido por KnustVI e T.Mach | Server: {guild.name}
 *
 *   const payload = builder.build();
 *   // payload = { components: [ContainerBuilder], flags: MessageFlags.IsComponentsV2, files: [] }
 *   await interaction.editReply(payload); // files já vem pronto (vazio se não houver banner)
 */

const {
    ContainerBuilder,
    SectionBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require('discord.js');
const imageManager = require('./imageManager');

// ---------------------------------------------------------------------------
// Tipos de acessório (usados internamente para diferenciar thumbnail x button)
// ---------------------------------------------------------------------------
const ACCESSORY_TYPE = Object.freeze({
    THUMBNAIL: 'thumbnail',
    BUTTON: 'button',
});

// ---------------------------------------------------------------------------
// Paleta única de cores do bot — todo container deve usar uma destas três.
// DEFAULT também cobre estados neutros/de alerta leve (não há tom "warning").
// ---------------------------------------------------------------------------
const COLORS = Object.freeze({
    DEFAULT: 0xDCA15E,
    SUCCESS: 0x79FF72,
    ERROR: 0xFF4E3B,
});

const BRAND_FOOTER = 'Produzido por KnustVI e T.Mach';

// ---------------------------------------------------------------------------
// Classe principal
// ---------------------------------------------------------------------------
class AdvancedContainerBuilder {
    /**
     * @param {object} [options]
     * @param {number} [options.accentColor] - Cor de destaque do container (ver COLORS: DEFAULT/SUCCESS/ERROR)
     */
    constructor(options = {}) {
        this._accentColor = options.accentColor ?? COLORS.DEFAULT;

        /**
         * Lista única de componentes na ordem de inserção.
         * Cada entrada é um objeto interno que será convertido no build().
         *
         * @type {Array<{ kind: string, payload: * }>}
         */
        this.components = [];

        /**
         * Attachments (banners) acumulados via banner() — devolvidos por
         * build() em `files`, prontos para reply()/send()/edit().
         *
         * @type {Array<AttachmentBuilder>}
         */
        this._files = [];
    }

    // -----------------------------------------------------------------------
    // Métodos de construção (chainable)
    // -----------------------------------------------------------------------

    /**
     * Adiciona um título via TextDisplay com markdown de heading.
     *
     * @param {string} text   - Texto do título
     * @param {number} [level=1] - Nível do heading (1 = #, 2 = ##, 3 = ###)
     * @returns {this}
     */
    title(text, level = 1) {
        const clampedLevel = Math.min(Math.max(Math.floor(level), 1), 3);
        const prefix = '#'.repeat(clampedLevel);
        this.components.push({
            kind: 'textDisplay',
            payload: `${prefix} ${text}`,
        });
        return this;
    }

    /**
     * Adiciona um banner de topo (imagem de assets/images, ver ImageManager)
     * no lugar de title(), seguido de um separador. Resolve a URL (para a
     * galeria) e o attachment (arquivo de fato) a partir da mesma chave —
     * se a imagem não existir, não faz nada e o container segue normal.
     *
     * O attachment é acumulado internamente e devolvido por build() em
     * `files`, então quem envia a mensagem não precisa buscar o arquivo
     * separadamente nem repetir a chave.
     *
     * @param {string} key - Chave da imagem em assets/images (ver ImageManager.getUrl)
     * @returns {this}
     */
    banner(key) {
        const url = imageManager.getUrl(key);
        const attachment = imageManager.getAttachment(key);
        if (!url || !attachment) return this;

        this.components.push({ kind: 'gallery', payload: [url] });
        this._files.push(attachment);
        return this.separator();
    }

    /**
     * Resolve um ícone fixo de assets/images (ver ImageManager) como
     * acessório de thumbnail para uso em section() — mesmo espírito do
     * banner(): resolve URL + attachment pela mesma chave e já registra o
     * attachment em `_files` para sair pronto em build(). Usado no cabeçalho
     * de containers que não têm banner (ver seção() padrão de abertura),
     * quando o ícone é fixo em vez do avatar do servidor.
     *
     * Se a chave não existir, retorna null — quem chamou decide o fallback
     * (normalmente AdvancedContainerBuilder.thumbnail(guildIconUrl)).
     *
     * @param {string} key - Chave da imagem em assets/images
     * @returns {{ _accessoryType: string, _builder: ThumbnailBuilder } | null}
     */
    assetThumbnail(key) {
        const url = imageManager.getUrl(key);
        const attachment = imageManager.getAttachment(key);
        if (!url || !attachment) return null;

        this._files.push(attachment);
        return AdvancedContainerBuilder.thumbnail(url);
    }

    /**
     * Adiciona um bloco de texto simples via TextDisplay.
     *
     * @param {string} content - Conteúdo em markdown
     * @returns {this}
     */
    text(content) {
        this.components.push({
            kind: 'textDisplay',
            payload: String(content),
        });
        return this;
    }

    /**
     * Adiciona um bloco de linhas como um único TextDisplay.
     * As linhas são unidas por quebra de linha.
     *
     * @param {string[]} lines - Array de strings
     * @returns {this}
     */
    block(lines) {
        if (!Array.isArray(lines) || lines.length === 0) {
            throw new TypeError('block() requer um array não vazio de strings.');
        }
        this.components.push({
            kind: 'textDisplay',
            payload: lines.join('\n'),
        });
        return this;
    }

    /**
     * Adiciona um separador visual entre componentes.
     *
     * @param {object} [options]
     * @param {boolean} [options.divider=true]    - Exibe linha divisória
     * @param {'Small'|'Large'} [options.spacing='Small'] - Tamanho do espaçamento
     * @returns {this}
     */
    separator(options = {}) {
        this.components.push({
            kind: 'separator',
            payload: {
                divider: options.divider !== undefined ? Boolean(options.divider) : true,
                spacing: options.spacing === 'Large'
                    ? SeparatorSpacingSize.Large
                    : SeparatorSpacingSize.Small,
            },
        });
        return this;
    }

    /**
     * Adiciona uma Section com texto e acessório opcional (thumbnail ou botão).
     *
     * O acessório deve ser criado via os helpers estáticos:
     *   - AdvancedContainerBuilder.thumbnail(url)
     *   - AdvancedContainerBuilder.linkButton(label, url)
     *   - AdvancedContainerBuilder.primaryButton(customId, label)
     *   - AdvancedContainerBuilder.secondaryButton(customId, label)
     *   - AdvancedContainerBuilder.successButton(customId, label)
     *   - AdvancedContainerBuilder.dangerButton(customId, label)
     *
     * Ou pode ser passado null para uma section sem acessório.
     *
     * @param {string} text            - Texto da section (suporta markdown)
     * @param {object|null} [accessory=null] - Acessório criado pelos helpers estáticos
     * @returns {this}
     */
    section(text, accessory = null) {
        this.components.push({
            kind: 'section',
            payload: {
                text: String(text),
                accessory: accessory ?? null,
            },
        });
        return this;
    }

    /**
     * Adiciona uma galeria de imagens (MediaGallery).
     * Suporta até 10 URLs.
     *
     * @param {string[]} imageUrls - Array de URLs de imagem
     * @returns {this}
     */
    gallery(imageUrls) {
        if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
            throw new TypeError('gallery() requer um array não vazio de URLs.');
        }
        if (imageUrls.length > 10) {
            throw new RangeError('gallery() suporta no máximo 10 imagens por galeria.');
        }
        this.components.push({
            kind: 'gallery',
            payload: imageUrls.map(String),
        });
        return this;
    }

    /**
     * Adiciona uma linha de botões via ActionRow.
     * Aceita ButtonBuilder criados pelos helpers estáticos ou diretamente.
     *
     * @param {...ButtonBuilder} buttons - Um ou mais botões
     * @returns {this}
     */
    buttons(...buttons) {
        const flat = buttons.flat();
        if (flat.length === 0) {
            throw new TypeError('buttons() requer pelo menos um botão.');
        }
        if (flat.length > 5) {
            throw new RangeError('buttons() suporta no máximo 5 botões por ActionRow.');
        }
        this.components.push({
            kind: 'actionRow',
            payload: flat,
        });
        return this;
    }

    /**
     * Adiciona uma linha com um menu de seleção (StringSelectMenuBuilder,
     * RoleSelectMenuBuilder etc.) — sempre sozinho na ActionRow, já que o
     * Discord só permite um menu de seleção por linha (diferente de
     * buttons(), que aceita até 5).
     *
     * Se footer() já tiver sido chamado antes (ordem comum quando o menu é
     * montado só depois do container, ex: /ajuda trocando de tópico), o
     * select entra ANTES do rodapé, não depois — o rodapé do bot deve
     * sempre ser a última coisa visível no container.
     *
     * @param {StringSelectMenuBuilder} menu
     * @returns {this}
     */
    selectMenu(menu) {
        const entry = { kind: 'actionRow', payload: [menu] };
        const footerIndex = this.components.findIndex(c => c.isFooter);
        if (footerIndex !== -1) {
            this.components.splice(footerIndex, 0, entry);
        } else {
            this.components.push(entry);
        }
        return this;
    }

    /**
     * Adiciona o rodapé padrão do bot: sempre contém a assinatura
     * "Produzido por KnustVI e T.Mach | Server: {guildName}". Um `extra`
     * opcional (ex: "Página 2/5", "Solicitado por Fulano") é prefixado antes
     * da assinatura, na mesma linha.
     *
     * @param {string} guildName - Nome do servidor onde o container foi gerado
     * @param {string} [extra] - Contexto adicional específico deste container
     * @returns {this}
     */
    footer(guildName, extra = null) {
        const brand = `${BRAND_FOOTER} | Server: ${guildName || 'Servidor'}`;
        const text = extra ? `${extra} • ${brand}` : brand;
        this.components.push({
            kind: 'textDisplay',
            payload: `-# ${text}`,
            isFooter: true,
        });
        return this;
    }

    // -----------------------------------------------------------------------
    // Build
    // -----------------------------------------------------------------------

    /**
     * Serializa todos os componentes em um ContainerBuilder do Discord.js
     * e retorna o payload pronto para uso em interaction.reply() ou channel.send().
     *
     * @returns {{ components: ContainerBuilder[], flags: number }}
     */
    build() {
        const container = new ContainerBuilder();

        if (this._accentColor !== null) {
            container.setAccentColor(this._accentColor);
        }

        for (const entry of this.components) {
            switch (entry.kind) {

                case 'textDisplay': {
                    container.addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(entry.payload),
                    );
                    break;
                }

                case 'separator': {
                    container.addSeparatorComponents(
                        new SeparatorBuilder()
                            .setDivider(entry.payload.divider)
                            .setSpacing(entry.payload.spacing),
                    );
                    break;
                }

                case 'section': {
                    const section = new SectionBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(entry.payload.text),
                        );

                    const acc = entry.payload.accessory;
                    if (acc !== null) {
                        if (acc._accessoryType === ACCESSORY_TYPE.THUMBNAIL) {
                            section.setThumbnailAccessory(acc._builder);
                        } else if (acc._accessoryType === ACCESSORY_TYPE.BUTTON) {
                            section.setButtonAccessory(acc._builder);
                        }
                    }

                    container.addSectionComponents(section);
                    break;
                }

                case 'gallery': {
                    const items = entry.payload.map(
                        (url) => new MediaGalleryItemBuilder().setURL(url),
                    );
                    container.addMediaGalleryComponents(
                        new MediaGalleryBuilder().addItems(...items),
                    );
                    break;
                }

                case 'actionRow': {
                    const row = new ActionRowBuilder().setComponents(...entry.payload);
                    container.addActionRowComponents(row);
                    break;
                }

                default:
                    throw new Error(`Tipo de componente desconhecido: "${entry.kind}"`);
            }
        }

        return {
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            files: this._files,
        };
    }

    // -----------------------------------------------------------------------
    // Helpers estáticos — acessórios para section()
    // -----------------------------------------------------------------------

    /**
     * Cria um acessório Thumbnail para uso em section().
     *
     * @param {string} url         - URL da imagem
     * @param {string} [altText=''] - Texto alternativo (acessibilidade)
     * @returns {{ _accessoryType: string, _builder: ThumbnailBuilder }}
     */
    static thumbnail(url, altText = '') {
        const builder = new ThumbnailBuilder().setURL(String(url));
        if (altText) {
            builder.setDescription(String(altText));
        }
        return { _accessoryType: ACCESSORY_TYPE.THUMBNAIL, _builder: builder };
    }

    /**
     * Cria um botão de link (URL) para uso em section() ou buttons().
     *
     * @param {string} label - Texto do botão
     * @param {string} url   - URL de destino
     * @returns {ButtonBuilder}
     */
    static linkButton(label, url) {
        return new ButtonBuilder()
            .setLabel(String(label))
            .setURL(String(url))
            .setStyle(ButtonStyle.Link);
    }

    /**
     * Cria um botão primário (azul) para uso em section() ou buttons().
     *
     * @param {string} customId - ID personalizado do botão
     * @param {string} label    - Texto do botão
     * @returns {ButtonBuilder}
     */
    static primaryButton(customId, label) {
        return new ButtonBuilder()
            .setCustomId(String(customId))
            .setLabel(String(label))
            .setStyle(ButtonStyle.Primary);
    }

    /**
     * Cria um botão secundário (cinza) para uso em section() ou buttons().
     *
     * @param {string} customId - ID personalizado do botão
     * @param {string} label    - Texto do botão
     * @returns {ButtonBuilder}
     */
    static secondaryButton(customId, label) {
        return new ButtonBuilder()
            .setCustomId(String(customId))
            .setLabel(String(label))
            .setStyle(ButtonStyle.Secondary);
    }

    /**
     * Cria um botão de sucesso (verde) para uso em section() ou buttons().
     *
     * @param {string} customId - ID personalizado do botão
     * @param {string} label    - Texto do botão
     * @returns {ButtonBuilder}
     */
    static successButton(customId, label) {
        return new ButtonBuilder()
            .setCustomId(String(customId))
            .setLabel(String(label))
            .setStyle(ButtonStyle.Success);
    }

    /**
     * Cria um botão de perigo (vermelho) para uso em section() ou buttons().
     *
     * @param {string} customId - ID personalizado do botão
     * @param {string} label    - Texto do botão
     * @returns {ButtonBuilder}
     */
    static dangerButton(customId, label) {
        return new ButtonBuilder()
            .setCustomId(String(customId))
            .setLabel(String(label))
            .setStyle(ButtonStyle.Danger);
    }

    // -----------------------------------------------------------------------
    // Helper estático para montar acessório de botão a partir de um ButtonBuilder
    // (uso interno: permite passar qualquer ButtonBuilder diretamente na section)
    // -----------------------------------------------------------------------

    /**
     * Encapsula um ButtonBuilder como acessório de section.
     * Útil quando o botão já foi criado com os helpers estáticos
     * e precisa ser passado como acessório:
     *
     *   section('texto', AdvancedContainerBuilder.buttonAccessory(
     *       AdvancedContainerBuilder.linkButton('Ver', 'https://...')
     *   ))
     *
     * Nota: linkButton(), primaryButton() etc. já retornam ButtonBuilder
     * diretamente e podem ser passados como acessório sem este wrapper —
     * o builder detecta automaticamente qualquer ButtonBuilder.
     *
     * @param {ButtonBuilder} buttonBuilder
     * @returns {{ _accessoryType: string, _builder: ButtonBuilder }}
     */
    static buttonAccessory(buttonBuilder) {
        if (!(buttonBuilder instanceof ButtonBuilder)) {
            throw new TypeError('buttonAccessory() requer uma instância de ButtonBuilder.');
        }
        return { _accessoryType: ACCESSORY_TYPE.BUTTON, _builder: buttonBuilder };
    }
}

// ---------------------------------------------------------------------------
// Patch interno: permite passar ButtonBuilder diretamente como acessório
// em section() sem precisar do wrapper buttonAccessory().
// Se o valor tiver _accessoryType já definido, é usado como está.
// Se for uma instância de ButtonBuilder sem _accessoryType, é encapsulado.
// ---------------------------------------------------------------------------
const _originalSectionProto = AdvancedContainerBuilder.prototype.section;
AdvancedContainerBuilder.prototype.section = function section(text, accessory = null) {
    let normalizedAccessory = accessory;

    if (
        accessory !== null &&
        accessory instanceof ButtonBuilder &&
        !accessory._accessoryType
    ) {
        normalizedAccessory = {
            _accessoryType: ACCESSORY_TYPE.BUTTON,
            _builder: accessory,
        };
    }

    return _originalSectionProto.call(this, text, normalizedAccessory);
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
AdvancedContainerBuilder.COLORS = COLORS;
module.exports = { AdvancedContainerBuilder, COLORS };