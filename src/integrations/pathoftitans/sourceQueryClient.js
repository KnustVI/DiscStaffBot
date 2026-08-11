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
 * VALIDADO AO VIVO (2026-08-11) contra um servidor Path of Titans real
 * (BisectHosting, "ATLAS BRASIL SEMI-REALISMO", ~76 jogadores) — 3
 * comportamentos do protocolo só foram descobertos nesse teste real, não
 * estavam documentados na doc oficial do PoT nem eram óbvios a partir da
 * especificação genérica do A2S:
 *   1. O servidor exige CHALLENGE também pro A2S_INFO (não só A2S_PLAYER)
 *      — atualização anti-DDoS do protocolo Source (~2020).
 *   2. Os 2 pedidos de um challenge-response (o pedido inicial e o reenvio
 *      com o challenge) PRECISAM sair da MESMA porta de origem UDP — um
 *      socket novo por pedido faz o servidor tratar como sessão nova e
 *      mandar outro challenge em vez da resposta final.
 *   3. A resposta de A2S_PLAYER de um servidor com muitos jogadores online
 *      vem FRAGMENTADA em múltiplos pacotes UDP (cabeçalho 0xFEFFFFFF, com
 *      request ID + total de pacotes + número do pacote + tamanho máximo
 *      do pacote antes do payload) — chegou a acontecer com apenas ~76
 *      jogadores, então é o caso comum, não a exceção.
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

/**
 * Envia UM pedido nesta porta de origem e monta a resposta LÓGICA completa
 * — ou o pacote único (cabeçalho 0xFFFFFFFF), ou a remontagem de todos os
 * fragmentos de uma resposta dividida (cabeçalho 0xFEFFFFFF por fragmento,
 * ver docblock do arquivo). Reutiliza o MESMO socket entre chamadas
 * sucessivas do chamador (challenge → reenvio) — challenge-response exige
 * a mesma porta de origem (confirmado ao vivo, ver docblock do arquivo).
 *
 * @returns {Promise<Buffer>} a resposta reconstruída, no MESMO formato de
 *   uma resposta de pacote único (sempre começa com 0xFFFFFFFF + tipo).
 */
function _query(socket, host, port, requestBuffer, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const fragments = new Map();
        let expectedTotal = null;
        let expectedRequestId = null;

        const timer = setTimeout(() => finish(new Error('Timeout na consulta Source Query.')), timeoutMs);

        function finish(err, data) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.removeListener('message', onMessage);
            socket.removeListener('error', onError);
            if (err) reject(err); else resolve(data);
        }

        function onMessage(msg) {
            if (msg.length < 4) return;
            const header = msg.readInt32LE(0);

            if (header === -1) {
                // Pacote único, sem fragmentação — resposta completa já.
                finish(null, msg);
                return;
            }

            if (header !== -2) return; // nem 0xFFFFFFFF nem 0xFEFFFFFF — não é nossa resposta, ignora
            if (msg.length < 12) return; // fragmento malformado/curto demais — ignora

            const requestId = msg.readInt32LE(4);
            if (requestId & 0x80000000) {
                finish(new Error('Resposta comprimida (bzip2) — não suportada.'));
                return;
            }
            if (expectedRequestId === null) expectedRequestId = requestId;
            if (requestId !== expectedRequestId) return; // fragmento de outra troca sobreposta — ignora

            const total = msg.readUInt8(8);
            const number = msg.readUInt8(9);
            if (expectedTotal === null) expectedTotal = total;
            // bytes[10:12] = tamanho máximo do pacote (não usado aqui) —
            // presente em todo fragmento observado ao vivo (ver docblock).
            fragments.set(number, msg.subarray(12));

            if (fragments.size >= expectedTotal) {
                const ordered = [];
                for (let i = 0; i < expectedTotal; i++) {
                    if (!fragments.has(i)) { finish(new Error('Fragmento faltando na remontagem da resposta.')); return; }
                    ordered.push(fragments.get(i));
                }
                finish(null, Buffer.concat(ordered));
            }
        }
        function onError(err) { finish(err); }

        socket.on('message', onMessage);
        socket.once('error', onError);
        socket.send(requestBuffer, port, host, (err) => { if (err) finish(err); });
    });
}

/**
 * A2S_INFO — contagem de jogadores/nome do servidor/mapa em tempo real.
 * Sempre trata os dois casos possíveis de resposta inicial: direta (tipo
 * 0x49) ou challenge (tipo 0x41, ver docblock do arquivo) seguida de um
 * reenvio com os 4 bytes do challenge anexados ao fim do payload original.
 *
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<{ success: boolean, players?: number, maxPlayers?: number, name?: string, map?: string, error?: string }>}
 */
async function queryInfo(host, port, timeoutMs = 3000) {
    if (!host || !port) return { success: false, error: 'Host/porta não configurados.' };
    const socket = dgram.createSocket('udp4');
    try {
        let response = await _query(socket, host, port, A2S_INFO_REQUEST, timeoutMs);
        if (response.length >= 9 && response.readInt32LE(0) === -1 && response[4] === 0x41) {
            const challenge = response.subarray(5, 9);
            const retryRequest = Buffer.concat([A2S_INFO_REQUEST, challenge]);
            response = await _query(socket, host, port, retryRequest, timeoutMs);
        }
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
    } finally {
        try { socket.close(); } catch (_) {}
    }
}

/**
 * A2S_PLAYER — lista de jogadores conectados agora (nome + duração da
 * sessão em segundos). Fluxo de challenge (2 idas e voltas), com a
 * resposta final possivelmente fragmentada em múltiplos pacotes UDP —
 * ambos os casos tratados por `_query` (ver seu docblock). Casamento com
 * pot_players é por NOME (o protocolo não expõe Alderon ID) — ver
 * reconcileOnlineStatus.
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<{ success: boolean, players?: {name: string, durationSeconds: number}[], error?: string }>}
 */
async function queryPlayers(host, port, timeoutMs = 3000) {
    if (!host || !port) return { success: false, error: 'Host/porta não configurados.' };
    const socket = dgram.createSocket('udp4');
    try {
        const first = await _query(socket, host, port, A2S_PLAYER_CHALLENGE_REQUEST, timeoutMs);
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
            const second = await _query(socket, host, port, playerRequest, timeoutMs);
            if (second.length < 6 || second.readInt32LE(0) !== -1 || second[4] !== 0x44) {
                return { success: false, error: 'Resposta A2S_PLAYER inesperada (após challenge).' };
            }
            playerListBuffer = second;
        } else {
            return { success: false, error: 'Resposta A2S_PLAYER inesperada (tipo de pacote desconhecido).' };
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
    } finally {
        try { socket.close(); } catch (_) {}
    }
}

module.exports = { queryInfo, queryPlayers };
