/**
 * Utilitário para formatação padronizada de embeds
 */

const { EMOJIS } = require('../database/emojis.js');

const EmbedFormatter = {
    /**
     * Formata um usuário para exibição em embeds
     * @param {object} user - Objeto User do Discord
     * @param {object} member - Objeto Member do Discord (opcional, para nickname)
     * @returns {string} Texto formatado: "Apelido (username) [id]" ou "username (username) [id]"
     */
    formatUser(user, member = null) {
    if (!user) return '`Usuário desconhecido`';
    
    const displayName = member?.nickname || user.username;
    const mention = `<@${user.id}>`;
    
    // Formato: @Menção (username) [id]
    return `${mention}\n【${user.username}】`;
    },
    
    /**
     * Formata um usuário para o campo "Moderador" ou similar
     * @param {object} user - Objeto User do Discord
     * @param {object} member - Objeto Member do Discord (opcional, para nickname)
     * @returns {string} Texto formatado
     */
    /**
     * Formata um usuário para o campo "Moderador" (com menção)
     */
    formatModerator(user, member = null) {
        if (!user) return '`Desconhecido`';
        
        const displayName = member?.nickname || user.username;
        const mention = `<@${user.id}>`;
        
        // Formato: @Menção (username) [id]
        return `${mention}\n【${user.username}】`;
    },
    
    /**
     * Gera o footer padrão para embeds
     * @param {string} guildName - Nome do servidor
     * @param {string} extraText - Texto adicional (opcional)
     * @returns {object} Objeto com text e iconURL
     */
    getFooter(guildName, extraText = '') {
        const footerText = extraText 
            ? `By:KnustVI • ${guildName} • ${extraText}`
            : `By:KnustVI • ${guildName}`;
        
        return {
            text: footerText,
            iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png'
        };
    },
    
    /**
     * Gera o footer para históricos com paginação
     * @param {number} currentPage - Página atual
     * @param {number} totalPages - Total de páginas
     * @param {number} totalRecords - Total de registros
     * @returns {string} Texto do footer
     */
    getHistoryFooter(currentPage, totalPages, totalRecords) {
        return `Página ${currentPage} de ${totalPages} • Total: ${totalRecords} registros`;
    },
    
    /**
     * Formata uma data para exibição em embed
     * @param {number} timestamp - Timestamp em milissegundos
     * @returns {string} Data formatada
     */
    formatDate(timestamp) {
        return `<t:${Math.floor(timestamp / 1000)}:d>`;
    },
    
    /**
     * Formata uma data relativa (ex: "há 2 dias")
     * @param {number} timestamp - Timestamp em milissegundos
     * @returns {string} Data relativa formatada
     */
    formatRelativeDate(timestamp) {
        return `<t:${Math.floor(timestamp / 1000)}:R>`;
    },

    // ==================== FIELDS PADRONIZADOS ====================

    /**
     * Cria um field padrão
     * @param {string} name - Nome do field
     * @param {string} value - Valor do field
     * @param {boolean} inline - Se deve ser inline (padrão: false)
     * @returns {object} Field para EmbedBuilder
     */
    field(name, value, inline = false) {
        return { name, value, inline };
    },

    /**
     * Field de usuário (alvo)
     * @param {object} user - Objeto User
     * @param {object} member - Objeto Member (opcional)
     * @param {boolean} inline - Se deve ser inline
     * @returns {object} Field
     */
    userField(user, member = null, inline = true) {
        return {
            name: `${EMOJIS.user || '👤'} Usuário`,
            value: this.formatUser(user, member),
            inline
        };
    },

    /**
     * Field de moderador
     * @param {object} user - Objeto User do moderador
     * @param {object} member - Objeto Member do moderador (opcional)
     * @param {boolean} inline - Se deve ser inline
     * @returns {object} Field
     */
    moderatorField(user, member = null, inline = true) {
        return {
            name: `${EMOJIS.staff || '👮'} Moderador`,
            value: this.formatUser(user, member),
            inline
        };
    },

    /**
     * Field de reputação (pontos)
     * @param {number} oldPoints - Pontos antigos
     * @param {number} newPoints - Pontos novos
     * @param {boolean} inline - Se deve ser inline
     * @returns {object} Field
     */
    reputationField(oldPoints, newPoints, inline = true) {
        const diff = newPoints - oldPoints;
        const diffText = diff >= 0 ? `+${diff}` : `${diff}`;
        return {
            name: `${EMOJIS.star || '⭐'} Reputação`,
            value: `\`${oldPoints}\` → \`${newPoints}\` (\`${diffText}\`)`,
            inline
        };
    },

    /**
     * Field de pontos (genérico)
     * @param {string} label - Rótulo (ex: "Pontos Perdidos")
     * @param {number} points - Quantidade de pontos
     * @param {string} emoji - Emoji opcional
     * @param {boolean} inline - Se deve ser inline
     * @returns {object} Field
     */
    pointsField(label, points, emoji = '📊', inline = true) {
        const prefix = points >= 0 ? '+' : '';
        return {
            name: `${emoji} ${label}`,
            value: `\`${prefix}${points} pts\``,
            inline
        };
    },

    /**
     * Field de motivo
     * @param {string} reason - Motivo
     * @param {boolean} inline - Se deve ser inline (padrão: false)
     * @returns {object} Field
     */
    reasonField(reason, inline = false) {
        return {
            name: `${EMOJIS.Note || '📝'} Motivo`,
            value: reason.length > 100 ? `${reason.slice(0, 97)}...` : reason,
            inline
        };
    },

    /**
     * Field de severidade (strike)
     * @param {number} severity - Nível da severidade (1-5)
     * @param {boolean} inline - Se deve ser inline
     * @returns {object} Field
     */
    severityField(severity, inline = true) {
        const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
        const severityIcons = ['', '🟢', '🟡', '🟠', '🔴', '💀'];
        return {
            name: `${severityIcons[severity] || '⚠️'} Gravidade`,
            value: `${severityNames[severity] || `Nível ${severity}`}`,
            inline
        };
    },

    /**
     * Field de ticket
     * @param {string} ticketId - ID do ticket
     * @param {boolean} inline - Se deve ser inline
     * @returns {object} Field
     */
    ticketField(ticketId, inline = true) {
        if (!ticketId) return null;
        return {
            name: `${EMOJIS.Ticket || '🎫'} Ticket`,
            value: `\`${ticketId}\``,
            inline
        };
    },

    /**
     * Field de ID da punição
     * @param {number} strikeId - ID do strike
     * @param {boolean} inline - Se deve ser inline
     * @returns {object} Field
     */
    strikeIdField(strikeId, inline = true) {
        return {
            name: `${EMOJIS.strike || '⚠️'} ID do Strike`,
            value: `#${strikeId}`,
            inline
        };
    },

    /**
     * Field de status
     * @param {string} status - Status (active, revoked, etc)
     * @param {boolean} inline - Se deve ser inline
     * @returns {object} Field
     */
    statusField(status, inline = true) {
        const statusMap = {
            active: '✅ Ativo',
            revoked: '❌ Anulado',
            expired: '⏰ Expirado'
        };
        return {
            name: `${EMOJIS.Status || '📊'} Status`,
            value: statusMap[status] || status,
            inline
        };
    },

    /**
     * Field de data
     * @param {number} timestamp - Timestamp em milissegundos
     * @param {string} label - Rótulo (ex: "Criado em")
     * @param {boolean} relative - Se deve usar formato relativo
     * @param {boolean} inline - Se deve ser inline
     * @returns {object} Field
     */
    dateField(timestamp, label = 'Data', relative = false, inline = true) {
        const formattedDate = relative ? this.formatRelativeDate(timestamp) : this.formatDate(timestamp);
        return {
            name: `${EMOJIS.Date || '📅'} ${label}`,
            value: formattedDate,
            inline
        };
    },

    /**
     * Adiciona múltiplos fields a um embed
     * @param {EmbedBuilder} embed - EmbedBuilder do Discord
     * @param {Array} fields - Lista de fields (objetos ou null)
     * @returns {EmbedBuilder} Embed com fields adicionados
     */
    addFields(embed, fields) {
        const validFields = fields.filter(f => f !== null);
        if (validFields.length > 0) {
            embed.addFields(validFields);
        }
        return embed;
    }
};

module.exports = EmbedFormatter;