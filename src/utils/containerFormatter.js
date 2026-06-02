// ContainerFormatter.js - VERSÃO ATUALIZADA (mantendo sua estrutura)

const { ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { AdvancedContainerBuilder, ButtonHelper, ThumbnailHelper } = require('./containerBuilder');

class ContainerFormatter {
    static create(serverName, color = null) {
        // Agora retorna o AdvancedContainerBuilder em vez do antigo ContainerBuilderWrapper
        return new AdvancedContainerBuilder({ serverName, accentColor: color });
    }

    static colors = {
        success: 0x57F287,
        error: 0xED4245,
        warning: 0xFEE75C,
        info: 0x5865F2
    };

    static field(label, value, code = false) {
        return `**${label}:** ${code ? `\`${value}\`` : value}`;
    }

    static pagination(page, total, records) {
        return `📄 Página ${page}/${total} • ${records} registros`;
    }

    static button(id, label, style = 'primary', url = null) {
        const styles = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };
        const btn = new ButtonBuilder().setLabel(label).setStyle(styles[style] || 1);
        return url ? btn.setURL(url) : btn.setCustomId(id);
    }

    static thumbnail(url) {
        // Agora usa o ThumbnailHelper
        return ThumbnailHelper.create(url);
    }

    static navButtons(prefix, page, total) {
        // Agora usa o ButtonHelper.pagination
        return ButtonHelper.pagination(prefix, page, total);
    }

    // NOVO: Método para criar container de relatório (baseado na sua imagem)
    static createReportContainer(data) {
        const builder = this.create(data.serverName || "Servidor", this.colors.info);
        
        builder.addTitle(`REPORT #${data.id || "RID"} | "mention"`);
        builder.addText(`"${data.userInfo || "userinfo"}"`);
        builder.addSeparator();
        
        // Status row
        builder.addStatusRow(
            data.status || "✅ Concluído por: @staff há 57 segundos",
            data.punishment || "Nenhuma",
            data.reason || "Resolvido"
        );
        
        builder.addSeparator();
        builder.addText(`**Staffs:**\n${data.staffs || "@staff (entrou há 26 minutos)"}`);
        
        // Rating com estrelas
        const stars = '★'.repeat(data.rating || 5) + '☆'.repeat(5 - (data.rating || 5));
        builder.addText(`**Avaliação:** ${data.rating || 5}/5 ${stars}`);
        
        if (data.comment) {
            builder.addText(`**Comentário:**\n${data.comment}`);
        }
        
        if (data.image) {
            builder.addSection("", this.thumbnail(data.image));
        }
        
        builder.addFooter();
        
        return builder;
    }
}

module.exports = ContainerFormatter;