// /home/ubuntu/DiscStaffBot/src/utils/ContainerFormatter.js
const ContainerBuilderWrapper = require('./ContainerBuilder');

class ContainerFormatter {
    static getFooter(serverName) {
        return `Servidor atual: ${serverName}\nDesenvolvido por Knust VI | [Servidor de Suporte](https://discord.gg/8YCEkZQkZP)`;
    }

    static createBuilder(serverName, accentColor = null) {
        return new ContainerBuilderWrapper({ serverName: serverName, accentColor: accentColor });
    }

    static field(label, value, isCode = false) {
        const formattedValue = isCode ? `\`${value}\`` : value;
        return `**${label}:** ${formattedValue}`;
    }

    static getHistoryFooter(page, totalPages, totalRecords) {
        return `Página ${page}/${totalPages} • Total: ${totalRecords} registros`;
    }
}

module.exports = ContainerFormatter;