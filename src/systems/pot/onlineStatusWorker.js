// src/systems/pot/onlineStatusWorker.js
/**
 * Worker periódico de reconciliação de status online — pedido do dono,
 * 2026-08-11: "vários relatos de problema de identificar o jogador
 * online, para registro, para ver staff online". Consulta o Source Query
 * (A2S_PLAYER, ver sourceQueryClient.js) de cada servidor PoT configurado
 * e habilitado, e corrige qualquer desvio entre o que o banco acha que
 * está online e quem está REALMENTE conectado agora (ver
 * PlayerRegistry.reconcileOnlineStatus pro porquê o desvio acontece —
 * queda abrupta sem PlayerLogout/PlayerLeave, principalmente).
 *
 * Só age em guilds com `game_port` configurado (ver /potserver setup) —
 * Source Query é OPCIONAL, precisa ser habilitado manualmente pelo dono
 * do servidor de jogo ([SourceQuery] no Game.ini). Sem isso configurado,
 * a guild é pulada silenciosamente — nenhuma mudança de comportamento
 * pra quem não configurar. Falha de rede/timeout numa guild nunca impede
 * as outras de rodar (best-effort por guild, mesmo padrão do resto da
 * integração PoT).
 *
 * DOIS ciclos separados de propósito (pedido do dono, 2026-08-12:
 * "deixar o mais preciso possível o tempo de jogo... mas mantenha o
 * intervalo de 5 min para alterar o nome do canal"):
 *  - RÁPIDO (1min): faz a consulta de verdade, corrige online/offline e
 *    tempo de jogo no banco (com a precisão de durationSeconds, ver
 *    PlayerRegistry.reconcileOnlineStatus), e só ANOTA o resultado em
 *    memória (ServerStatusChannel.reportLiveStatus) — nunca mexe no nome
 *    do canal.
 *  - LENTO (5min): não consulta o Source Query de novo — só LÊ o que o
 *    ciclo rápido já anotou (ServerStatusChannel.getLiveStatus) e decide
 *    se o nome do canal precisa mudar. Pulado por completo enquanto a
 *    guild estiver marcada como "reiniciando" (ver
 *    ServerStatusChannel.isRestarting, controlado pelos eventos
 *    ServerRestart/ServerStart em gatewayServer.js) — sem isso, brigaria
 *    com o estado "reiniciando" a cada 5min até o restart terminar.
 */
'use strict';

const cron = require('node-cron');
const PoTConfigSystem = require('./potConfigSystem');
const PlayerRegistry = require('./potPlayerRegistry');
const SourceQueryClient = require('../../integrations/pathoftitans/sourceQueryClient');
const ServerStatusChannel = require('./serverStatusChannel');

async function _reconcileGuild(guildId) {
    const config = PoTConfigSystem.getServerConfig(guildId);
    if (!config?.enabled || !config.server_ip || !config.game_port) return;

    const result = await SourceQueryClient.queryPlayers(config.server_ip, config.game_port, 4000);
    if (!result.success) {
        console.warn(`⚠️ [OnlineStatusWorker] Source Query falhou pra guild ${guildId}: ${result.error}`);
        ServerStatusChannel.reportLiveStatus(guildId, { online: false, playerCount: 0 });
        return;
    }

    const { correctedOffline, correctedOnline } = PlayerRegistry.reconcileOnlineStatus(guildId, result.players);
    if (correctedOffline > 0 || correctedOnline > 0) {
        console.log(`🔄 [OnlineStatusWorker] Guild ${guildId}: ${correctedOffline} marcado(s) offline, ${correctedOnline} marcado(s) online (corrigidos via Source Query).`);
    }

    ServerStatusChannel.reportLiveStatus(guildId, { online: true, playerCount: result.players.length });
}

async function _forEachConfiguredGuild(label, fn) {
    let guildIds;
    try {
        guildIds = PoTConfigSystem.getAllConfiguredGuildIds();
    } catch (error) {
        console.error(`❌ [OnlineStatusWorker] Erro ao listar guilds configuradas (${label}):`, error);
        return;
    }

    for (const guildId of guildIds) {
        try {
            await fn(guildId);
        } catch (error) {
            console.error(`❌ [OnlineStatusWorker] Erro no ciclo "${label}" pra guild ${guildId}:`, error.message);
        }
    }
}

function startOnlineStatusWorker(client) {
    console.log('🔄 [OnlineStatusWorker] Reconciliação de status online (Source Query) iniciada — 1min precisão, 5min nome do canal');

    cron.schedule('* * * * *', () => _forEachConfiguredGuild('reconciliação', _reconcileGuild));

    cron.schedule('*/5 * * * *', () => _forEachConfiguredGuild('nome do canal', async (guildId) => {
        if (!client || ServerStatusChannel.isRestarting(guildId)) return;
        const status = ServerStatusChannel.getLiveStatus(guildId);
        if (!status) return; // ciclo rápido ainda não rodou nenhuma vez pra essa guild
        const name = status.online
            ? ServerStatusChannel.formatOnlineName(status.playerCount)
            : ServerStatusChannel.OFFLINE_NAME;
        await ServerStatusChannel.setStatusChannelName(client, guildId, name);
    }));
}

module.exports = { startOnlineStatusWorker };
