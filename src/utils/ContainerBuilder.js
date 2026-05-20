// /home/ubuntu/DiscStaffBot/src/utils/ContainerBuilder.js
const { ContainerBuilder, ComponentType, ActionRowBuilder } = require('discord.js');

class ContainerBuilderUtil {
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
        this.container.addTextDisplayComponents({
            content: `${prefix} ${text}`,
            type: ComponentType.TextDisplay
        });
        this.hasContent = true;
        return this;
    }

    addText(text) {
        this.container.addTextDisplayComponents({
            content: text,
            type: ComponentType.TextDisplay
        });
        this.hasContent = true;
        return this;
    }

    addSeparator() {
        this.container.addSeparatorComponents({});
        this.hasContent = true;
        return this;
    }

    addField(label, value, inline = false) {
        const prefix = inline ? '' : '\n';
        this.addText(`${prefix}**${label}:** ${value}`);
        return this;
    }

    addSection(title, content) {
        this.addTitle(title, 2);
        this.addText(content);
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

module.exports = ContainerBuilderUtil;