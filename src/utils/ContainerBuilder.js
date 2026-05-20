const { Container, TextDisplay, Section, Separator, ActionRow } = require('discord.js');

class ContainerBuilder {
    constructor(options = {}) {
        this.container = new Container({
            accentColor: options.accentColor || null,
            spoiler: options.spoiler || false
        });
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
        this.container.addComponents(new TextDisplay(`${prefix} ${text}`));
        this.hasContent = true;
        return this;
    }

    addText(text) {
        this.container.addComponents(new TextDisplay(text));
        this.hasContent = true;
        return this;
    }

    addSeparator(spacing = 'small') {
        this.container.addComponents(new Separator({ spacing }));
        this.hasContent = true;
        return this;
    }

    addSection(texts, accessory = null) {
        if (!texts || texts.length === 0) return this;
        const firstText = new TextDisplay(texts[0]);
        const section = new Section(firstText, { accessory });
        for (let i = 1; i < Math.min(texts.length, 3); i++) {
            if (texts[i]) section.addComponents(new TextDisplay(texts[i]));
        }
        this.container.addComponents(section);
        this.hasContent = true;
        return this;
    }

    addButtonRow(buttons) {
        if (!buttons || buttons.length === 0) return this;
        const actionRow = new ActionRow();
        buttons.slice(0, 5).forEach(button => actionRow.addComponents(button));
        this.container.addComponents(actionRow);
        this.hasContent = true;
        return this;
    }

    addFooter(customText = null) {
        this.addSeparator('small');
        const footerContent = customText ? `${customText}\n\n${this.footerText}` : this.footerText;
        this.addText(`*${footerContent}*`);
        return this;
    }

    build() {
        if (!this.hasContent) this.addText("⚠️ Nenhuma informação disponível");
        return { components: [this.container] };
    }

    toJSON() {
        return this.build();
    }
}

module.exports = ContainerBuilder;