const {
    ContainerBuilder, ActionRowBuilder, ButtonBuilder, SectionBuilder,
    TextDisplayBuilder, SeparatorBuilder, MediaGalleryBuilder,
    MediaItemBuilder
} = require('discord.js');

class ContainerBuilderWrapper {
    constructor(options = {}) {
        this.container = new ContainerBuilder();
        this.components = [];
        if (options.accentColor) this.container.setAccentColor(options.accentColor);
        
        this.serverName = options.serverName || "Servidor";
        this.footerText = `Desenvolvido por Knust VI e T.Mach\n[Suporte](https://discord.gg/sEpW8tQ8tT)\nServidor: ${this.serverName}`;
    }

    title(text, level = 1) {
        this.components.push(new TextDisplayBuilder().setContent('#'.repeat(Math.min(level, 3)) + ' ' + text));
        return this;
    }

    text(content) {
        this.components.push(new TextDisplayBuilder().setContent(content));
        return this;
    }

    line() {
        this.components.push(new SeparatorBuilder());
        return this;
    }

    // ✅ CORREÇÃO DEFINITIVA - USA addTextDisplayComponents
    section(text, accessory = null) {
        const textDisplay = new TextDisplayBuilder().setContent(text);
        const section = new SectionBuilder().addTextDisplayComponents(textDisplay);
        //                                      ^^^^^^^^^^^^^^^^^^^^^^^^^^
        //                                      Este é o método correto!
        if (accessory) section.setAccessory(accessory);
        this.components.push(section);
        return this;
    }

    buttons(...btns) {
        const buttons = btns.flat().filter(b => b instanceof ButtonBuilder).slice(0, 5);
        if (buttons.length) {
            const row = new ActionRowBuilder();
            buttons.forEach(b => row.addComponents(b));
            this.components.push(row);
        }
        return this;
    }

    menu(selectMenu) {
        if (selectMenu && typeof selectMenu.toJSON === 'function') {
            const row = new ActionRowBuilder().addComponents(selectMenu);
            this.components.push(row);
        }
        return this;
    }

    gallery(urls) {
        if (urls?.length) {
            const gallery = new MediaGalleryBuilder();
            urls.slice(0, 10).forEach(url => gallery.addMediaItems(new MediaItemBuilder().setUrl(url)));
            this.components.push(gallery);
        }
        return this;
    }

    footer(custom = null) {
        if (this.components.length) this.line();
        this.text(`> ${custom || this.footerText}`);
        return this;
    }

    build() {
        if (!this.components.length) this.text("⚠️ Sem informações");
        
        for (const component of this.components) {
            if (component instanceof TextDisplayBuilder) {
                this.container.addTextDisplayComponents(component);
            } else if (component instanceof SeparatorBuilder) {
                this.container.addSeparatorComponents(component);
            } else if (component instanceof SectionBuilder) {
                this.container.addSectionComponents(component);
            } else if (component instanceof ActionRowBuilder) {
                this.container.addActionRowComponents(component);
            } else if (component instanceof MediaGalleryBuilder) {
                this.container.addMediaGalleryComponents(component);
            }
        }
        
        return this.container;
    }
}

module.exports = ContainerBuilderWrapper;