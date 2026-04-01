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
    CYAN: '\x1b[36m',
    BG_RED: '\x1b[41m',
    BOLD: '\x1b[1m'
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
        
        // Inicializar (sem await)
        this.init().catch(() => {});
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
    
    async log(context, error, metadata = null, level = 'error') {
        await this.init();
        
        const timestamp = new Date().toLocaleString('pt-BR');
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : 'Sem stack trace';
        
        // Log no console (evita recursão)
        if (this.options.logToConsole) {
            const color = level === 'error' ? COLORS.RED : (level === 'warn' ? COLORS.YELLOW : COLORS.CYAN);
            console.error(`${COLORS.BOLD}${color}[${level.toUpperCase()}]${COLORS.RESET} ${context}: ${message}`);
        }
        
        // Log em arquivo
        if (this.options.logToFile) {
            try {
                const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${context}: ${message}\n${stack}\n`;
                const logPath = path.join(this.options.logDir, 'system_errors.log');
                await fs.appendFile(logPath, logEntry, 'utf8');
            } catch (err) {
                // Silenciar erro de escrita
            }
        }
    }
    
    async logInteractionError(interaction, error, type = 'command') {
        // Evitar recursão - não tentar logar no banco
        const context = `Interaction_${type}`;
        const message = error instanceof Error ? error.message : String(error);
        
        console.error(`❌ Erro em ${context}: ${message}`);
        
        // Não chamar log novamente para evitar recursão
        // Apenas log no console
    }
    
    async warn(context, message, metadata = null) {
        await this.log(context, message, metadata, 'warn');
    }
    
    async info(context, message, metadata = null) {
        await this.log(context, message, metadata, 'info');
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

// Exportar
module.exports = defaultInstance;
module.exports.ErrorLogger = ErrorLogger;