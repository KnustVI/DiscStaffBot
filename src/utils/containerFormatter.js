const ContainerBuilderWrapper = require('./ContainerBuilder');
const { ButtonBuilder, ButtonStyle } = require('discord.js');

class ContainerFormatter {
    // ========== MÉTODOS PRINCIPAIS ==========
    
    /**
     * Cria um novo builder com configurações padrão
     * @param {string} serverName - Nome do servidor
     * @param {number|null} color - Cor de acento (hex)
     * @returns {ContainerBuilderWrapper}
     */
    static create(serverName, color = null) {
        return new ContainerBuilderWrapper({ serverName, accentColor: color });
    }

    /**
     * @deprecated Use .create() em vez de .createBuilder()
     * Mantido para compatibilidade com código antigo
     */
    static createBuilder(serverName, accentColor = null) {
        return this.create(serverName, accentColor);
    }

    // ========== CORES CONTEXTUAIS ==========
    
    static colors = {
        success: 0xBBF96A,   // Verde - ações positivas
        error: 0xF64B4E,     // Vermelho - erros/perigo
        warning: 0xFF0000,   // Amarelo - avisos
        info: 0xDCA15E       // Azul/Dourado - informações gerais
    };

    // ========== HELPERS DE FORMATAÇÃO ==========
    
    /**
     * Formata um campo label: valor
     * @param {string} label - Rótulo do campo
     * @param {string|number} value - Valor do campo
     * @param {boolean} code - Se deve formatar como código inline
     * @returns {string}
     */
    static field(label, value, code = false) {
        return `**${label}:** ${code ? `\`${value}\`` : value}`;
    }

    /**
     * Formata um campo com valor booleano
     * @param {string} label - Rótulo do campo
     * @param {boolean} value - Valor booleano
     * @returns {string}
     */
    static booleanField(label, value) {
        const status = value ? '✅ Sim' : '❌ Não';
        return `**${label}:** ${status}`;
    }

    /**
     * Cria um rodapé para paginação
     * @param {number} page - Página atual
     * @param {number} total - Total de páginas
     * @param {number} records - Total de registros
     * @returns {string}
     */
    static pagination(page, total, records) {
        return `📄 Página ${page}/${total} • ${records} registros`;
    }

    /**
     * @deprecated Use .pagination() em vez de .getHistoryFooter()
     */
    static getHistoryFooter(page, totalPages, totalRecords) {
        return this.pagination(page, totalPages, totalRecords);
    }

    /**
     * Obtém o texto do footer padrão
     * @param {string} serverName - Nome do servidor
     * @returns {string}
     */
    static getFooter(serverName) {
        return `Desenvolvido por Knust VI e T.Mach/[Suporte](https://discord.gg/sEpW8tQ8tT)\nServidor atual: ${serverName}`;
    }

    /**
     * Cria um rodapé com timestamp
     * @param {Date} date - Data opcional
     * @returns {string}
     */
    static timestamp(date = new Date()) {
        const timestamp = Math.floor(date.getTime() / 1000);
        return `🕐 Atualizado: <t:${timestamp}:R>`;
    }

    // ========== HELPERS DE BOTÕES ==========
    
    /**
     * Cria um botão padrão
     * @param {string} id - ID customizado (ou URL para link)
     * @param {string} label - Texto do botão
     * @param {string} style - Estilo: 'primary', 'secondary', 'success', 'danger', 'link'
     * @param {string|null} url - URL para botões link
     * @returns {ButtonBuilder}
     */
    static button(id, label, style = 'primary', url = null) {
        const styles = {
            primary: ButtonStyle.Primary,
            secondary: ButtonStyle.Secondary,
            success: ButtonStyle.Success,
            danger: ButtonStyle.Danger,
            link: ButtonStyle.Link
        };
        
        const btn = new ButtonBuilder()
            .setLabel(label)
            .setStyle(styles[style] || ButtonStyle.Primary);
        
        if (style === 'link' && url) {
            btn.setURL(url);
        } else {
            btn.setCustomId(id);
        }
        
        return btn;
    }

    /**
     * Cria botões de navegação para paginação
     * @param {string} prefix - Prefixo para IDs (ex: 'history')
     * @param {number} page - Página atual
     * @param {number} total - Total de páginas
     * @returns {ButtonBuilder[]}
     */
    static navButtons(prefix, page, total) {
        return [
            this.button(`${prefix}_first`, '⏮️', 'secondary').setDisabled(page === 1),
            this.button(`${prefix}_prev`, '◀️', 'secondary').setDisabled(page === 1),
            this.button(`${prefix}_next`, '▶️', 'secondary').setDisabled(page === total),
            this.button(`${prefix}_last`, '⏭️', 'secondary').setDisabled(page === total)
        ];
    }

    // ========== HELPERS DE FORMATAÇÃO DE TEXTO ==========
    
    /**
     * Cabeçalho estilizado para seções
     * @param {string} text - Texto do cabeçalho
     * @param {string} emoji - Emoji opcional
     * @returns {string}
     */
    static header(text, emoji = '📌') {
        return `## ${emoji} ${text}`;
    }

    /**
     * Subcabeçalho estilizado
     * @param {string} text - Texto do subcabeçalho
     * @param {string} emoji - Emoji opcional
     * @returns {string}
     */
    static subheader(text, emoji = '▸') {
        return `### ${emoji} ${text}`;
    }

    /**
     * Formata duração em string legível
     * @param {number} seconds - Segundos
     * @returns {string}
     */
    static formatDuration(seconds) {
        if (seconds < 60) return `${seconds} segundos`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)} minutos`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} horas`;
        return `${Math.floor(seconds / 86400)} dias`;
    }

    /**
     * Formata bytes em tamanho legível
     * @param {number} bytes - Bytes
     * @returns {string}
     */
    static formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Trunca texto com ellipsis
     * @param {string} text - Texto original
     * @param {number} maxLength - Tamanho máximo
     * @returns {string}
     */
    static truncate(text, maxLength = 100) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    }
}

module.exports = ContainerFormatter;