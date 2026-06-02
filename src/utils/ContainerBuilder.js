const {
    ContainerBuilder, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder,
    SectionBuilder, TextDisplayBuilder, SeparatorBuilder, MediaGalleryBuilder,
    MediaItemBuilder, ComponentType
} = require('discord.js');

class AdvancedContainerBuilder {
    constructor(options = {}) {
        this.container = new ContainerBuilder();
        this.sections = [];
        this.actionRows = [];
        this.textDisplays = [];
        this.separators = [];
        this.mediaGalleries = [];
        
        if (options.accentColor) {
            this.container.setAccentColor(options.accentColor);
        }
        
        this.serverName = options.serverName || "Servidor";
        this.showFooter = options.showFooter !== false;
    }

    addTitle(text, level = 1) {
        const prefix = '#'.repeat(Math.min(level, 3));
        const textDisplay = new TextDisplayBuilder()
            .setContent(`${prefix} ${text}`);
        this.textDisplays.push(textDisplay);
        return this;
    }

    addText(content) {
        const textDisplay = new TextDisplayBuilder()
            .setContent(content);
        this.textDisplays.push(textDisplay);
        return this;
    }

    addSeparator() {
        this.separators.push(new SeparatorBuilder());
        return this;
    }

    addSection(text, accessory = null, accessoryPosition = 'right') {
        const textDisplay = new TextDisplayBuilder().setContent(text);
        const section = new SectionBuilder()
            .addTextDisplayComponents(textDisplay);
        
        if (accessory) {
            if (accessory.type === 'thumbnail' || accessory.url) {
                const thumbnailComponent = {
                    type: ComponentType.Thumbnail,
                    url: accessory.url || accessory
                };
                section.addAccessoryComponents(thumbnailComponent);
            }
            else if (accessory instanceof ButtonBuilder) {
                const buttonRow = new ActionRowBuilder().addComponents(accessory);
                section.addAccessoryComponents(buttonRow);
            }
        }
        
        this.sections.push(section);
        return this;
    }

    addSplitSection(leftText, rightText, leftAccessory = null, rightAccessory = null) {
        const leftDisplay = new TextDisplayBuilder().setContent(leftText);
        const rightDisplay = new TextDisplayBuilder().setContent(rightText);
        
        const section = new SectionBuilder()
            .addTextDisplayComponents(leftDisplay, rightDisplay);
        
        if (leftAccessory) {
            if (leftAccessory.type === 'thumbnail' || leftAccessory.url) {
                section.addAccessoryComponents({
                    type: ComponentType.Thumbnail,
                    url: leftAccessory.url || leftAccessory
                });
            } else if (leftAccessory instanceof ButtonBuilder) {
                const row = new ActionRowBuilder().addComponents(leftAccessory);
                section.addAccessoryComponents(row);
            }
        }
        
        if (rightAccessory) {
            if (rightAccessory.type === 'thumbnail' || rightAccessory.url) {
                section.addAccessoryComponents({
                    type: ComponentType.Thumbnail,
                    url: rightAccessory.url || rightAccessory
                });
            } else if (rightAccessory instanceof ButtonBuilder) {
                const row = new ActionRowBuilder().addComponents(rightAccessory);
                section.addAccessoryComponents(row);
            }
        }
        
        this.sections.push(section);
        return this;
    }

    addMultiColumnSection(columns) {
        const textDisplays = columns.map(col => 
            new TextDisplayBuilder().setContent(col.text)
        );
        
        const section = new SectionBuilder();
        
        textDisplays.forEach(textDisplay => {
            section.addTextDisplayComponents(textDisplay);
        });
        
        columns.forEach(col => {
            if (col.accessory) {
                if (col.accessory.type === 'thumbnail' || col.accessory.url) {
                    section.addAccessoryComponents({
                        type: ComponentType.Thumbnail,
                        url: col.accessory.url || col.accessory
                    });
                } else if (col.accessory instanceof ButtonBuilder) {
                    const row = new ActionRowBuilder().addComponents(col.accessory);
                    section.addAccessoryComponents(row);
                }
            }
        });
        
        this.sections.push(section);
        return this;
    }

    addButtons(...buttons) {
        const flatButtons = buttons.flat().filter(b => b instanceof ButtonBuilder);
        
        for (let i = 0; i < flatButtons.length; i += 5) {
            const row = new ActionRowBuilder();
            const batch = flatButtons.slice(i, i + 5);
            batch.forEach(btn => row.addComponents(btn));
            this.actionRows.push(row);
        }
        
        return this;
    }

    addSelectMenu(selectMenu) {
        if (selectMenu instanceof StringSelectMenuBuilder) {
            const row = new ActionRowBuilder().addComponents(selectMenu);
            this.actionRows.push(row);
        }
        return this;
    }

    addActionRow(row) {
        if (row instanceof ActionRowBuilder) {
            this.actionRows.push(row);
        }
        return this;
    }

    addGallery(imageUrls, title = null) {
        if (imageUrls && imageUrls.length > 0) {
            const gallery = new MediaGalleryBuilder();
            
            if (title) {
                gallery.setTitle(title);
            }
            
            imageUrls.slice(0, 10).forEach(url => {
                gallery.addMediaItems(new MediaItemBuilder().setUrl(url));
            });
            
            this.mediaGalleries.push(gallery);
        }
        return this;
    }

    addField(label, value, inline = false) {
        const fieldText = inline ? `**${label}:** ${value}` : `**${label}:**\n${value}`;
        return this.addText(fieldText);
    }

    addStatusRow(status, punishment, reason) {
        const section = new SectionBuilder();
        
        const statusText = new TextDisplayBuilder()
            .setContent(`**Status:**\n${status}`);
        section.addTextDisplayComponents(statusText);
        
        const punishmentText = new TextDisplayBuilder()
            .setContent(`**Punição aplicada:**\n${punishment}`);
        section.addTextDisplayComponents(punishmentText);
        
        const reasonText = new TextDisplayBuilder()
            .setContent(`**Motivo:**\n${reason}`);
        section.addTextDisplayComponents(reasonText);
        
        this.sections.push(section);
        return this;
    }

    addRating(rating, comment = null) {
        const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
        
        const section = new SectionBuilder();
        
        const ratingText = new TextDisplayBuilder()
            .setContent(`**Avaliação:** ${rating}/5 ${stars}`);
        section.addTextDisplayComponents(ratingText);
        
        if (comment) {
            const commentText = new TextDisplayBuilder()
                .setContent(`**Comentário:**\n${comment}`);
            section.addTextDisplayComponents(commentText);
        }
        
        this.sections.push(section);
        return this;
    }

    addFooter(customText = null) {
        if (this.showFooter) {
            const footerText = customText || 
                `Desenvolvido por Knust VI e T.Mach\n[Suporte](https://discord.gg/sEpW8tQ8tT)\nServidor: ${this.serverName}`;
            
            this.addSeparator();
            this.addText(`> ${footerText}`);
        }
        return this;
    }

    build() {
        for (const textDisplay of this.textDisplays) {
            this.container.addTextDisplayComponents(textDisplay);
        }
        
        for (const separator of this.separators) {
            this.container.addSeparatorComponents(separator);
        }
        
        for (const section of this.sections) {
            this.container.addSectionComponents(section);
        }
        
        for (const gallery of this.mediaGalleries) {
            this.container.addMediaGalleryComponents(gallery);
        }
        
        for (const row of this.actionRows) {
            this.container.addActionRowComponents(row);
        }
        
        return this.container;
    }
}

class ThumbnailHelper {
    static create(url) {
        return {
            type: ComponentType.Thumbnail,
            url: url
        };
    }
    
    static fromEmoji(emojiId, animated = false) {
        return {
            type: ComponentType.Thumbnail,
            url: `https://cdn.discordapp.com/emojis/${emojiId}.${animated ? 'gif' : 'png'}`
        };
    }
}

class ButtonHelper {
    static primary(customId, label, disabled = false) {
        return new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled);
    }
    
    static secondary(customId, label, disabled = false) {
        return new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled);
    }
    
    static success(customId, label, disabled = false) {
        return new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled);
    }
    
    static danger(customId, label, disabled = false) {
        return new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled);
    }
    
    static link(url, label) {
        return new ButtonBuilder()
            .setURL(url)
            .setLabel(label)
            .setStyle(ButtonStyle.Link);
    }
    
    static pagination(prefix, currentPage, totalPages) {
        const buttons = [];
        
        if (totalPages > 1) {
            buttons.push(
                this.secondary(`${prefix}_first`, '⏮️', currentPage === 1),
                this.secondary(`${prefix}_prev`, '◀️', currentPage === 1),
                this.secondary(`${prefix}_next`, '▶️', currentPage === totalPages),
                this.secondary(`${prefix}_last`, '⏭️', currentPage === totalPages)
            );
        }
        
        return buttons;
    }
}

module.exports = {
    AdvancedContainerBuilder,
    ButtonHelper,
    ThumbnailHelper
};