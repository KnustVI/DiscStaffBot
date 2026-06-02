/**
 * ContainerFormatter.js
 * Helpers estáticos para criar elementos reutilizáveis nos containers.
 *
 * Uso:
 *   const CF = require('./ContainerFormatter');
 *   const { build } = require('./ContainerBuilder');
 *
 *   const container = build({ color: CF.colors.success, serverName: 'Meu Server' })
 *     .title('REPORT | #123')
 *     .sectionWithThumb(
 *       [
 *         CF.field('Status', 'Aberto'),
 *         CF.field('Motivo', 'Spam'),
 *       ].join('\n'),
 *       'https://cdn.example.com/avatar.png'
 *     )
 *     .line()
 *     .buttons(
 *       CF.button('close_report', '✅ Fechar', 'success'),
 *       CF.button('https://discord.com/channels/...', '💬 Chat', 'link'),
 *     )
 *     .footer()
 *     .done();
 *
 *   await interaction.reply({
 *     components: [container],
 *     flags: MessageFlags.IsComponentsV2,
 *   });
 */

'use strict';

const { ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { build } = require('./ContainerBuilder');

class ContainerFormatter {
    // -----------------------------------------------------------------------
    // Factory de containers
    // -----------------------------------------------------------------------

    /**
     * Cria um ContainerBuilderWrapper configurado.
     * @param {object} [opts]
     * @param {number}  [opts.color]        - Cor de accent (use CF.colors.*)
     * @param {string}  [opts.serverName]   - Nome do servidor
     * @param {string}  [opts.footerSupport]- URL do discord de suporte
     * @returns {import('./ContainerBuilder').ContainerBuilderWrapper}
     */
    static create(opts = {}) {
        return build({
            accentColor:   opts.color,
            serverName:    opts.serverName,
            footerSupport: opts.footerSupport,
        });
    }

    // -----------------------------------------------------------------------
    // Cores padrão
    // -----------------------------------------------------------------------

    static colors = {
        success : 0x57F287,
        error   : 0xED4245,
        warning : 0xFEE75C,
        info    : 0x5865F2,
        purple  : 0x9B59B6,
        orange  : 0xE67E22,
        blurple : 0x5865F2,
    };

    // -----------------------------------------------------------------------
    // Formatação de texto
    // -----------------------------------------------------------------------

    /**
     * Formata um campo "Label: valor", com valor opcionalmente em inline-code.
     * @param {string}  label
     * @param {string}  value
     * @param {boolean} [code=false] - Envolve o valor em backticks
     * @example CF.field('Status', 'Fechado')  →  "**Status:** Fechado"
     */
    static field(label, value, code = false) {
        const v = code ? `\`${value}\`` : value;
        return `**${label}:** ${v}`;
    }

    /**
     * Linha de paginação padronizada.
     * @param {number} page    - Página atual (1-based)
     * @param {number} total   - Total de páginas
     * @param {number} records - Total de registros
     */
    static pagination(page, total, records) {
        return `📄 Página **${page}**/**${total}** • ${records} registros`;
    }

    /**
     * Estrelas de avaliação (⭐ repetidas).
     * @param {number} score  - Nota (0–5)
     * @param {number} [max=5]
     */
    static stars(score, max = 5) {
        const filled = Math.max(0, Math.min(Math.round(score), max));
        return '⭐'.repeat(filled) + '☆'.repeat(max - filled);
    }

    // -----------------------------------------------------------------------
    // Criação de botões
    // -----------------------------------------------------------------------

    /**
     * Cria um ButtonBuilder.
     *
     * Para botão normal: passe `idOrUrl` como customId (string sem 'https://').
     * Para link:         passe `idOrUrl` como URL completa (começa com 'https://').
     * O estilo 'link' é definido automaticamente se a URL começar com 'https://'.
     *
     * @param {string} idOrUrl        - customId ou URL
     * @param {string} label          - Texto do botão
     * @param {'primary'|'secondary'|'success'|'danger'|'link'} [style='primary']
     * @param {string|null} [emoji]   - Emoji unicode ou objeto {name, id}
     * @param {boolean} [disabled=false]
     * @returns {ButtonBuilder}
     */
    static button(idOrUrl, label, style = 'primary', emoji = null, disabled = false) {
        const isLink = style === 'link' || idOrUrl.startsWith('https://') || idOrUrl.startsWith('http://');

        const styleMap = {
            primary   : ButtonStyle.Primary,
            secondary : ButtonStyle.Secondary,
            success   : ButtonStyle.Success,
            danger    : ButtonStyle.Danger,
            link      : ButtonStyle.Link,
        };

        const btn = new ButtonBuilder()
            .setLabel(label)
            .setStyle(isLink ? ButtonStyle.Link : (styleMap[style] ?? ButtonStyle.Primary))
            .setDisabled(disabled);

        if (isLink) {
            btn.setURL(idOrUrl);
        } else {
            btn.setCustomId(idOrUrl);
        }

        if (emoji) {
            btn.setEmoji(emoji);
        }

        return btn;
    }

    // -----------------------------------------------------------------------
    // Botões de navegação (paginação)
    // -----------------------------------------------------------------------

    /**
     * Retorna 4 botões de navegação (⏮ ◀ ▶ ⏭) para paginação.
     * @param {string} prefix  - Prefixo dos customIds (ex: 'hist_page')
     * @param {number} page    - Página atual
     * @param {number} total   - Total de páginas
     * @returns {ButtonBuilder[]}
     */
    static navButtons(prefix, page, total) {
        return [
            this.button(`${prefix}_first`, '⏮️', 'secondary', null, page <= 1),
            this.button(`${prefix}_prev`,  '◀️', 'secondary', null, page <= 1),
            this.button(`${prefix}_next`,  '▶️', 'secondary', null, page >= total),
            this.button(`${prefix}_last`,  '⏭️', 'secondary', null, page >= total),
        ];
    }

    // -----------------------------------------------------------------------
    // Reply helpers
    // -----------------------------------------------------------------------

    /**
     * Objeto de options de reply/followUp pronto para Components V2.
     * @param {import('discord.js').ContainerBuilder} container
     * @param {boolean} [ephemeral=false]
     * @returns {{ components: ContainerBuilder[], flags: number }}
     */
    static replyOptions(container, ephemeral = false) {
        let flags = MessageFlags.IsComponentsV2;
        if (ephemeral) flags |= MessageFlags.Ephemeral;
        return { components: [container], flags };
    }

    /**
     * Atalho: responde a uma interaction com um container.
     * Usa reply se ainda não foi respondido, senão editReply.
     * @param {import('discord.js').Interaction} interaction
     * @param {import('discord.js').ContainerBuilder} container
     * @param {boolean} [ephemeral=false]
     */
    static async reply(interaction, container, ephemeral = false) {
        const opts = this.replyOptions(container, ephemeral);
        if (interaction.deferred || interaction.replied) {
            return interaction.editReply(opts);
        }
        return interaction.reply(opts);
    }

    /**
     * Atalho: responde com followUp.
     * @param {import('discord.js').Interaction} interaction
     * @param {import('discord.js').ContainerBuilder} container
     * @param {boolean} [ephemeral=false]
     */
    static async followUp(interaction, container, ephemeral = false) {
        return interaction.followUp(this.replyOptions(container, ephemeral));
    }

    /**
     * Atalho: envia um container em um canal qualquer.
     * @param {import('discord.js').TextBasedChannel} channel
     * @param {import('discord.js').ContainerBuilder} container
     */
    static async send(channel, container) {
        return channel.send(this.replyOptions(container));
    }
}

module.exports = ContainerFormatter;