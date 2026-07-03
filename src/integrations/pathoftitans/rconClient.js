const net = require('net');
const ErrorLogger = require('../../systems/errorLogger');

// Protocolo Source RCON (usado pelo Path of Titans — ver
// https://hosting.pathoftitans.wiki/setup/source-rcon, que confirma ser o
// RCON padrão Source/Valve, compatível com clientes como mcrcon).
const PACKET_TYPE = {
    AUTH: 3,          // cliente -> servidor: pacote de autenticação (senha)
    AUTH_RESPONSE: 2,  // servidor -> cliente: resultado da autenticação
    EXECCOMMAND: 2,    // cliente -> servidor: comando (mesmo valor numérico do AUTH_RESPONSE — é assim no protocolo)
    RESPONSE_VALUE: 0, // servidor -> cliente: resposta de um comando
};

class PoTRconClient {
    constructor(guildId, config) {
        this.guildId = guildId;
        this.host = config.server_ip;
        this.port = config.rcon_port || 27015;
        this.password = config.rcon_password;
        this.socket = null;
        this.requestId = 0;
    }

    _nextId() {
        this.requestId = (this.requestId % 0x7fffffff) + 1;
        return this.requestId;
    }

    /**
     * Envia um comando RCON. Faz o handshake completo: conecta -> autentica
     * (SERVERDATA_AUTH) -> só então envia o comando (SERVERDATA_EXECCOMMAND).
     * Sem a autenticação o servidor nunca processa o comando — era o bug que
     * fazia o RCON parecer "não conectado" mesmo com IP/porta/senha corretos.
     */
    async sendCommand(command) {
        return new Promise((resolve) => {
            let settled = false;
            let recvBuffer = Buffer.alloc(0);
            let authId = null;
            let authenticated = false;
            let execId = null;

            const finish = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (this.socket) {
                    this.socket.removeAllListeners();
                    this.socket.destroy();
                    this.socket = null;
                }
                resolve(result);
            };

            const timeout = setTimeout(() => {
                finish({ success: false, response: null, error: 'RCON: Timeout' });
            }, 5000);

            try {
                this.socket = net.createConnection(this.port, this.host, () => {
                    authId = this._nextId();
                    this.socket.write(this._buildPacket(authId, PACKET_TYPE.AUTH, this.password || ''));
                });

                this.socket.on('data', (chunk) => {
                    recvBuffer = Buffer.concat([recvBuffer, chunk]);

                    let packet;
                    while ((packet = this._extractPacket(recvBuffer)) !== null) {
                        recvBuffer = packet.rest;
                        const { id, type, body } = packet;

                        if (!authenticated) {
                            // O servidor manda um SERVERDATA_RESPONSE_VALUE vazio (type 0)
                            // antes do AUTH_RESPONSE de verdade (type 2) — ignoramos o
                            // primeiro e só agimos quando type === AUTH_RESPONSE.
                            if (type === PACKET_TYPE.AUTH_RESPONSE) {
                                if (id === -1) {
                                    finish({ success: false, response: null, error: 'RCON: Senha incorreta' });
                                    return;
                                }
                                authenticated = true;
                                execId = this._nextId();
                                this.socket.write(this._buildPacket(execId, PACKET_TYPE.EXECCOMMAND, command));
                            }
                            continue;
                        }

                        if (id === execId) {
                            finish({ success: true, response: body || 'OK' });
                            return;
                        }
                    }
                });

                this.socket.on('error', (err) => {
                    finish({ success: false, response: null, error: err.message });
                });

                this.socket.on('close', () => {
                    finish({ success: false, response: null, error: 'RCON: Conexão encerrada pelo servidor' });
                });

            } catch (error) {
                ErrorLogger.error('pot_rcon', 'sendCommand', error, { guildId: this.guildId, command });
                finish({ success: false, response: null, error: error.message });
            }
        });
    }

    _buildPacket(id, type, body) {
        const bodyBuffer = Buffer.from(body, 'utf8');
        // Protocolo RCON (Source): o campo "Size" informa o tamanho do RESTO
        // do pacote (ID + Type + Body + 2 bytes nulos) e NÃO inclui os 4
        // bytes dele mesmo. O buffer alocado precisa ser packetLength + 4
        // (os 4 bytes do próprio campo Size) — sem esse +4, o buffer estourava
        // 4 bytes no final (bodyBuffer.copy/writeInt16LE), causando
        // "RangeError [ERR_OUT_OF_RANGE]" e falha silenciosa de conexão RCON.
        const packetLength = 4 + 4 + bodyBuffer.length + 2;
        const buffer = Buffer.alloc(packetLength + 4);

        let offset = 0;
        buffer.writeInt32LE(packetLength, offset); offset += 4;
        buffer.writeInt32LE(id, offset); offset += 4;
        buffer.writeInt32LE(type, offset); offset += 4;
        bodyBuffer.copy(buffer, offset);
        offset += bodyBuffer.length;
        buffer.writeInt16LE(0, offset);

        return buffer;
    }

    /**
     * Extrai UM pacote completo do início do buffer acumulado, se já tiver
     * chegado inteiro. Necessário porque um único evento 'data' do socket
     * pode trazer um pacote parcial, um pacote completo, ou vários pacotes
     * concatenados (o servidor manda RESPONSE_VALUE + AUTH_RESPONSE juntos,
     * por exemplo) — não dá pra assumir 1 evento 'data' = 1 pacote.
     *
     * @returns {{ id: number, type: number, body: string, rest: Buffer } | null}
     */
    _extractPacket(buffer) {
        if (buffer.length < 4) return null;

        const size = buffer.readInt32LE(0);
        const totalLength = 4 + size; // 4 bytes do campo Size + o resto (size)
        if (buffer.length < totalLength) return null; // pacote ainda incompleto

        const id = buffer.readInt32LE(4);
        const type = buffer.readInt32LE(8);
        const body = buffer.toString('utf8', 12, totalLength - 2); // exclui os 2 bytes nulos finais
        const rest = buffer.subarray(totalLength);

        return { id, type, body, rest };
    }

    disconnect() {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
    }
}

module.exports = PoTRconClient;
