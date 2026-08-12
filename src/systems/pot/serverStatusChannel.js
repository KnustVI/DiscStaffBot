// src/systems/pot/serverStatusChannel.js
/**
 * Nome e tópico do canal configurado pro webhook "Servidor" (/potserver
 * logs) refletindo o status ao vivo do servidor de jogo — pedido do dono,
 * 2026-08-12: "consegue configurar para que o nome do canal mude de
 * acordo com os avisos enviados nesse canal? ... Status online, offline e
 * numero de players" + "quero que crie um tópico ... para colocar o nome
 * do mapa atual, tambem alterando quando o servidor é iniciado com outro
 * mapa".
 *
 * O Discord só permite alterar nome/tópico de um canal 2 vezes a cada 10
 * minutos (limite da própria API, compartilhado entre os dois campos — não
 * dá pra contornar). Por isso:
 *  - o NOME (online/offline/contagem) só é escrito de fato pelo ciclo
 *    LENTO de 5min (ver onlineStatusWorker.js) — a precisão do dado em si
 *    (reconciliação online/offline + tempo de jogo) roda num ciclo RÁPIDO
 *    separado (1min, pedido do dono: "o mais preciso possível"), que só
 *    grava o resultado aqui via `reportLiveStatus` — nunca chama a API do
 *    Discord diretamente, só o ciclo de 5min lê esse valor e decide se
 *    renomeia (`getLiveStatus`);
 *  - o TÓPICO (mapa atual) só muda no `ServerStart` (raro, poucas vezes
 *    por dia) — e quando isso coincide com uma mudança de nome (o caso
 *    normal, já que ServerStart também atualiza o nome pro estado online
 *    real), os dois campos vão num ÚNICO `channel.edit()` (ver
 *    `updateStatusChannel`), gastando só 1 das 2 vagas do limite, não 2.
 *
 * `restartingGuilds` evita que os dois gatilhos de NOME (ciclo de 5min x
 * evento de restart) briguem entre si: enquanto uma guild está marcada
 * como "reiniciando", o ciclo de 5min pula a atualização de nome por
 * completo até o ServerStart limpar essa marca.
 */
const PoTConfigSystem = require('./potConfigSystem');

// Formato pedido pelo dono, símbolos exatos (letras em negrito matemático,
// não é só "ON"/"OFF" em caixa alta comum — e o "|" é obrigatório).
const OFFLINE_NAME = '🔴𝐎𝐅𝐅';
const RESTARTING_NAME = '🟠reiniciando...';
function formatOnlineName(playerCount) {
    return `🟢𝐎𝐍 |${playerCount}-jogadores`;
}
function formatMapTopic(mapName) {
    return `🗺️ Mapa atual: ${mapName || 'desconhecido'}`;
}

// Último status conhecido por guild (online + contagem), em memória —
// pedido do dono, 2026-08-12: "mantenha o intervalo de 5 min para alterar
// o nome do canal" enquanto a PRECISÃO do online/offline/tempo de jogo
// roda num ciclo mais rápido à parte (ver onlineStatusWorker.js). O ciclo
// rápido grava aqui a cada rodada; o ciclo de 5min só LÊ esse valor e
// decide se renomeia — nunca faz sua própria consulta Source Query, pra
// não consultar o servidor 2x pela mesma informação.
const lastKnownStatus = new Map();
function reportLiveStatus(guildId, { online, playerCount }) {
    lastKnownStatus.set(guildId, { online, playerCount });
}
function getLiveStatus(guildId) {
    return lastKnownStatus.get(guildId) || null;
}

// URL do webhook "servidor" -> channel_id, em memória. Se a URL mudar
// (staff reconfigura em /potserver logs), a CHAVE muda junto — o cache
// antigo simplesmente nunca mais é consultado, sem precisar invalidar nada
// manualmente.
const channelIdCache = new Map();

const restartingGuilds = new Set();
function markRestarting(guildId) { restartingGuilds.add(guildId); }
function clearRestarting(guildId) { restartingGuilds.delete(guildId); }
function isRestarting(guildId) { return restartingGuilds.has(guildId); }

/** Extrai {id, token} de uma URL de webhook do Discord (mesmo formato de gatewayServer.js#_parseWebhookUrl). */
function _parseWebhookUrl(webhookUrl) {
    try {
        const url = new URL(webhookUrl);
        const parts = url.pathname.split('/').filter(Boolean);
        const idx = parts.indexOf('webhooks');
        if (idx === -1 || !parts[idx + 1] || !parts[idx + 2]) return null;
        return { id: parts[idx + 1], token: parts[idx + 2] };
    } catch {
        return null;
    }
}

/**
 * Um webhook não expõe o channel_id na própria URL — precisa perguntar pro
 * Discord (GET /webhooks/{id}/{token}, autenticado pelo próprio token do
 * webhook, sem precisar do token do bot). Cacheado por URL pra não repetir
 * essa chamada em todo ciclo do worker.
 */
async function _resolveChannelId(webhookUrl) {
    if (channelIdCache.has(webhookUrl)) return channelIdCache.get(webhookUrl);
    const parsed = _parseWebhookUrl(webhookUrl);
    if (!parsed) return null;
    try {
        const res = await fetch(`https://discord.com/api/v10/webhooks/${parsed.id}/${parsed.token}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.channel_id) return null;
        channelIdCache.set(webhookUrl, data.channel_id);
        return data.channel_id;
    } catch (err) {
        return null;
    }
}

/**
 * Atualiza nome e/ou tópico do canal do webhook "Servidor" da guild — os
 * dois campos passados NUM SÓ pedido à API (channel.edit) quando ambos
 * precisam mudar ao mesmo tempo (ex: ServerStart, que mexe nos dois),
 * porque nome e tópico competem pelo MESMO limite de 2 alterações/10min
 * do Discord (confirmado ao vivo com o bug de renomeação de tópico de
 * report, ver reportChatSystem.js) — um pedido só gasta uma "vaga" desse
 * limite, dois pedidos separados gastariam duas. Só chama a API de
 * verdade pros campos que realmente mudaram (evita gastar a cota à toa
 * quando nada mudou, o caso comum na maioria dos ciclos). Sem o grupo
 * "Servidor" configurado, ou sem permissão de Gerenciar Canais, falha em
 * silêncio (best-effort — nunca pode derrubar o processamento do evento/
 * worker que chamou isso).
 *
 * @param {{name?: string, topic?: string}} fields
 */
async function updateStatusChannel(client, guildId, fields = {}) {
    try {
        const webhookUrl = PoTConfigSystem.getWebhookForGroup(guildId, 'servidor');
        if (!webhookUrl) return;
        const channelId = await _resolveChannelId(webhookUrl);
        if (!channelId) return;
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const payload = {};
        if (fields.name !== undefined && channel.name !== fields.name) payload.name = fields.name;
        if (fields.topic !== undefined && channel.topic !== fields.topic) payload.topic = fields.topic;
        if (Object.keys(payload).length === 0) return;

        await channel.edit(payload, 'Status automático do servidor Path of Titans');
    } catch (err) {
        console.warn(`⚠️ [ServerStatusChannel] Não foi possível atualizar o canal da guild ${guildId}: ${err.message}`);
    }
}

/** Atalho pra quando só o nome precisa mudar (worker de 5min, restart). */
function setStatusChannelName(client, guildId, name) {
    return updateStatusChannel(client, guildId, { name });
}

module.exports = {
    OFFLINE_NAME,
    RESTARTING_NAME,
    formatOnlineName,
    formatMapTopic,
    reportLiveStatus,
    getLiveStatus,
    updateStatusChannel,
    setStatusChannelName,
    markRestarting,
    clearRestarting,
    isRestarting,
};
