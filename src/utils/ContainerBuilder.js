/**
 * ContainerBuilder.js
 * Wrapper fluente para a API de Components V2 do Discord.js 14.26+
 *
 * Uso básico:
 *   const { build } = require('./ContainerBuilder');
 *   const container = build({ color: 0x57F287 })
 *     .title('Meu título')
 *     .text('Algum conteúdo')
 *     .line()
 *     .sectionWithThumb('Texto da seção', 'https://url-da-imagem.png')
 *     .buttons(CF.button('id_ok', 'Confirmar', 'success'))
 *     .footer()
 *     .done();
 *
 *   await interaction.reply({
 *     components: [container],
 *     flags: MessageFlags.IsComponentsV2,
 *   });
 */

'use strict';

const {
    ContainerBuilder,
    SectionBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,   // nome correto no 14.26
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SeparatorSpacingSize,
} = require('discord.js');

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Garante que o argumento seja um array. */
const toArray = (v) => (Array.isArray(v) ? v : [v]);

/** Cria um TextDisplayBuilder a partir de uma string. */
const txt = (content) => new TextDisplayBuilder().setContent(String(content));

// ---------------------------------------------------------------------------
// Classe principal
// ---------------------------------------------------------------------------

class ContainerBuilderWrapper {
    /**
     * @param {object} [opts]
     * @param {number}  [opts.accentColor]   - Cor lateral do container (hex int)
     * @param {string}  [opts.serverName]    - Nome do servidor p/ o footer padrão
     * @param {string}  [opts.footerSupport] - URL do servidor de suporte
     */
    constructor(opts = {}) {
        this._container   = new ContainerBuilder();
        this._components  = [];   // fila de componentes a adicionar no build()
        this._serverName  = opts.serverName    || 'Servidor';
        this._supportUrl  = opts.footerSupport || 'https://discord.gg/sEpW8tQ8tT';

        if (opts.accentColor != null) {
            this._container.setAccentColor(opts.accentColor);
        }
    }

    // -----------------------------------------------------------------------
    // Texto / Headings
    // -----------------------------------------------------------------------

    /**
     * Adiciona um título em markdown (# / ## / ###).
     * @param {string} text
     * @param {1|2|3} [level=1]
     */
    title(text, level = 1) {
        const hashes = '#'.repeat(Math.max(1, Math.min(level, 3)));
        return this._push(txt(`${hashes} ${text}`));
    }

    /**
     * Adiciona um bloco de texto simples (suporta markdown).
     * @param {string} content
     */
    text(content) {
        return this._push(txt(content));
    }

    // -----------------------------------------------------------------------
    // Separador
    // -----------------------------------------------------------------------

    /**
     * Adiciona uma linha separadora.
     * @param {boolean} [divider=true]  - Exibe a linha visual
     * @param {'small'|'large'} [spacing='small']
     */
    line(divider = true, spacing = 'small') {
        const sep = new SeparatorBuilder()
            .setDivider(divider)
            .setSpacing(
                spacing === 'large'
                    ? SeparatorSpacingSize.Large
                    : SeparatorSpacingSize.Small,
            );
        return this._push(sep);
    }

    // -----------------------------------------------------------------------
    // Sections
    // -----------------------------------------------------------------------

    /**
     * Section com thumbnail (imagem lateral).
     * @param {string} textContent  - Texto da section (markdown ok)
     * @param {string} imageUrl     - URL da imagem thumbnail
     * @param {string} [altText=''] - Texto alternativo da imagem
     */
    sectionWithThumb(textContent, imageUrl, altText = '') {
        const section = new SectionBuilder()
            .addTextDisplayComponents(txt(textContent))
            .setThumbnailAccessory(
                new ThumbnailBuilder().setURL(imageUrl).setDescription(altText),
            );
        return this._push(section);
    }

    /**
     * Section com botão como acessório lateral.
     * @param {string}        textContent - Texto da section
     * @param {ButtonBuilder} button      - Botão criado com CF.button()
     */
    sectionWithButton(textContent, button) {
        if (!(button instanceof ButtonBuilder)) {
            throw new TypeError('sectionWithButton: o segundo argumento deve ser um ButtonBuilder.');
        }
        const section = new SectionBuilder()
            .addTextDisplayComponents(txt(textContent))
            .setButtonAccessory(button);
        return this._push(section);
    }

    // -----------------------------------------------------------------------
    // Action Row (botões / menus)
    // -----------------------------------------------------------------------

    /**
     * Adiciona uma fileira de botões (máx 5).
     * @param {...ButtonBuilder} btns
     */
    buttons(...btns) {
        const flat = btns.flat().filter((b) => b instanceof ButtonBuilder).slice(0, 5);
        if (flat.length === 0) return this;
        const row = new ActionRowBuilder();
        flat.forEach((b) => row.addComponents(b));
        return this._push(row);
    }

    /**
     * Adiciona um select menu em uma ActionRow.
     * @param {import('discord.js').AnySelectMenuBuilder} menu
     */
    menu(menu) {
        if (!menu || typeof menu.toJSON !== 'function') return this;
        return this._push(new ActionRowBuilder().addComponents(menu));
    }

    // -----------------------------------------------------------------------
    // Media Gallery
    // -----------------------------------------------------------------------

    /**
     * Adiciona uma galeria de imagens (máx 10).
     * @param {string[]} urls
     */
    gallery(urls) {
        if (!Array.isArray(urls) || urls.length === 0) return this;
        const gallery = new MediaGalleryBuilder();
        urls.slice(0, 10).forEach((url) => {
            gallery.addMediaItems(new MediaGalleryItemBuilder().setURL(url));
        });
        return this._push(gallery);
    }

    // -----------------------------------------------------------------------
    // Footer
    // -----------------------------------------------------------------------

    /**
     * Adiciona um rodapé padrão ou customizado.
     * @param {string|null} [custom] - Texto customizado; se null usa o padrão
     */
    footer(custom = null) {
        if (this._components.length) this.line(false); // separador sutil
        const content = custom
            ?? `Desenvolvido por Knust VI e T.Mach\n[Suporte](${this._supportUrl})\nServidor: ${this._serverName}`;
        return this.text(`> ${content}`);
    }

    // -----------------------------------------------------------------------
    // Build
    // -----------------------------------------------------------------------

    /**
     * Constrói e retorna o ContainerBuilder pronto para ser enviado.
     * @returns {ContainerBuilder}
     */
    done() {
        if (this._components.length === 0) {
            this.text('⚠️ Sem informações.');
        }

        for (const comp of this._components) {
            if (comp instanceof TextDisplayBuilder) {
                this._container.addTextDisplayComponents(comp);
            } else if (comp instanceof SeparatorBuilder) {
                this._container.addSeparatorComponents(comp);
            } else if (comp instanceof SectionBuilder) {
                this._container.addSectionComponents(comp);
            } else if (comp instanceof ActionRowBuilder) {
                this._container.addActionRowComponents(comp);
            } else if (comp instanceof MediaGalleryBuilder) {
                this._container.addMediaGalleryComponents(comp);
            }
        }

        return this._container;
    }

    // -----------------------------------------------------------------------
    // Interno
    // -----------------------------------------------------------------------

    _push(comp) {
        this._components.push(comp);
        return this;
    }
}

// ---------------------------------------------------------------------------
// Factory helper exportado
// ---------------------------------------------------------------------------

/**
 * Cria um novo ContainerBuilderWrapper.
 * @param {object} [opts] - Mesmas opções do construtor
 * @returns {ContainerBuilderWrapper}
 */
function build(opts = {}) {
    return new ContainerBuilderWrapper(opts);
}

module.exports = { ContainerBuilderWrapper, build };