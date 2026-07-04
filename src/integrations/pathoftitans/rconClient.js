const { Rcon } = require('rcon-client');
const ErrorLogger = require('../../systems/core/errorLogger');

/**
 * Usa a biblioteca `rcon-client` (protocolo Source RCON) em vez de uma
 * implementação manual do protocolo — validada contra o mesmo host/porta/
 * senha do Path of Titans por um colega antes de trocarmos pra cá.
 *
 * Mantém a mesma interface pública que o resto do bot já espera
 * (sendCommand -> { success, response, error }, disconnect()), então
 * index.js/setup.js/status.js não precisam mudar nada.
 */
class PoTRconClient {
    constructor(guildId, config) {
        this.guildId = guildId;
        this.host = config.server_ip;
        this.port = config.rcon_port;
        this.password = config.rcon_password;
        this.client = null;
    }

    /**
     * Conecta, executa UM comando e desconecta. Cada chamada abre sua
     * própria conexão (mesmo padrão de uso do código anterior) — o bot só
     * chama isso sob demanda (/potserver setup, /potserver status), sem
     * nada periódico, então não há necessidade de manter conexão persistente.
     */
    async sendCommand(command) {
        try {
            this.client = await Rcon.connect({
                host: this.host,
                port: this.port,
                password: this.password || '',
                timeout: 5000,
            });

            const response = await this.client.send(command);
            return { success: true, response: response || 'OK' };

        } catch (error) {
            ErrorLogger.error('pot_rcon', 'sendCommand', error, { guildId: this.guildId, command });
            return { success: false, response: null, error: this._friendlyError(error) };

        } finally {
            await this.disconnect();
        }
    }

    /**
     * Traduz erros comuns da biblioteca para mensagens claras — o mesmo
     * padrão de mensagens que o código manual anterior já expunha
     * (Timeout / Senha incorreta / Conexão encerrada), pra manter as telas
     * de /potserver setup e /potserver status consistentes.
     */
    _friendlyError(error) {
        const msg = error?.message || String(error);
        if (/auth/i.test(msg)) return 'RCON: Senha incorreta';
        if (/timeout/i.test(msg)) return 'RCON: Timeout';
        if (/ECONNREFUSED/i.test(msg)) return `RCON: Conexão recusada (${msg})`;
        if (/ECONNRESET|closed/i.test(msg)) return 'RCON: Conexão encerrada pelo servidor';
        return msg;
    }

    async disconnect() {
        if (this.client) {
            try {
                await this.client.end();
            } catch (err) {
                // já desconectado ou socket morto — ignora
            }
            this.client = null;
        }
    }
}

module.exports = PoTRconClient;
