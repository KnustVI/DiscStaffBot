// containerBuilder.js
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

    // Adicionar título
    addTitle(text, level = 1) {
        const prefix = '#'.repeat(Math.min(level, 3));
        const textDisplay = new TextDisplayBuilder()
            .setContent(`${prefix} ${text}`);
        this.textDisplays.push(textDisplay);
        return this;
    }

    // Adicionar texto simples
    addText(content) {
        const textDisplay = new TextDisplayBuilder()
            .setContent(content);
        this.textDisplays.push(textDisplay);
        return this;
    }

    // Adicionar separador
    addSeparator() {
        this.separators.push(new SeparatorBuilder());
        return this;
    }

    // Adicionar Section com texto e accessory (thumbnail ou botão)
    addSection(text, accessory = null, accessoryPosition = 'right') {
        const textDisplay = new TextDisplayBuilder().setContent(text);
        const section = new SectionBuilder()
            .addTextDisplayComponents(textDisplay);
        
        if (accessory) {
            // Para thumbnail (imagem)
            if (accessory.type === 'thumbnail' || accessory.url) {
                const thumbnailComponent = {
                    type: ComponentType.Thumbnail,
                    url: accessory.url || accessory
                };
                if (accessoryPosition === 'left') {
                    section.addAccessoryComponents(thumbnailComponent);
                } else {
                    section.addAccessoryComponents(thumbnailComponent);
                }
            }
            // Para botão
            else if (accessory instanceof ButtonBuilder) {
                // Botões em Section precisam estar em ActionRow dentro da Section
                const buttonRow = new ActionRowBuilder().addComponents(accessory);
                section.addAccessoryComponents(buttonRow);
            }
        }
        
        this.sections.push(section);
        return this;
    }

    // Adicionar Section com dois textos lado a lado
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

    // Adicionar Section com múltiplos componentes
    addMultiColumnSection(columns) {
        // columns: array de {text, accessory, accessoryPosition}
        const textDisplays = columns.map(col => 
            new TextDisplayBuilder().setContent(col.text)
        );
        
        const section = new SectionBuilder();
        
        // Adicionar todos os textos
        textDisplays.forEach(textDisplay => {
            section.addTextDisplayComponents(textDisplay);
        });
        
        // Adicionar accessories
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

    // Adicionar botões (em ActionRow fora das Sections)
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

    // Adicionar Select Menu
    addSelectMenu(selectMenu) {
        if (selectMenu instanceof StringSelectMenuBuilder) {
            const row = new ActionRowBuilder().addComponents(selectMenu);
            this.actionRows.push(row);
        }
        return this;
    }

    // Adicionar ActionRow personalizada
    addActionRow(row) {
        if (row instanceof ActionRowBuilder) {
            this.actionRows.push(row);
        }
        return this;
    }

    // Adicionar galeria de mídia
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

    // Adicionar campo formatado (para dados como no exemplo do relatório)
    addField(label, value, inline = false) {
        const fieldText = inline ? `**${label}:** ${value}` : `**${label}:**\n${value}`;
        return this.addText(fieldText);
    }

    // Adicionar linha de status (como no exemplo)
    addStatusRow(status, punishment, reason) {
        const section = new SectionBuilder();
        
        // Status com emoji
        const statusText = new TextDisplayBuilder()
            .setContent(`**Status:**\n${status}`);
        section.addTextDisplayComponents(statusText);
        
        // Punição
        const punishmentText = new TextDisplayBuilder()
            .setContent(`**Punição aplicada:**\n${punishment}`);
        section.addTextDisplayComponents(punishmentText);
        
        // Motivo
        const reasonText = new TextDisplayBuilder()
            .setContent(`**Motivo:**\n${reason}`);
        section.addTextDisplayComponents(reasonText);
        
        this.sections.push(section);
        return this;
    }

    // Adicionar avaliação com estrelas
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

    // Adicionar footer
    addFooter(customText = null) {
        if (this.showFooter) {
            const footerText = customText || 
                `Desenvolvido por Knust VI e T.Mach\n[Suporte](https://discord.gg/sEpW8tQ8tT)\nServidor: ${this.serverName}`;
            
            this.addSeparator();
            this.addText(`> ${footerText}`);
        }
        return this;
    }

    // Build do container final
    build() {
        // Adicionar todos os componentes ao container na ordem correta
        // 1. TextDisplays
        for (const textDisplay of this.textDisplays) {
            this.container.addTextDisplayComponents(textDisplay);
        }
        
        // 2. Separators
        for (const separator of this.separators) {
            this.container.addSeparatorComponents(separator);
        }
        
        // 3. Sections
        for (const section of this.sections) {
            this.container.addSectionComponents(section);
        }
        
        // 4. MediaGalleries
        for (const gallery of this.mediaGalleries) {
            this.container.addMediaGalleryComponents(gallery);
        }
        
        // 5. ActionRows (buttons e selects)
        for (const row of this.actionRows) {
            this.container.addActionRowComponents(row);
        }
        
        return this.container;
    }
}

// Helper para criar thumbnails
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

// Helper para botões (simplificado)
class ButtonHelper {
    static primary(customId, label, disabled = false) {
        return new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setStyle(ComponentType.Button.Primary)
            .setDisabled(disabled);
    }
    
    static secondary(customId, label, disabled = false) {
        return new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setStyle(ComponentType.Button.Secondary)
            .setDisabled(disabled);
    }
    
    static success(customId, label, disabled = false) {
        return new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setStyle(ComponentType.Button.Success)
            .setDisabled(disabled);
    }
    
    static danger(customId, label, disabled = false) {
        return new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setStyle(ComponentType.Button.Danger)
            .setDisabled(disabled);
    }
    
    static link(url, label) {
        return new ButtonBuilder()
            .setURL(url)
            .setLabel(label)
            .setStyle(ComponentType.Button.Link);
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

// Formatter para criar containers rapidamente
class ContainerFormatter {
    static create(serverName, accentColor = null) {
        return new AdvancedContainerBuilder({ serverName, accentColor });
    }
    
    static colors = {
        success: 0x57F287,
        error: 0xED4245,
        warning: 0xFEE75C,
        info: 0x5865F2,
        primary: 0x5865F2
    };
    
    // Criar container para relatório (baseado na imagem)
    static createReportContainer(data) {
        const builder = this.create(data.serverName || "Servidor", this.colors.primary);
        
        builder.addTitle(`REPORT #${data.id || "RID"} | "mention"`);
        builder.addText(`"${data.userInfo || "userinfo"}"`);
        builder.addSeparator();
        
        builder.addStatusRow(
            data.status || "✅ Concluído por: @staff há 57 segundos",
            data.punishment || "Nenhuma",
            data.reason || "Resolvido"
        );
        
        builder.addSeparator();
        
        builder.addText(`**Staffs:**\n${data.staffs || "@staff (entrou há 26 minutos)"}`);
        
        builder.addRating(data.rating || 5, data.comment || null);
        
        if (data.image) {
            builder.addSection("", ThumbnailHelper.create(data.image));
        }
        
        builder.addFooter();
        
        return builder;
    }
    
    // Criar container para lista paginada
    static createPaginatedContainer(items, page, itemsPerPage, title, serverName) {
        const start = (page - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        const pageItems = items.slice(start, end);
        const totalPages = Math.ceil(items.length / itemsPerPage);
        
        const builder = this.create(serverName, this.colors.info);
        
        builder.addTitle(title);
        builder.addSeparator();
        
        pageItems.forEach(item => {
            if (item.inline) {
                builder.addSplitSection(
                    `**${item.name}:** ${item.value}`,
                    item.secondary ? `**${item.secondary.name}:** ${item.secondary.value}` : ''
                );
            } else {
                builder.addField(item.name, item.value);
                builder.addSeparator();
            }
        });
        
        builder.addSeparator();
        builder.addText(`📄 Página ${page}/${totalPages} • ${items.length} registros`);
        
        return { builder, totalPages };
    }
    
    // Criar container com botões de navegação
    static createWithNavigation(items, page, itemsPerPage, title, prefix, serverName) {
        const { builder, totalPages } = this.createPaginatedContainer(
            items, page, itemsPerPage, title, serverName
        );
        
        const navButtons = ButtonHelper.pagination(prefix, page, totalPages);
        
        if (navButtons.length > 0) {
            builder.addButtons(navButtons);
        }
        
        return builder;
    }
}

module.exports = {
    AdvancedContainerBuilder,
    ContainerFormatter,
    ButtonHelper,
    ThumbnailHelper
};