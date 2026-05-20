const { 
  Container, TextDisplay, Section, Separator, 
  ActionRow, ButtonBuilder, StringSelectMenuBuilder,
  ButtonStyle, ComponentType 
} = require('discord.js');

class ContainerBuilder {
  constructor(options = {}) {
    this.container = new Container({
      accentColor: options.accentColor || null,
      spoiler: options.spoiler || false
    });
    this.hasContent = false;
    
    // Footer padrão configurável
    this.serverName = options.serverName || "Servidor Desconhecido";
    this.footerText = `[Bot by: Knust VI](https://discord.gg/sEpW8tQ8tT)\nServidor atual: ${this.serverName}`;
  }

  /**
   * Define o nome do servidor (atualiza o footer automaticamente)
   */
  setServerName(serverName) {
    this.serverName = serverName;
    this.footerText = `[Bot by: Knust VI](https://discord.gg/sEpW8tQ8tT)\nServidor atual: ${this.serverName}`;
    return this;
  }

  /**
   * Adiciona um título (usa markdown #)
   */
  addTitle(text, level = 1) {
    const prefix = '#'.repeat(Math.min(level, 3));
    this.container.addComponents(new TextDisplay(`${prefix} ${text}`));
    this.hasContent = true;
    return this;
  }

  /**
   * Adiciona texto puro com markdown
   */
  addText(text) {
    this.container.addComponents(new TextDisplay(text));
    this.hasContent = true;
    return this;
  }

  /**
   * Adiciona uma linha divisória
   */
  addSeparator(spacing = 'small') {
    this.container.addComponents(new Separator({ spacing }));
    this.hasContent = true;
    return this;
  }

  /**
   * Adiciona uma seção (grupo de textos + acessório)
   */
  addSection(texts, accessory = null) {
    if (!texts || texts.length === 0) return this;
    
    const firstText = new TextDisplay(texts[0]);
    const section = new Section(firstText, { accessory });
    
    for (let i = 1; i < Math.min(texts.length, 3); i++) {
      if (texts[i]) {
        section.addComponents(new TextDisplay(texts[i]));
      }
    }
    
    this.container.addComponents(section);
    this.hasContent = true;
    return this;
  }

  /**
   * Adiciona uma linha de botões
   */
  addButtonRow(buttons) {
    if (!buttons || buttons.length === 0) return this;
    
    const actionRow = new ActionRow();
    buttons.slice(0, 5).forEach(button => {
      actionRow.addComponents(button);
    });
    
    this.container.addComponents(actionRow);
    this.hasContent = true;
    return this;
  }

  /**
   * Adiciona um menu de seleção
   */
  addSelectMenu(selectMenu) {
    const actionRow = new ActionRow();
    actionRow.addComponents(selectMenu);
    this.container.addComponents(actionRow);
    this.hasContent = true;
    return this;
  }

  /**
   * Adiciona o footer padrão do bot
   */
  addFooter(customText = null) {
    this.addSeparator('small');
    const footerContent = customText 
      ? `${customText}\n\n${this.footerText}`
      : this.footerText;
    this.addText(`*${footerContent}*`);
    return this;
  }

  /**
   * Adiciona footer com informações extras (mantém o padrão)
   */
  addFooterWithExtra(extraInfo) {
    this.addSeparator('small');
    this.addText(`*${extraInfo}\n\n${this.footerText}*`);
    return this;
  }

  // 🦕 Métodos específicos para Path of Titans
  
  addPotPlayerCard(playerName, alderonId, dinoType = null, location = null) {
    const texts = [`**👤 ${playerName}**`, `🆔 \`${alderonId}\``];
    if (dinoType) texts.push(`🦖 ${dinoType}`);
    if (location) texts.push(`📍 \`${location}\``);
    
    return this.addSection(texts);
  }

  addPotKillFeed(victim, killer, damageType) {
    return this.addSection([
      `💀 **${victim}** foi morto(a)`,
      `🔪 Por: **${killer}**`,
      `⚔️ Tipo: \`${damageType}\``
    ]);
  }

  addPotLoginInfo(playerName, alderonId, isAdmin, platform = null) {
    const texts = [
      `**👤 ${playerName}** entrou no servidor`,
      `🆔 \`${alderonId}\``,
      `👑 Admin: ${isAdmin ? 'Sim' : 'Não'}`
    ];
    if (platform) texts.push(`📱 Plataforma: ${platform}`);
    
    return this.addSection(texts);
  }

  addPotQuestComplete(playerName, questName, rewardMarks, rewardGrowth) {
    return this.addSection([
      `**📋 ${playerName}** completou uma missão!`,
      `🎯 **${questName}**`,
      `💰 Recompensa: ${rewardMarks} marcas | 📈 ${rewardGrowth * 100}% crescimento`
    ]);
  }

  /**
   * Constrói o objeto final para envio
   */
  build() {
    if (!this.hasContent) {
      this.addText("⚠️ Nenhuma informação disponível");
    }
    
    return {
      components: [this.container]
    };
  }

  /**
   * Para comandos slash
   */
  toJSON() {
    return this.build();
  }
}

module.exports = ContainerBuilder;