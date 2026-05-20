const ContainerBuilder = require('./ContainerBuilder');

class ContainerFormatter {
  
  /**
   * Obtém o footer padrão
   * @param {string} serverName - Nome do servidor
   * @returns {string} Footer formatado
   */
  static getFooter(serverName) {
    return `[Bot by: Knust VI](https://discord.gg/sEpW8tQ8tT)\nServidor atual: ${serverName}`;
  }

  /**
   * Cria um builder pré-configurado com o servidor
   * @param {string} serverName - Nome do servidor
   * @param {number} accentColor - Cor de destaque (opcional)
   * @returns {ContainerBuilder} Builder configurado
   */
  static createBuilder(serverName, accentColor = null) {
    return new ContainerBuilder({ 
      serverName: serverName,
      accentColor: accentColor 
    });
  }

  /**
   * Formata um campo para section (texto com emoji)
   * @param {string} label - Rótulo do campo
   * @param {string} value - Valor do campo
   * @param {boolean} isCode - Se deve formatar como código
   * @returns {string} Texto formatado
   */
  static field(label, value, isCode = false) {
    const formattedValue = isCode ? `\`${value}\`` : value;
    return `**${label}:** ${formattedValue}`;
  }

  /**
   * Cria um card de usuário
   * @param {object} user - Objeto do usuário do Discord
   * @param {string} extraInfo - Informação extra (opcional)
   * @returns {string[]} Array de textos para section
   */
  static userCard(user, extraInfo = null) {
    const texts = [`**👤 ${user.tag}**`, `🆔 \`${user.id}\``];
    if (extraInfo) texts.push(extraInfo);
    return texts;
  }

  /**
   * Cria um campo de informações do moderador
   * @param {object} moderator - Objeto do moderador
   * @returns {string} Texto formatado
   */
  static moderatorField(moderator) {
    return `**🛡️ Moderador:** ${moderator.tag} (\`${moderator.id}\`)`;
  }

  /**
   * Cria um campo de reputação
   * @param {number} oldPoints - Pontos antigos
   * @param {number} newPoints - Pontos novos
   * @returns {string} Texto formatado
   */
  static reputationField(oldPoints, newPoints) {
    const change = newPoints - oldPoints;
    const arrow = change >= 0 ? '📈' : '📉';
    const sign = change >= 0 ? '+' : '';
    return `**⭐ Reputação:** ${oldPoints} → ${newPoints} (${arrow} ${sign}${change})`;
  }

  /**
   * Obtém o texto do footer para histórico
   */
  static getHistoryFooter(page, totalPages, totalRecords) {
    return `Página ${page}/${totalPages} • Total: ${totalRecords} registros`;
  }

  /**
   * Formata uma data relativa
   * @param {number} timestamp - Timestamp em milissegundos
   * @returns {string} Texto formatado com data relativa do Discord
   */
  static relativeTime(timestamp) {
    return `<t:${Math.floor(timestamp / 1000)}:R>`;
  }

  /**
   * Formata uma data completa
   * @param {number} timestamp - Timestamp em milissegundos
   * @returns {string} Texto formatado com data completa
   */
  static fullDate(timestamp) {
    return `<t:${Math.floor(timestamp / 1000)}:F>`;
  }
}

module.exports = ContainerFormatter;