const {
    ContainerBuilder, ActionRowBuilder, ButtonBuilder, SectionBuilder,
    TextDisplayBuilder, SeparatorBuilder, MediaGalleryBuilder,
    MediaItemBuilder, ThumbnailBuilder
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

    section(text, accessory = null) {
        const section = new SectionBuilder().setText(new TextDisplayBuilder().setContent(text));
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
        this.container.addComponents(...this.components);
        return this.container;
    }
}

module.exports = ContainerBuilderWrapper;