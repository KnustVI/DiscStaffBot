/**
 * Cliente RCON para Path of Titans
 * Funciona independente - se falhar, apenas loga erro
 */
const net = require('net');
const ErrorLogger = require('../../systems/errorLogger');

class PoTRconClient {
    constructor(guildId, config) {
        this.guildId = guildId;
        this.host = config.server_ip;
        this.port = config.rcon_port || 27015;
        this.password = config.rcon_password;
        this.socket = null;
        this.requestId = 0;
        this.pendingRequests = new Map();
    }

    /**
     * Envia comando RCON para o servidor
     * @returns {Promise<{success: boolean, response: string, error?: string}>}
     */
    async sendCommand(command) {
        return new Promise((resolve) => {
            // Timeout de 5 segundos
            const timeout = setTimeout(() => {
                if (this.socket) {
                    this.socket.destroy();
                    this.socket = null;
                }
                resolve({ 
                    success: false, 
                    response: null, 
                    error: 'RCON: Timeout - servidor não respondeu' 
                });
            }, 5000);

            try {
                this.requestId++;
                const packet = this._buildPacket(this.requestId, 2, command);
                
                this.socket = net.createConnection(this.port, this.host, () => {
                    this.socket.write(packet);
                });

                this.socket.on('data', (data) => {
                    clearTimeout(timeout);
                    const response = this._parseResponse(data);
                    if (response && response.id === this.requestId) {
                        resolve({ 
                            success: true, 
                            response: response.body || 'Comando executado' 
                        });
                    } else {
                        resolve({ 
                            success: false, 
                            response: null, 
                            error: 'RCON: Resposta inválida' 
                        });
                    }
                    this.socket.destroy();
                    this.socket = null;
                });

                this.socket.on('error', (err) => {
                    clearTimeout(timeout);
                    ErrorLogger.warn('pot_rcon', 'connection', err.message, { guildId: this.guildId });
                    resolve({ 
                        success: false, 
                        response: null, 
                        error: `RCON: ${err.message}` 
                    });
                    this.socket = null;
                });

            } catch (error) {
                clearTimeout(timeout);
                ErrorLogger.error('pot_rcon', 'sendCommand', error, { guildId: this.guildId, command });
                resolve({ 
                    success: false, 
                    response: null, 
                    error: error.message 
                });
            }
        });
    }

    _buildPacket(id, type, body) {
        const bodyBuffer = Buffer.from(body, 'utf8');
        const packetLength = Buffer.byteLength(body, 'utf8') + 14;
        const buffer = Buffer.alloc(packetLength);
        
        buffer.writeInt32LE(packetLength - 4, 0);
        buffer.writeInt32LE(id, 4);
        buffer.writeInt32LE(type, 8);
        bodyBuffer.copy(buffer, 12);
        buffer.writeInt32LE(0, packetLength - 2);
        
        return buffer;
    }

    _parseResponse(buffer) {
        if (buffer.length < 12) return null;
        return {
            id: buffer.readInt32LE(4),
            type: buffer.readInt32LE(8),
            body: buffer.toString('utf8', 12, buffer.length - 2)
        };
    }

    disconnect() {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
    }
}

module.exports = PoTRconClient;