// src/systems/pot/serverStatusChannel.js
/**
 * Nome do canal configurado pro webhook "Servidor" (/potserver logs)
 * refletindo o status ao vivo do servidor de jogo — pedido do dono,
 * 2026-08-12: "consegue configurar para que o nome do canal mude de
 * acordo com os avisos enviados nesse canal? ... Status online, offline e
 * numero de players."
 *
 * O Discord só permite renomear um canal 2 vezes a cada 10 minutos (limite
 * da própria API, não dá pra contornar) — por isso a atualização de
 * online/offline/contagem roda só no ciclo de 5min que já existe
 * (onlineStatusWorker.js), nunca por evento avulso. O único evento que
 * dispara uma renomeação FORA desse ciclo é o restart de verdade
 * (ServerRestart/ServerStart em gatewayServer.js), que é raro o bastante
 * (poucas vezes por dia) pra nunca esbarrar no limite mesmo somado ao
 * ciclo de 5min.
 *
 * `restartingGuilds` evita que os dois gatilhos (worker de 5min x evento de
 * restart) briguem pelo nome do canal: enquanto uma guild está marcada como
 * "reiniciando", o worker de 5min pula a renomeação por completo (ver
 * onlineStatusWorker.js) até o ServerStart limpar essa marca.
 */
const PoTConfigSystem = require('./potConfigSystem');

// Formato pedido pelo dono, símbolos exatos (letras em negrito matemático,
// não é só "ON"/"OFF" em caixa alta comum — e o "|" é obrigatório).
const OFFLINE_NAME = '🔴𝐎𝐅𝐅';
const RESTARTING_NAME = '🟠reiniciando...';
function formatOnlineName(playerCount) {
    return `🟢𝐎𝐍 |${playerCount}-jogadores`;
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
 * Renomeia o canal do webhook "Servidor" da guild pro texto informado — só
 * chama a API do Discord de verdade se o nome já não estiver certo (evita
 * gastar as 2 renomeações/10min à toa quando nada mudou, que é o caso
 * comum na maioria dos ciclos). Sem o grupo "Servidor" configurado, ou sem
 * permissão de Gerenciar Canais no canal, falha em silêncio (best-effort —
 * nunca pode derrubar o processamento do evento/worker que chamou isso).
 */
async function setStatusChannelName(client, guildId, name) {
    try {
        const webhookUrl = PoTConfigSystem.getWebhookForGroup(guildId, 'servidor');
        if (!webhookUrl) return;
        const channelId = await _resolveChannelId(webhookUrl);
        if (!channelId) return;
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;
        if (channel.name === name) return;
        await channel.setName(name, 'Status automático do servidor Path of Titans');
    } catch (err) {
        console.warn(`⚠️ [ServerStatusChannel] Não foi possível renomear o canal da guild ${guildId}: ${err.message}`);
    }
}

module.exports = {
    OFFLINE_NAME,
    RESTARTING_NAME,
    formatOnlineName,
    setStatusChannelName,
    markRestarting,
    clearRestarting,
    isRestarting,
};
