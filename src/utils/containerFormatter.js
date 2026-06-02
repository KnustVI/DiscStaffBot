// /home/ubuntu/DiscStaffBot/src/utils/ContainerFormatter.js
const { AdvancedContainerBuilder, ButtonHelper, ThumbnailHelper } = require('./containerBuilder');
const { ButtonBuilder, ButtonStyle } = require('discord.js');

class ContainerFormatter {
    static create(serverName, accentColor = null) {
        // ✅ CORRETO: Retorna a instância do builder, não o build()
        return new AdvancedContainerBuilder({ serverName, accentColor });
    }

    static colors = {
        success: 0x57F287,
        error: 0xED4245,
        warning: 0xFEE75C,
        info: 0x5865F2,
        primary: 0x5865F2
    };

    static field(label, value, code = false) {
        return `**${label}:** ${code ? `\`${value}\`` : value}`;
    }

    static pagination(page, total, records) {
        return `📄 Página ${page}/${total} • ${records} registros`;
    }

    static button(id, label, style = 'primary', url = null) {
        const styles = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger, link: ButtonStyle.Link };
        const btn = new ButtonBuilder().setLabel(label).setStyle(styles[style] || ButtonStyle.Primary);
        return url ? btn.setURL(url) : btn.setCustomId(id);
    }

    static thumbnail(url) {
        return ThumbnailHelper.create(url);
    }

    static navButtons(prefix, page, total) {
        return ButtonHelper.pagination(prefix, page, total);
    }

    static createReportContainer(data) {
        const builder = this.create(data.serverName || "Servidor", this.colors.info);
        
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
        
        const stars = '★'.repeat(data.rating || 5) + '☆'.repeat(5 - (data.rating || 5));
        builder.addText(`**Avaliação:** ${data.rating || 5}/5 ${stars}`);
        
        if (data.comment) {
            builder.addText(`**Comentário:**\n${data.comment}`);
        }
        
        if (data.image) {
            builder.addSection("", this.thumbnail(data.image));
        }
        
        builder.addFooter();
        
        return builder; // ✅ Retorna o builder, não o build()
    }
}

module.exports = ContainerFormatter;