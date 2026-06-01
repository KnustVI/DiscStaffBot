const ContainerBuilderWrapper = require('./ContainerBuilder');
const { ButtonStyle, ButtonBuilder } = require('discord.js');

/**
 * Formatter utilitário para criar containers formatados
 * Fornece métodos helpers para formatação comum
 */
class ContainerFormatter {
    /**
     * Obtém texto de rodapé padrão
     * @param {string} serverName - Nome do servidor
     * @returns {string}
     */
    static getFooter(serverName) {
        return `Desenvolvido por Knust VI e T.Mach/[Servidor de suporte](https://discord.gg/sEpW8tQ8tT)\nServidor atual: ${serverName}`;
    }

    /**
     * Cria um novo builder com configurações padrão
     * @param {string} serverName - Nome do servidor
     * @param {number|null} accentColor - Cor de acento (hex)
     * @returns {ContainerBuilderWrapper}
     */
    static createBuilder(serverName, accentColor = null) {
        return new ContainerBuilderWrapper({ 
            serverName: serverName, 
            accentColor: accentColor 
        });
    }

    /**
     * Formata um campo label: valor
     * @param {string} label - Rótulo do campo
     * @param {string|number} value - Valor do campo
     * @param {boolean} isCode - Se deve formatar como código inline
     * @returns {string}
     */
    static field(label, value, isCode = false) {
        const formattedValue = isCode ? `\`${value}\`` : value;
        return `**${label}:** ${formattedValue}`;
    }

    /**
     * Formata múltiplos campos em colunas
     * @param {Array<{label: string, value: string, isCode?: boolean}>} fields
     * @param {number} columns - Número de colunas (1-3)
     * @returns {string[]}
     */
    static fieldsToColumns(fields, columns = 2) {
        if (!fields || fields.length === 0) return [];
        
        columns = Math.min(Math.max(columns, 1), 3);
        const results = [];
        let currentColumn = [];
        
        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            const formatted = this.field(field.label, field.value, field.isCode || false);
            currentColumn.push(formatted);
            
            if (currentColumn.length === columns || i === fields.length - 1) {
                results.push(currentColumn.join(' • '));
                currentColumn = [];
            }
        }
        
        return results;
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
     * Formata um campo com lista de itens
     * @param {string} label - Rótulo do campo
     * @param {string[]} items - Lista de itens
     * @param {number} maxItems - Máximo de itens para mostrar
     * @returns {string}
     */
    static listField(label, items, maxItems = 5) {
        if (!items || items.length === 0) {
            return `**${label}:** Nenhum`;
        }
        
        const displayItems = items.slice(0, maxItems);
        const listText = displayItems.map(item => `• ${item}`).join('\n');
        const suffix = items.length > maxItems ? `\n*... e mais ${items.length - maxItems}*` : '';
        
        return `**${label}:**\n${listText}${suffix}`;
    }

    /**
     * Cria um rodapé para paginação
     * @param {number} page - Página atual
     * @param {number} totalPages - Total de páginas
     * @param {number} totalRecords - Total de registros
     * @returns {string}
     */
    static getHistoryFooter(page, totalPages, totalRecords) {
        return `📄 Página ${page}/${totalPages} • 📊 Total: ${totalRecords} registros`;
    }

    /**
     * Cria um rodapé com timestamp
     * @param {Date} date - Data opcional
     * @returns {string}
     */
    static getTimestampFooter(date = new Date()) {
        const timestamp = Math.floor(date.getTime() / 1000);
        return `🕐 Atualizado: <t:${timestamp}:R>`;
    }

    /**
     * Obtém cor de acento baseada no tipo
     * @param {string} type - Tipo: 'success', 'error', 'warning', 'info', 'primary'
     * @returns {number}
     */
    static getAccentColor(type = 'info') {
        const colors = {
            success: 0x57F287,  // Verde
            error: 0xED4245,    // Vermelho
            warning: 0xFEE75C,  // Amarelo
            info: 0x5865F2,     // Azul
            primary: 0x5865F2,  // Azul (alias)
            blurple: 0x5865F2,  // Azul do Discord
            greyple: 0x99AAB5   // Cinza
        };
        return colors[type] || colors.info;
    }

    /**
     * Cria um botão padrão
     * @param {string} customId - ID customizado
     * @param {string} label - Texto do botão
     * @param {string} style - Estilo: 'primary', 'secondary', 'success', 'danger', 'link'
     * @param {string|null} url - URL para botões link
     * @returns {ButtonBuilder}
     */
    static createButton(customId, label, style = 'primary', url = null) {
        const styles = {
            primary: ButtonStyle.Primary,
            secondary: ButtonStyle.Secondary,
            success: ButtonStyle.Success,
            danger: ButtonStyle.Danger,
            link: ButtonStyle.Link
        };
        
        const button = new ButtonBuilder()
            .setLabel(label)
            .setStyle(styles[style] || ButtonStyle.Primary);
        
        if (style === 'link' && url) {
            button.setURL(url);
        } else {
            button.setCustomId(customId);
        }
        
        return button;
    }

    /**
     * Cria botões de navegação para paginação
     * @param {string} prefix - Prefixo para IDs (ex: 'history')
     * @param {number} currentPage - Página atual
     * @param {number} totalPages - Total de páginas
     * @returns {ButtonBuilder[]}
     */
    static createPaginationButtons(prefix, currentPage, totalPages) {
        const buttons = [];
        
        // Botão primeira página
        buttons.push(
            this.createButton(`${prefix}_first`, '⏮️', 'secondary')
                .setDisabled(currentPage === 1)
        );
        
        // Botão anterior
        buttons.push(
            this.createButton(`${prefix}_prev`, '◀️', 'secondary')
                .setDisabled(currentPage === 1)
        );
        
        // Indicador de página (não é botão, apenas texto)
        // Botão próximo
        buttons.push(
            this.createButton(`${prefix}_next`, '▶️', 'secondary')
                .setDisabled(currentPage === totalPages)
        );
        
        // Botão última página
        buttons.push(
            this.createButton(`${prefix}_last`, '⏭️', 'secondary')
                .setDisabled(currentPage === totalPages)
        );
        
        return buttons;
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
}

module.exports = ContainerFormatter;