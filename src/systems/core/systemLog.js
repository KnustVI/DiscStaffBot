// src/systems/core/systemLog.js
/**
 * Log de sistema — manda mensagens operacionais (uso de comandos de
 * developer, boot do bot, erros críticos, entrar/sair de servidor) pra um
 * canal fixo no servidor principal do dono. Diferente do log_channel de
 * cada tenant (configurável por guild via /config) — este é fixo, só pro
 * dono acompanhar o bot como um todo.
 *
 * Falha sempre em silêncio (nunca lança) — log de sistema não pode derrubar
 * nada nem travar um comando por causa de canal fora do ar/bot sem permissão.
 */
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

const SYSTEM_LOG_GUILD_ID = '430534418818400266';
const SYSTEM_LOG_CHANNEL_ID = '1525104070321504428';

let cachedChannel = null;

async function _getChannel(client) {
    if (cachedChannel) return cachedChannel;
    try {
        const channel = client.channels.cache.get(SYSTEM_LOG_CHANNEL_ID)
            || await client.channels.fetch(SYSTEM_LOG_CHANNEL_ID).catch(() => null);
        if (channel) cachedChannel = channel;
        return channel;
    } catch {
        return null;
    }
}

/**
 * @param {import('discord.js').Client} client
 * @param {(builder: AdvancedContainerBuilder) => void} builderFn - recebe o
 *   builder já com a cor padrão pra montar título/texto/footer.
 */
async function sendSystemLog(client, builderFn) {
    try {
        const channel = await _getChannel(client);
        if (!channel) return;
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        builderFn(builder);
        // flags precisa vir num array — mesmo padrão já usado em
        // autoModeration.js/configSystem.js pra channel.send() direto
        // (fora de interaction.reply/editReply, que aceitam o build() cru).
        const { components, flags, files } = builder.build();
        await channel.send({ components, flags: [flags], files });
    } catch (error) {
        console.error('❌ [SystemLog] Falha ao enviar log de sistema:', error.message);
    }
}

module.exports = { sendSystemLog, SYSTEM_LOG_GUILD_ID, SYSTEM_LOG_CHANNEL_ID };
