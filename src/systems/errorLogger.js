const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Cores para terminal
const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    BLUE: '\x1b[34m',
    MAGENTA: '\x1b[35m',
    CYAN: '\x1b[36m',
    WHITE: '\x1b[37m',
    BG_RED: '\x1b[41m',
    BG_YELLOW: '\x1b[43m',
    BOLD: '\x1b[1m'
};

// Níveis de log
const LOG_LEVELS = {
    ERROR: { name: 'ERROR', color: COLORS.RED, emoji: '🔴' },
    WARN: { name: 'WARN', color: COLORS.YELLOW, emoji: '🟡' },
    INFO: { name: 'INFO', color: COLORS.CYAN, emoji: '🔵' },
    DEBUG: { name: 'DEBUG', color: COLORS.GREEN, emoji: '🟢' }
};

class ErrorLogger {
    constructor(options = {}) {
        this.options = {
            logDir: options.logDir || path.join(__dirname, '../../logs'),
            maxLogFiles: options.maxLogFiles || 10,
            logToConsole: options.logToConsole !== false,
            logToFile: options.logToFile !== false,
            enableDiscordWebhook: options.enableDiscordWebhook || false,
            discordWebhookUrl: options.discordWebhookUrl || null,
            ...options
        };
        
        this.logBuffer = [];
        this.bufferSize = 100;
        this.isInitialized = false;
        
        this.init();
    }
    
    async init() {
        if (this.isInitialized) return;
        try {
            await fs.mkdir(this.options.logDir, { recursive: true });
            this.isInitialized = true;
        } catch (err) {
            console.error(`${COLORS.BG_RED}[CRITICAL]${COLORS.RESET} Falha ao criar diretório de logs:`, err.message);
        }
    }
    
    /**
     * Log principal com categoria
     * @param {string} category - 'error', 'system', 'command', 'interaction'
     * @param {string} context - Contexto onde ocorreu
     * @param {Error|string} error - Erro ou mensagem
     * @param {object} metadata - Dados adicionais
     * @param {string} level - 'ERROR', 'WARN', 'INFO', 'DEBUG'
     */
    async log(category, context, error, metadata = null, level = 'ERROR') {
        await this.init();
        
        const timestamp = new Date().toISOString();
        const localTimestamp = new Date().toLocaleString('pt-BR');
        const levelInfo = LOG_LEVELS[level] || LOG_LEVELS.ERROR;
        
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : null;
        
        // Construir entrada de log
        const logEntry = {
            timestamp,
            localTimestamp,
            category,
            context,
            level,
            message,
            stack,
            metadata
        };
        
        // Adicionar ao buffer
        this.logBuffer.push(logEntry);
        if (this.logBuffer.length > this.bufferSize) {
            this.logBuffer.shift();
        }
        
        // Log no console
        if (this.options.logToConsole) {
            const color = levelInfo.color;
            console.log(
                `${color}[${levelInfo.emoji} ${level}]${COLORS.RESET} [${category.toUpperCase()}] ${context}: ${message}`
            );
            if (stack && level === 'ERROR') {
                console.log(`${COLORS.RED}${stack}${COLORS.RESET}`);
            }
            if (metadata && level === 'ERROR') {
                console.dir(metadata, { depth: null, colors: true });
            }
        }
        
        // Log em arquivo
        if (this.options.logToFile) {
            await this.writeToFile(logEntry);
        }
        
        // Webhook para erros críticos
        if (this.options.enableDiscordWebhook && level === 'ERROR' && category === 'error') {
            await this.sendToWebhook(logEntry);
        }
    }
    
    /**
     * Log de erro
     */
    async error(category, context, error, metadata = null) {
        return this.log(category, context, error, metadata, 'ERROR');
    }
    
    /**
     * Log de aviso
     */
    async warn(category, context, message, metadata = null) {
        return this.log(category, context, message, metadata, 'WARN');
    }
    
    /**
     * Log de informação
     */
    async info(category, context, message, metadata = null) {
        return this.log(category, context, message, metadata, 'INFO');
    }
    
    /**
     * Log de debug
     */
    async debug(category, context, message, metadata = null) {
        return this.log(category, context, message, metadata, 'DEBUG');
    }
    
    /**
     * Log de erro de interação
     */
    async logInteractionError(interaction, error, type = 'command') {
        const metadata = {
            type,
            guildId: interaction.guildId,
            guildName: interaction.guild?.name,
            userId: interaction.user?.id,
            userTag: interaction.user?.tag,
            channelId: interaction.channelId,
            commandName: interaction.commandName,
            customId: interaction.customId,
            replied: interaction.replied,
            deferred: interaction.deferred
        };
        
        return this.error('interaction', `Interaction_${type}`, error, metadata);
    }
    
    /**
     * Escreve log em arquivo
     */
    async writeToFile(logEntry) {
        try {
            const logFile = path.join(this.options.logDir, `${logEntry.category}_${new Date().toISOString().slice(0, 10)}.log`);
            const logLine = JSON.stringify(logEntry) + '\n';
            await fs.appendFile(logFile, logLine, 'utf8');
        } catch (err) {
            console.error('❌ Erro ao escrever log:', err.message);
        }
    }
    
    /**
     * Envia erro para webhook
     */
    async sendToWebhook(logEntry) {
        try {
            const fetch = require('node-fetch');
            const webhookData = {
                content: `⚠️ **ERRO CRÍTICO** | ${logEntry.category.toUpperCase()}`,
                embeds: [{
                    title: `🚨 ${logEntry.context}`,
                    color: 0xFF0000,
                    fields: [
                        { name: 'Categoria', value: logEntry.category, inline: true },
                        { name: 'Nível', value: logEntry.level, inline: true },
                        { name: 'Mensagem', value: `\`\`\`${logEntry.message.slice(0, 500)}\`\`\``, inline: false },
                        { name: 'Timestamp', value: logEntry.localTimestamp, inline: true }
                    ],
                    timestamp: logEntry.timestamp
                }]
            };
            
            if (logEntry.metadata) {
                webhookData.embeds[0].fields.push({
                    name: 'Metadata',
                    value: `\`\`\`json\n${JSON.stringify(logEntry.metadata, null, 2).slice(0, 500)}\n\`\`\``,
                    inline: false
                });
            }
            
            await fetch(this.options.discordWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(webhookData)
            });
        } catch (err) {
            console.error('❌ Erro ao enviar webhook:', err.message);
        }
    }
    
    /**
     * Obtém estatísticas
     */
    async getStats() {
        return {
            bufferSize: this.logBuffer.length,
            logDir: this.options.logDir,
            categories: {
                error: this.logBuffer.filter(l => l.category === 'error').length,
                system: this.logBuffer.filter(l => l.category === 'system').length,
                command: this.logBuffer.filter(l => l.category === 'command').length,
                interaction: this.logBuffer.filter(l => l.category === 'interaction').length
            }
        };
    }
    
    /**
     * Limpa buffer
     */
    clearBuffer() {
        this.logBuffer = [];
    }
}

// Singleton
let instance = null;

function getInstance(options = {}) {
    if (!instance) {
        instance = new ErrorLogger(options);
    }
    return instance;
}

const defaultInstance = getInstance();

module.exports = defaultInstance;
module.exports.ErrorLogger = ErrorLogger;