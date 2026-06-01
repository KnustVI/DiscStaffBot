const ContainerBuilderWrapper = require('./ContainerBuilder');
const { ButtonBuilder, ButtonStyle } = require('discord.js');

class ContainerFormatter {
    // ========== MÉTODO PRINCIPAL ==========
    static create(serverName, color = null) {
        return new ContainerBuilderWrapper({ serverName, accentColor: color });
    }

    // ========== ALIAS PARA COMPATIBILIDADE (NÃO REMOVER!) ==========
    // Mantém compatibilidade com código antigo que usa createBuilder
    static createBuilder(serverName, accentColor = null) {
        return this.create(serverName, accentColor);
    }

    // ========== CORES CONTEXTUAIS ==========
    static colors = {
        success: 0xBBF96A,
        error: 0xF64B4E,
        warning: 0xFF0000,
        info: 0xDCA15E
    };

    // ========== HELPERS ==========
    static field(label, value, code = false) {
        return `**${label}:** ${code ? `\`${value}\`` : value}`;
    }

    static pagination(page, total, records) {
        return `📄 Página ${page}/${total} • ${records} registros`;
    }

    static button(id, label, style = 'primary', url = null) {
        const styles = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };
        const btn = new ButtonBuilder().setLabel(label).setStyle(styles[style] || 1);
        return url ? btn.setURL(url) : btn.setCustomId(id);
    }

    static navButtons(prefix, page, total) {
        return [
            this.button(`${prefix}_first`, '⏮️', 'secondary').setDisabled(page === 1),
            this.button(`${prefix}_prev`, '◀️', 'secondary').setDisabled(page === 1),
            this.button(`${prefix}_next`, '▶️', 'secondary').setDisabled(page === total),
            this.button(`${prefix}_last`, '⏭️', 'secondary').setDisabled(page === total)
        ];
    }

    static getFooter(serverName) {
        return `Desenvolvido por Knust VI e T.Mach/[Suporte](https://discord.gg/sEpW8tQ8tT)\nServidor atual: ${serverName}`;
    }

    static getHistoryFooter(page, totalPages, totalRecords) {
        return this.pagination(page, totalPages, totalRecords);
    }
}

module.exports = ContainerFormatter;