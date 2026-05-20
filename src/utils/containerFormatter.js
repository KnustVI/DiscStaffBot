cat > /home/ubuntu/DiscStaffBot/src/utils/ContainerFormatter.js << 'EOF'
const ContainerBuilder = require('./ContainerBuilder');

class ContainerFormatter {
  
  // ============ MÉTODOS PRINCIPAIS ============
  
  static getFooter(serverName) {
    return `[Bot by: Knust VI](https://discord.gg/sEpW8tQ8tT)\nServidor atual: ${serverName}`;
  }

  static createBuilder(serverName, accentColor = null) {
    return new ContainerBuilder({ 
      serverName: serverName,
      accentColor: accentColor 
    });
  }

  // ============ MÉTODOS PARA TEXTOS (USADOS EM CONTAINERS) ============
  
  static field(label, value, isCode = false) {
    const formattedValue = isCode ? `\`${value}\`` : value;
    return `**${label}:** ${formattedValue}`;
  }

  static userCard(user, extraInfo = null) {
    const texts = [`**👤 ${user.tag}**`, `🆔 \`${user.id}\``];
    if (extraInfo) texts.push(extraInfo);
    return texts;
  }

  static getHistoryFooter(page, totalPages, totalRecords) {
    return `Página ${page}/${totalPages} • Total: ${totalRecords} registros`;
  }

  static relativeTime(timestamp) {
    return `<t:${Math.floor(timestamp / 1000)}:R>`;
  }

  static fullDate(timestamp) {
    return `<t:${Math.floor(timestamp / 1000)}:F>`;
  }

  // ============ MÉTODOS DE FORMATAÇÃO (RETORNAM STRINGS) ============
  
  static formatUser(user, member = null) {
    if (member && member.displayName !== user.username) {
      return `${user.tag} (${member.displayName}) - \`${user.id}\``;
    }
    return `${user.tag} - \`${user.id}\``;
  }

  static moderatorField(moderator) {
    return `**🛡️ Moderador:** ${moderator.tag} (\`${moderator.id}\`)`;
  }

  static reputationField(oldPoints, newPoints) {
    const change = newPoints - oldPoints;
    const arrow = change >= 0 ? '📈' : '📉';
    const sign = change >= 0 ? '+' : '';
    return `**⭐ Reputação:** ${oldPoints} → ${newPoints} (${arrow} ${sign}${change})`;
  }

  // ============ MÉTODOS DE COMPATIBILIDADE COM EmbedFormatter ============
  // ESTES MÉTODOS SÃO CHAMADOS POR punishmentSystem.js e outros sistemas
  
  static userField(user, member = null) {
    return {
      name: '👤 Usuário',
      value: this.formatUser(user, member),
      inline: true
    };
  }

  static moderatorFieldEmbed(moderator) {
    return {
      name: '🛡️ Moderador',
      value: `${moderator.tag} - \`${moderator.id}\``,
      inline: true
    };
  }

  static pointsField(label, points, emoji = '📊') {
    return {
      name: `${emoji} ${label}`,
      value: `${points} pontos`,
      inline: true
    };
  }

  static reputationFieldEmbed(oldPoints, newPoints) {
    const diff = newPoints - oldPoints;
    const arrow = diff >= 0 ? '📈' : '📉';
    const sign = diff >= 0 ? '+' : '';
    return {
      name: '⭐ Reputação',
      value: `${oldPoints} → ${newPoints} (${arrow} ${sign}${diff})`,
      inline: true
    };
  }

  static addFields(embed, fields) {
    for (const field of fields) {
      if (field && field.name && field.value) {
        embed.addFields(field);
      }
    }
    return embed;
  }
}

module.exports = ContainerFormatter;
EOF