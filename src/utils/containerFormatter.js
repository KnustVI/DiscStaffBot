// /home/ubuntu/DiscStaffBot/src/utils/ContainerFormatter.js
const ContainerBuilderWrapper = require('./ContainerBuilder');

class ContainerFormatter {
    static getFooter(serverName) {
        return `Desenvolvido por Knust VI e T.Mach/[Servidor de suporte](https://discord.gg/sEpW8tQ8tT)\nServidor atual: ${serverName}`;
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