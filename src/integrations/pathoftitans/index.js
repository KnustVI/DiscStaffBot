// src/integrations/pathoftitans/index.js
const PoTGatewayServer = require('./gatewayServer');
const PoTRconClient = require('./rconClient');
const PoTTokenManager = require('./tokenManager');
const ErrorLogger = require('../../systems/errorLogger');
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
        if (!config || !config.enabled) return false;
        
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
            
            console.log(`🎮 [PoT] Guild ${guildId} - Token: ${token.substring(0, 20)}... | RCON: ${testResult.success ? 'OK' : 'FAIL'}`);
            return testResult.success;
            
        } catch (error) {
            ErrorLogger.error('pot_integration', 'initializeForGuild', error, { guildId });
            return false;
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
        
        return false;
    }

    getStats() {
        return {
            gatewayRunning: this.gateway?.isRunning || false,
            rconConnections: this.rconClients.size,
            initialized: this.isInitialized
        };
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