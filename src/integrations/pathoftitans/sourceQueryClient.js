// src/integrations/pathoftitans/sourceQueryClient.js
/**
 * Cliente do protocolo "Source Engine Query" (A2S) — o mesmo protocolo
 * UDP público usado pelo navegador de servidores da Steam, SEPARADO do
 * RCON (não usa senha nenhuma). O Path of Titans expõe isso opcionalmente
 * via `[SourceQuery]` no Game.ini, na porta do jogo + 4 por padrão (ver
 * hosting.pathoftitans.wiki/setup/source-query) — precisa ser habilitado
 * manualmente pelo dono do servidor de jogo, não vem ligado.
 *
 * Usado hoje só pela reconciliação de status online (ver
 * potPlayerRegistry.reconcileOnlineStatus / onlineStatusWorker.js): os
 * webhooks PlayerLogin/PlayerLogout/PlayerLeave são a fonte PRIMÁRIA de
 * "quem está online", mas uma queda abrupta (crash, ban, perda de conexão)
 * nunca dispara PlayerLogout/PlayerLeave — o registro fica preso "online"
 * pra sempre sem isso. A2S_PLAYER dá a lista REAL de quem está conectado
 * agora, direto do servidor, pra corrigir esse desvio periodicamente.
 *
 * IMPORTANTE: o protocolo A2S em si é público/estável (praticamente
 * inalterado há ~20 anos, usado por milhares de jogos Source/Steam) — mas
 * esta implementação nunca foi validada contra um servidor Path of Titans
 * real (mesma ressalva de sempre pras integrações PoT deste projeto).
 * Testado apenas contra um servidor UDP local simulado (ver script de
 * teste temporário usado na implementação). NÃO decodifica respostas
 * fragmentadas em múltiplos pacotes UDP (servidor com MUITOS jogadores
 * simultâneos pode ultrapassar 1 datagrama) — degrada como falha limpa
 * (error), nunca como dado incorreto.
 */
'use strict';

const dgram = require('dgram');

const A2S_INFO_REQUEST = Buffer.concat([
    Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0x54]),
    Buffer.from('Source Engine Query\0', 'latin1'),
]);
const A2S_PLAYER_CHALLENGE_REQUEST = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0x55, 0xFF, 0xFF, 0xFF, 0xFF]);

function _readCString(buf, offset) {
    const end = buf.indexOf(0x00, offset);
    if (end === -1) return { value: '', next: buf.length };
    return { value: buf.toString('utf8', offset, end), next: end + 1 };
}

function _send(host, port, requestBuffer, timeoutMs) {
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket('udp4');
        let settled = false;
        const timer = setTimeout(() => finish(new Error('Timeout na consulta Source Query.')), timeoutMs);

        function finish(err, data) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { socket.close(); } catch (_) {}
            if (err) reject(err); else resolve(data);
        }

        socket.once('error', (err) => finish(err));
        socket.once('message', (msg) => finish(null, msg));
        socket.send(requestBuffer, port, host, (err) => { if (err) finish(err); });
    });
}

/**
 * A2S_INFO — contagem de jogadores/nome do servidor/mapa em tempo real.
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<{ success: boolean, players?: number, maxPlayers?: number, name?: string, map?: string, error?: string }>}
 */
async function queryInfo(host, port, timeoutMs = 3000) {
    if (!host || !port) return { success: false, error: 'Host/porta não configurados.' };
    try {
        const response = await _send(host, port, A2S_INFO_REQUEST, timeoutMs);
        if (response.length < 7 || response.readInt32LE(0) !== -1 || response[4] !== 0x49) {
            return { success: false, error: 'Resposta A2S_INFO inesperada (formato não reconhecido).' };
        }
        let offset = 6; // header(4) + type(1) + protocol(1)
        const nameRead = _readCString(response, offset); offset = nameRead.next;
        const mapRead = _readCString(response, offset); offset = mapRead.next;
        offset = _readCString(response, offset).next; // folder (descartado)
        offset = _readCString(response, offset).next; // game (descartado)
        offset += 2; // Steam AppID (short) — não usado
        if (offset + 2 > response.length) return { success: false, error: 'Resposta A2S_INFO truncada.' };
        const players = response.readUInt8(offset); offset += 1;
        const maxPlayers = response.readUInt8(offset); offset += 1;
        return { success: true, players, maxPlayers, name: nameRead.value, map: mapRead.value };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * A2S_PLAYER — lista de jogadores conectados agora (nome + duração da
 * sessão em segundos). Fluxo padrão de 2 idas e voltas (challenge), com
 * fallback pra servidores que respondem a lista direto sem exigir
 * challenge. Casamento com pot_players é por NOME (o protocolo não expõe
 * Alderon ID) — ver reconcileOnlineStatus.
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<{ success: boolean, players?: {name: string, durationSeconds: number}[], error?: string }>}
 */
async function queryPlayers(host, port, timeoutMs = 3000) {
    if (!host || !port) return { success: false, error: 'Host/porta não configurados.' };
    try {
        const first = await _send(host, port, A2S_PLAYER_CHALLENGE_REQUEST, timeoutMs);
        if (first.length < 5 || first.readInt32LE(0) !== -1) {
            return { success: false, error: 'Resposta A2S_PLAYER inesperada (cabeçalho inválido).' };
        }

        let playerListBuffer;
        if (first[4] === 0x44) {
            // Alguns servidores mandam a lista direto, sem exigir challenge.
            playerListBuffer = first;
        } else if (first[4] === 0x41 && first.length >= 9) {
            const challenge = first.subarray(5, 9);
            const playerRequest = Buffer.concat([Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0x55]), challenge]);
            const second = await _send(host, port, playerRequest, timeoutMs);
            if (second.length < 6 || second.readInt32LE(0) !== -1 || second[4] !== 0x44) {
                return { success: false, error: 'Resposta A2S_PLAYER inesperada (após challenge).' };
            }
            playerListBuffer = second;
        } else {
            return { success: false, error: 'Resposta A2S_PLAYER inesperada (tipo de pacote desconhecido — possível fragmentação, não suportada).' };
        }

        let offset = 5; // header(4) + type(1)
        const numPlayers = playerListBuffer.readUInt8(offset); offset += 1;
        const players = [];
        for (let i = 0; i < numPlayers; i++) {
            if (offset >= playerListBuffer.length) break; // resposta truncada — melhor esforço, para aqui
            offset += 1; // index (não usado)
            const nameRead = _readCString(playerListBuffer, offset); offset = nameRead.next;
            if (offset + 8 > playerListBuffer.length) break;
            offset += 4; // score (não usado)
            const durationSeconds = playerListBuffer.readFloatLE(offset); offset += 4;
            if (nameRead.value) players.push({ name: nameRead.value, durationSeconds: Math.max(0, Math.round(durationSeconds)) });
        }
        return { success: true, players };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = { queryInfo, queryPlayers };
