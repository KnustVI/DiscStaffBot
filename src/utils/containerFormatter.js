const { ButtonBuilder, ButtonStyle } = require('discord.js');
const ContainerBuilderWrapper = require('./ContainerBuilder');

class ContainerFormatter {
    // Cria builder pronto
    static create(serverName, color = null) {
        return new ContainerBuilderWrapper({ serverName, accentColor: color });
    }

    // Cores prontas
    static colors = {
        success: 0x57F287,
        error: 0xED4245,
        warning: 0xFEE75C,
        info: 0x5865F2
    };

    // Campo label: valor
    static field(label, value, code = false) {
        return `**${label}:** ${code ? `\`${value}\`` : value}`;
    }

    // Rodapé de paginação
    static pagination(page, total, records) {
        return `📄 Página ${page}/${total} • ${records} registros`;
    }

    // Botão rápido
    static button(id, label, style = 'primary', url = null) {
        const styles = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };
        const btn = new ButtonBuilder().setLabel(label).setStyle(styles[style] || 1);
        return url ? btn.setURL(url) : btn.setCustomId(id);
    }

    static thumbnail(url) {
        const { ComponentType } = require('discord.js');
        return {
            type: ComponentType.Thumbnail,
            url: url
        };
    }   

    // Botões de navegação
    static navButtons(prefix, page, total) {
        return [
            this.button(`${prefix}_first`, '⏮️', 'secondary').setDisabled(page === 1),
            this.button(`${prefix}_prev`, '◀️', 'secondary').setDisabled(page === 1),
            this.button(`${prefix}_next`, '▶️', 'secondary').setDisabled(page === total),
            this.button(`${prefix}_last`, '⏭️', 'secondary').setDisabled(page === total)
        ];
    }
}

module.exports = ContainerFormatter;