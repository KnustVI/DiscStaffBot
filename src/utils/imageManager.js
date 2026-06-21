// /home/ubuntu/DiscStaffBot/src/utils/imageManager.js
const path = require('path');
const fs = require('fs');
const { AttachmentBuilder } = require('discord.js');

class ImageManager {
    constructor() {
        // Caminho base das imagens
        this.imagesPath = path.join(__dirname, '..', '..', 'assets', 'images');
        this.attachments = {};
        this.imageUrls = {};
        
        // Carregar todas as imagens automaticamente
        this.loadAllImages();
    }

    /**
     * Carrega todas as imagens da pasta assets/images
     */
    loadAllImages() {
        if (!fs.existsSync(this.imagesPath)) {
            console.warn('⚠️ [ImageManager] Pasta de imagens não encontrada:', this.imagesPath);
            return;
        }

        const files = fs.readdirSync(this.imagesPath);
        
        for (const file of files) {
            // Verificar se é um arquivo de imagem
            const ext = path.extname(file).toLowerCase();
            if (!['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
                continue;
            }

            // Criar um nome chave sem extensão e sem espaços
            const key = this.normalizeKey(path.basename(file, ext));
            const fileName = this.normalizeFileName(file);

            // Armazenar o caminho do arquivo
            this.attachments[key] = {
                path: path.join(this.imagesPath, file),
                originalName: file,
                normalizedName: fileName
            };

            // URL para usar no embed
            this.imageUrls[key] = `attachment://${fileName}`;
            
            console.log(`✅ [ImageManager] Imagem carregada: ${key} → ${file}`);
        }
    }

    /**
     * Normaliza o nome da chave (sem espaços, minúsculo)
     */
    normalizeKey(name) {
        return name
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '');
    }

    /**
     * Normaliza o nome do arquivo para o attachment
     */
    normalizeFileName(name) {
        return name
            .replace(/\s+/g, '_')
            .replace(/[^a-zA-Z0-9_.-]/g, '');
    }

    /**
     * Obtém um attachment para enviar no Discord
     */
    getAttachment(key) {
        const image = this.attachments[key];
        if (!image) {
            console.warn(`⚠️ [ImageManager] Imagem não encontrada: ${key}`);
            return null;
        }

        return new AttachmentBuilder(image.path, {
            name: image.normalizedName
        });
    }

    /**
     * Obtém a URL para usar no embed
     */
    getUrl(key) {
        return this.imageUrls[key] || null;
    }

    /**
     * Obtém múltiplos attachments de uma vez
     */
    getAttachments(keys) {
        const attachments = [];
        for (const key of keys) {
            const att = this.getAttachment(key);
            if (att) attachments.push(att);
        }
        return attachments;
    }

    /**
     * Lista todas as imagens disponíveis
     */
    listImages() {
        return Object.keys(this.attachments);
    }

    /**
     * Verifica se uma imagem existe
     */
    hasImage(key) {
        return !!this.attachments[key];
    }

    /**
     * Obtém todas as URLs para usar em galerias
     */
    getGalleryUrls(keys) {
        return keys
            .map(key => this.getUrl(key))
            .filter(url => url !== null);
    }
}

    // ============================================
        // USAR IMAGENS DO GERENCIADOR
        // ============================================
        // Pegar o attachment da imagem
        // const bannerAttachment = imageManager.getAttachment('title_config_logs_dc');
        
        // Pegar a URL para usar no embed
        // const bannerUrl = imageManager.getUrl('title_config_logs_dc');

        // Se quiser várias imagens para galeria
        // const galeriaUrls = imageManager.getGalleryUrls([
        //    'title_config_logs_dc',
        //    'title_ajuda',
        //    'title_botstatus'
        // ]);

        // const { components, flags } = new AdvancedContainerBuilder({ accentColor: 0xDCA15E })
        //     .gallery(galeriaUrls) // ← Usar múltiplas imagens
        //     .gallery([bannerUrl]) // ← Ou usar uma única

// Exportar uma instância única (Singleton)
module.exports = new ImageManager();