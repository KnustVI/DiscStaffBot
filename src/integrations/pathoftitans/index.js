// src/integrations/pathoftitans/index.js
const PoTGatewayServer = require('./gatewayServer');
const PoTRconClient = require('./rconClient');
const PoTTokenManager = require('./tokenManager');
const PoTConfigSystem = require('../../systems/pot/potConfigSystem');
const ErrorLogger = require('../../systems/core/errorLogger');
const db = require('../../database/index');

class PathOfTitansIntegration {
    constructor(client) {
        this.client = client;
        this.gateway = null;
        this.rconClients = new Map();
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;
        
        // Iniciar Gateway (escuta eventos do PoT)
        this.gateway = new PoTGatewayServer(this.client);
        this.gateway.start(8080);
        
        this.isInitialized = true;
        console.log('🎮 [PoT] Gateway initialized - ready to receive webhooks');
    }

    async initializeForGuild(guildId, config) {
        if (!config || !config.enabled) return { success: false, error: 'Integração desativada' };

        try {
            // Criar/validar token
            let token = PoTTokenManager.getToken(guildId);
            if (!token) {
                token = PoTTokenManager.generateToken(guildId);
            }

            // Inicializar RCON
            const rcon = new PoTRconClient(guildId, config);
            this.rconClients.set(guildId, rcon);

            // Testar conexão
            const testResult = await rcon.sendCommand('status');

            // Log detalhado (motivo real da falha, não só OK/FAIL) — antes só
            // mostrava sucesso/falha, dificultando diagnosticar se era senha
            // errada, timeout ou conexão recusada/encerrada.
            console.log(`🎮 [PoT] Guild ${guildId} - Token: ${token.substring(0, 20)}... | RCON: ${testResult.success ? 'OK' : `FAIL (${testResult.error})`}`);
            return testResult;

        } catch (error) {
            ErrorLogger.error('pot_integration', 'initializeForGuild', error, { guildId });
            return { success: false, error: error.message };
        }
    }

    async executeCommand(guildId, command) {
        const rcon = this.rconClients.get(guildId);
        if (!rcon) {
            return { success: false, error: 'RCON not initialized for this guild' };
        }
        return await rcon.sendCommand(command);
    }

    async getServerStatus(guildId) {
        const rcon = this.rconClients.get(guildId);
        if (!rcon) {
            return { online: false, error: 'Not configured' };
        }
        return await rcon.sendCommand('status');
    }

    async restartForGuild(guildId) {
        if (this.rconClients.has(guildId)) {
            this.rconClients.delete(guildId);
        }
        
        const db = require('../../database/index');
        const stmt = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'pot_server_config'`);
        const result = stmt.get(guildId);
        
        if (result) {
            const config = JSON.parse(result.value);
            if (config && config.enabled) {
                return await this.initializeForGuild(guildId, config);
            }
        }

        return { success: false, error: 'Servidor não configurado' };
    }

    getStats() {
        return {
            gatewayRunning: this.gateway?.isRunning || false,
            rconConnections: this.rconClients.size,
            initialized: this.isInitialized
        };
    }

    getPublicUrl(guildId) {
        const config = PoTConfigSystem.getServerConfig(guildId);
        if (!config) return null;
        
        return process.env.POT_GATEWAY_URL || `http://${config.server_ip}:${config.webhook_port || 8080}`;
    }

}

let instance = null;

function getInstance(client) {
    if (!instance && client) {
        instance = new PathOfTitansIntegration(client);
        instance.initialize();
    }
    return instance;
}

module.exports = { PathOfTitansIntegration, getInstance };