const {
    ContainerBuilder,
    ComponentType,
    ActionRowBuilder,
    ButtonBuilder,
    SectionBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    MediaGalleryBuilder,
    MediaItemBuilder,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    MentionableSelectMenuBuilder,
    ThumbnailBuilder
} = require('discord.js');

/**
 * Wrapper para o ContainerBuilder do Discord.js v14+
 * Gerencia a criação de containers com validação e limites
 */
class ContainerBuilderWrapper {
    constructor(options = {}) {
        this.container = new ContainerBuilder();
        this.componentCount = 0;
        this.maxComponents = 40;
        
        if (options.accentColor) this.container.setAccentColor(options.accentColor);
        if (options.spoiler) this.container.setSpoiler(options.spoiler);
        
        this.hasContent = false;
        this.serverName = options.serverName || "Servidor Desconhecido";
        this.footerText = `Desenvolvido por Knust VI e T.Mach/[Servidor de suporte](https://discord.gg/sEpW8tQ8tT)\nServidor atual: ${this.serverName}`;
    }

    /**
     * Verifica se pode adicionar mais componentes
     * @returns {boolean}
     */
    canAddComponents(count = 1) {
        if (this.componentCount + count > this.maxComponents) {
            console.warn(`⚠️ Limite de ${this.maxComponents} componentes atingido! Tentativa de adicionar ${count} componente(s).`);
            return false;
        }
        return true;
    }

    /**
     * Incrementa contador de componentes
     * @param {number} count
     */
    incrementCount(count = 1) {
        this.componentCount += count;
    }

    /**
     * Define o nome do servidor
     * @param {string} serverName
     * @returns {ContainerBuilderWrapper}
     */
    setServerName(serverName) {
        this.serverName = serverName;
        this.footerText = `Desenvolvido por Knust VI e T.Mach/[Servidor de suporte](https://discord.gg/sEpW8tQ8tT)\nServidor atual: ${this.serverName}`;
        return this;
    }

    /**
     * Adiciona um título
     * @param {string} text - Texto do título
     * @param {number} level - Nível do título (1-3)
     * @returns {ContainerBuilderWrapper}
     */
    addTitle(text, level = 1) {
        if (!this.canAddComponents(1)) return this;
        
        const prefix = '#'.repeat(Math.min(Math.max(level, 1), 3));
        const titleBuilder = new TextDisplayBuilder()
            .setContent(`${prefix} ${text}`)
            .setType(ComponentType.TextDisplay);
        
        this.container.addComponents(titleBuilder);
        this.hasContent = true;
        this.incrementCount();
        return this;
    }

    /**
     * Adiciona texto comum com suporte a Markdown
     * @param {string} text - Texto a ser exibido
     * @returns {ContainerBuilderWrapper}
     */
    addText(text) {
        if (!text || !this.canAddComponents(1)) return this;
        
        const textBuilder = new TextDisplayBuilder()
            .setContent(text)
            .setType(ComponentType.TextDisplay);
        
        this.container.addComponents(textBuilder);
        this.hasContent = true;
        this.incrementCount();
        return this;
    }

    /**
     * Adiciona múltiplos textos em sequência
     * @param {string[]} texts - Array de textos
     * @returns {ContainerBuilderWrapper}
     */
    addTexts(texts) {
        if (!texts || !Array.isArray(texts)) return this;
        
        for (const text of texts.slice(0, 5)) {
            if (text && this.canAddComponents(1)) {
                this.addText(text);
            }
        }
        return this;
    }

    /**
     * Adiciona um separador visual
     * @returns {ContainerBuilderWrapper}
     */
    addSeparator() {
        if (!this.canAddComponents(1)) return this;
        
        const separator = new SeparatorBuilder();
        this.container.addComponents(separator);
        this.hasContent = true;
        this.incrementCount();
        return this;
    }

    /**
     * Adiciona uma seção com texto e acessório (thumbnail/botão)
     * @param {string|string[]} text - Texto único ou array de textos (max 3)
     * @param {ButtonBuilder|ThumbnailBuilder|null} accessory - Acessório opcional
     * @returns {ContainerBuilderWrapper}
     */
    addSection(text, accessory = null) {
        if (!text || !this.canAddComponents(1)) return this;
        
        // Processa o texto principal
        let mainText = '';
        let additionalTexts = [];
        
        if (Array.isArray(text)) {
            mainText = text[0] || '';
            additionalTexts = text.slice(1, 3);
        } else {
            mainText = text;
        }
        
        if (!mainText) return this;
        
        // Valida o acessório
        let validAccessory = null;
        if (accessory) {
            if ((accessory instanceof ButtonBuilder || 
                 accessory instanceof ThumbnailBuilder) && 
                typeof accessory.toJSON === 'function') {
                validAccessory = accessory;
            }
        }
        
        // Cria a Section com o texto principal
        const section = new SectionBuilder()
            .setText(new TextDisplayBuilder().setContent(mainText));
        
        if (validAccessory) {
            section.setAccessory(validAccessory);
        }
        
        this.container.addComponents(section);
        this.incrementCount();
        
        // Adiciona textos adicionais como componentes separados
        for (const extraText of additionalTexts) {
            if (extraText && this.canAddComponents(1)) {
                this.addText(extraText);
            }
        }
        
        this.hasContent = true;
        return this;
    }

    /**
     * Adiciona uma linha de botões
     * @param {ButtonBuilder[]} buttons - Array de botões (max 5)
     * @returns {ContainerBuilderWrapper}
     */
    addButtonRow(buttons) {
        if (!buttons || !Array.isArray(buttons) || buttons.length === 0) return this;
        if (!this.canAddComponents(1)) return this;
        
        // Valida e filtra botões
        const validButtons = [];
        for (const button of buttons.slice(0, 5)) {
            if (button instanceof ButtonBuilder && typeof button.toJSON === 'function') {
                // Verifica se botão não é link quando está com outros
                const buttonData = button.toJSON();
                if (buttonData.style === 5 && buttons.length > 1) {
                    console.warn('⚠️ Botões Link não podem ser combinados com outros botões');
                    continue;
                }
                validButtons.push(button);
            }
        }
        
        if (validButtons.length === 0) return this;
        
        const actionRow = new ActionRowBuilder();
        validButtons.forEach(button => actionRow.addComponents(button));
        this.container.addComponents(actionRow);
        this.incrementCount();
        return this;
    }

    /**
     * Adiciona um menu de seleção (qualquer tipo)
     * @param {StringSelectMenuBuilder|UserSelectMenuBuilder|RoleSelectMenuBuilder|ChannelSelectMenuBuilder|MentionableSelectMenuBuilder} selectMenu
     * @returns {ContainerBuilderWrapper}
     */
    addSelectMenu(selectMenu) {
        if (!selectMenu || typeof selectMenu.toJSON !== 'function') return this;
        if (!this.canAddComponents(1)) return this;
        
        const actionRow = new ActionRowBuilder();
        actionRow.addComponents(selectMenu);
        this.container.addComponents(actionRow);
        this.hasContent = true;
        this.incrementCount();
        return this;
    }

    /**
     * Adiciona uma galeria de mídia (imagens/vídeos)
     * @param {string[]} mediaUrls - Array de URLs de mídia (max 10)
     * @returns {ContainerBuilderWrapper}
     */
    addMediaGallery(mediaUrls) {
        if (!mediaUrls || !Array.isArray(mediaUrls) || mediaUrls.length === 0) return this;
        if (!this.canAddComponents(1)) return this;
        
        // Valida URLs
        const validUrls = [];
        const urlRegex = /^https?:\/\/.+\/.+\.(jpg|jpeg|png|gif|webp|mp4|mov|webm)(\?.*)?$/i;
        
        for (const url of mediaUrls.slice(0, 10)) {
            if (url && typeof url === 'string' && urlRegex.test(url)) {
                validUrls.push(url);
            } else if (url && typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
                // Aceita URLs sem extensão específica
                validUrls.push(url);
            }
        }
        
        if (validUrls.length === 0) return this;
        
        try {
            const gallery = new MediaGalleryBuilder();
            for (const url of validUrls) {
                gallery.addMediaItems(new MediaItemBuilder().setUrl(url));
            }
            
            this.container.addComponents(gallery);
            this.hasContent = true;
            this.incrementCount();
        } catch (error) {
            console.error('❌ Erro ao criar galeria de mídia:', error);
        }
        
        return this;
    }

    /**
     * Adiciona múltiplas galerias (cuidado com limite de componentes)
     * @param {string[][]} galleries - Array de arrays de URLs
     * @returns {ContainerBuilderWrapper}
     */
    addMediaGalleries(galleries) {
        if (!galleries || !Array.isArray(galleries)) return this;
        
        for (const gallery of galleries) {
            if (this.canAddComponents(1)) {
                this.addMediaGallery(gallery);
            } else {
                break;
            }
        }
        return this;
    }

    /**
     * Adiciona rodapé com informações padrão ou personalizadas
     * @param {string|null} customText - Texto personalizado opcional
     * @returns {ContainerBuilderWrapper}
     */
    addFooter(customText = null) {
        if (this.hasContent && this.canAddComponents(2)) {
            this.addSeparator();
        }
        
        const footerContent = customText 
            ? `${customText}\n\n${this.footerText}` 
            : this.footerText;
        
        this.addText(`> ${footerContent}`);
        return this;
    }

    /**
     * Limpa todo o conteúdo do container
     * @returns {ContainerBuilderWrapper}
     */
    clear() {
        this.container = new ContainerBuilder();
        this.componentCount = 0;
        this.hasContent = false;
        
        if (this.accentColor) this.container.setAccentColor(this.accentColor);
        return this;
    }

    /**
     * Verifica se o container tem conteúdo
     * @returns {boolean}
     */
    hasAnyContent() {
        return this.hasContent;
    }

    /**
     * Retorna o número atual de componentes
     * @returns {number}
     */
    getComponentCount() {
        return this.componentCount;
    }

    /**
     * Debug: mostra informações do container
     * @returns {ContainerBuilderWrapper}
     */
    inspect() {
        console.log({
            hasContent: this.hasContent,
            componentCount: this.componentCount,
            maxComponents: this.maxComponents,
            serverName: this.serverName,
            remainingSlots: this.maxComponents - this.componentCount,
            containerJSON: this.container.toJSON()
        });
        return this;
    }

    /**
     * Constrói e retorna o ContainerBuilder final
     * @returns {ContainerBuilder}
     */
    build() {
        if (!this.hasContent) {
            this.addText("⚠️ Nenhuma informação disponível");
        }
        return this.container;
    }
}

module.exports = ContainerBuilderWrapper;