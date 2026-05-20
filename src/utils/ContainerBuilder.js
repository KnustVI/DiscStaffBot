// /home/ubuntu/DiscStaffBot/src/utils/ContainerBuilder.js
const { ContainerBuilder, ComponentType, ActionRowBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder } = require('discord.js');

class ContainerBuilderWrapper {
    constructor(options = {}) {
        this.container = new ContainerBuilder();
        
        if (options.accentColor) this.container.setAccentColor(options.accentColor);
        if (options.spoiler) this.container.setSpoiler(options.spoiler);
        
        this.hasContent = false;
        this.serverName = options.serverName || "Servidor Desconhecido";
        this.footerText = `[Bot by: Knust VI](https://discord.gg/sEpW8tQ8tT)\nServidor atual: ${this.serverName}`;
    }

    setServerName(serverName) {
        this.serverName = serverName;
        this.footerText = `[Bot by: Knust VI](https://discord.gg/sEpW8tQ8tT)\nServidor atual: ${this.serverName}`;
        return this;
    }

    addTitle(text, level = 1) {
        const prefix = '#'.repeat(Math.min(level, 3));
        this.container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`${prefix} ${text}`).setType(ComponentType.TextDisplay)
        );
        this.hasContent = true;
        return this;
    }

    addText(text) {
        this.container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(text).setType(ComponentType.TextDisplay)
        );
        this.hasContent = true;
        return this;
    }

    addSeparator() {
        this.container.addSeparatorComponents(new SeparatorBuilder());
        this.hasContent = true;
        return this;
    }

    addSection(texts, accessory = null) {
        if (!texts || texts.length === 0) return this;
        
        const section = new SectionBuilder();
        
        if (texts[0]) {
            section.addComponents(new TextDisplayBuilder().setContent(texts[0]));
        }
        
        for (let i = 1; i < Math.min(texts.length, 3); i++) {
            if (texts[i]) {
                section.addComponents(new TextDisplayBuilder().setContent(texts[i]));
            }
        }
        
        if (accessory) section.setAccessory(accessory);
        
        this.container.addSectionComponents(section);
        this.hasContent = true;
        return this;
    }

    addButtonRow(buttons) {
        if (!buttons || buttons.length === 0) return this;
        const actionRow = new ActionRowBuilder();
        buttons.slice(0, 5).forEach(button => actionRow.addComponents(button));
        this.container.addActionRowComponents(actionRow);
        this.hasContent = true;
        return this;
    }

    addFooter(customText = null) {
        this.addSeparator();
        const footerContent = customText ? `${customText}\n\n${this.footerText}` : this.footerText;
        this.addText(`*${footerContent}*`);
        return this;
    }

    build() {
        if (!this.hasContent) {
            this.addText("⚠️ Nenhuma informação disponível");
        }
        return this.container;
    }
}

module.exports = ContainerBuilderWrapper;