// src/events/guildDelete.js
/**
 * Avisa o log de sistema (canal fixo do dono) sempre que o bot é removido
 * de um servidor — único propósito deste evento, não mexe em nada mais
 * (dados do servidor no banco ficam intactos, sem limpeza automática).
 */
const { sendSystemLog } = require('../systems/core/systemLog');

module.exports = {
    name: 'guildDelete',
    async execute(guild, client) {
        sendSystemLog(client, (b) => {
            b.title('➖ Bot saiu/foi removido de um servidor', 2);
            b.text(`**Servidor:** ${guild.name || 'Desconhecido'} \`${guild.id}\``);
            b.footer('Sistema');
        });
    }
};
