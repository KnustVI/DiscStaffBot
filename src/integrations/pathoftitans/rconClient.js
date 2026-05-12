// src/integrations/pathoftitans/rconClient.js
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

    async sendCommand(command) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (this.socket) {
                    this.socket.destroy();
                    this.socket = null;
                }
                resolve({ success: false, response: null, error: 'RCON: Timeout' });
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
                        resolve({ success: true, response: response.body || 'OK' });
                    } else {
                        resolve({ success: false, response: null, error: 'Invalid response' });
                    }
                    this.socket.destroy();
                    this.socket = null;
                });

                this.socket.on('error', (err) => {
                    clearTimeout(timeout);
                    resolve({ success: false, response: null, error: err.message });
                    this.socket = null;
                });

            } catch (error) {
                clearTimeout(timeout);
                ErrorLogger.error('pot_rcon', 'sendCommand', error, { guildId: this.guildId, command });
                resolve({ success: false, response: null, error: error.message });
            }
        });
    }

    _buildPacket(id, type, body) {
        const bodyBuffer = Buffer.from(body, 'utf8');
        // Packet length: 4 bytes for ID + 4 bytes for type + body length + 2 null bytes
        const packetLength = 4 + 4 + bodyBuffer.length + 2;
        const buffer = Buffer.alloc(packetLength);
        
        let offset = 0;
        buffer.writeInt32LE(packetLength, offset); offset += 4;
        buffer.writeInt32LE(id, offset); offset += 4;
        buffer.writeInt32LE(type, offset); offset += 4;
        bodyBuffer.copy(buffer, offset);
        offset += bodyBuffer.length;
        buffer.writeInt16LE(0, offset); // Null terminator
        
        return buffer;
    }

    _parseResponse(buffer) {
        if (buffer.length < 14) return null;
        
        let offset = 0;
        const size = buffer.readInt32LE(offset); offset += 4;
        const id = buffer.readInt32LE(offset); offset += 4;
        const type = buffer.readInt32LE(offset); offset += 4;
        const body = buffer.toString('utf8', offset, buffer.length - 2);
        
        return { id, type, body };
    }

    disconnect() {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
    }
}

module.exports = PoTRconClient;