// src/systems/pot/onlineStatusWorker.js
/**
 * Worker periódico de reconciliação de status online — pedido do dono,
 * 2026-08-11: "vários relatos de problema de identificar o jogador
 * online, para registro, para ver staff online". A cada 5 minutos,
 * consulta o Source Query (A2S_PLAYER, ver sourceQueryClient.js) de cada
 * servidor PoT configurado e habilitado, e corrige qualquer desvio entre
 * o que o banco acha que está online e quem está REALMENTE conectado
 * agora (ver PlayerRegistry.reconcileOnlineStatus pro porquê o desvio
 * acontece — queda abrupta sem PlayerLogout/PlayerLeave, principalmente).
 *
 * Só age em guilds com `game_port` configurado (ver /potserver setup) —
 * Source Query é OPCIONAL, precisa ser habilitado manualmente pelo dono
 * do servidor de jogo ([SourceQuery] no Game.ini). Sem isso configurado,
 * a guild é pulada silenciosamente — nenhuma mudança de comportamento
 * pra quem não configurar. Falha de rede/timeout numa guild nunca impede
 * as outras de rodar (best-effort por guild, mesmo padrão do resto da
 * integração PoT).
 *
 * Também renomeia o canal do webhook "Servidor" com o status online/
 * offline/nº de jogadores a cada ciclo (pedido do dono, 2026-08-12) — ver
 * serverStatusChannel.js pro porquê desse 5min ser o intervalo usado
 * (limite de 2 renomeações/10min do próprio Discord). Pulado por completo
 * enquanto a guild estiver marcada como "reiniciando" (ver
 * ServerStatusChannel.isRestarting, controlado pelos eventos ServerRestart/
 * ServerStart em gatewayServer.js) — sem isso, o worker brigaria com o
 * estado "reiniciando" a cada 5min até o restart terminar.
 */
'use strict';

const cron = require('node-cron');
const PoTConfigSystem = require('./potConfigSystem');
const PlayerRegistry = require('./potPlayerRegistry');
const SourceQueryClient = require('../../integrations/pathoftitans/sourceQueryClient');
const ServerStatusChannel = require('./serverStatusChannel');

async function _reconcileGuild(guildId, client) {
    const config = PoTConfigSystem.getServerConfig(guildId);
    if (!config?.enabled || !config.server_ip || !config.game_port) return;

    const result = await SourceQueryClient.queryPlayers(config.server_ip, config.game_port, 4000);
    if (!result.success) {
        console.warn(`⚠️ [OnlineStatusWorker] Source Query falhou pra guild ${guildId}: ${result.error}`);
        if (client && !ServerStatusChannel.isRestarting(guildId)) {
            await ServerStatusChannel.setStatusChannelName(client, guildId, ServerStatusChannel.OFFLINE_NAME);
        }
        return;
    }

    const names = result.players.map((p) => p.name);
    const { correctedOffline, correctedOnline } = PlayerRegistry.reconcileOnlineStatus(guildId, names);
    if (correctedOffline > 0 || correctedOnline > 0) {
        console.log(`🔄 [OnlineStatusWorker] Guild ${guildId}: ${correctedOffline} marcado(s) offline, ${correctedOnline} marcado(s) online (corrigidos via Source Query).`);
    }

    if (client && !ServerStatusChannel.isRestarting(guildId)) {
        await ServerStatusChannel.setStatusChannelName(client, guildId, ServerStatusChannel.formatOnlineName(names.length));
    }
}

function startOnlineStatusWorker(client) {
    console.log('🔄 [OnlineStatusWorker] Reconciliação de status online (Source Query) iniciada');

    cron.schedule('*/5 * * * *', async () => {
        let guildIds;
        try {
            guildIds = PoTConfigSystem.getAllConfiguredGuildIds();
        } catch (error) {
            console.error('❌ [OnlineStatusWorker] Erro ao listar guilds configuradas:', error);
            return;
        }

        for (const guildId of guildIds) {
            try {
                await _reconcileGuild(guildId, client);
            } catch (error) {
                console.error(`❌ [OnlineStatusWorker] Erro ao reconciliar guild ${guildId}:`, error.message);
            }
        }
    });
}

module.exports = { startOnlineStatusWorker };
