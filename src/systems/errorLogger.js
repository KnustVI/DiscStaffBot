const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Cores para terminal (mantendo compatibilidade)
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
        
        // Inicializar diretório de logs (sem await, chamada assíncrona)
        this.init().catch(err => {
            console.error(`${COLORS.BG_RED}[CRITICAL]${COLORS.RESET} Falha na inicialização:`, err.message);
        });
    }
    
    /**
     * Inicializa o logger (cria diretório se necessário)
     */
    async init() {
        if (this.isInitialized) return;
        
        try {
            await fs.mkdir(this.options.logDir, { recursive: true });
            this.isInitialized = true;
            
            // Limpar logs antigos se necessário
            await this.cleanOldLogs();
        } catch (err) {
            console.error(`${COLORS.BG_RED}[CRITICAL]${COLORS.RESET} Falha ao criar diretório de logs:`, err.message);
        }
    }
    
    /**
     * Limpa logs antigos mantendo apenas os últimos maxLogFiles
     */
    async cleanOldLogs() {
        if (!this.options.logToFile) return;
        
        try {
            const files = await fs.readdir(this.options.logDir);
            const logFiles = files.filter(f => f.endsWith('.log') || f.endsWith('.json'));
            
            if (logFiles.length > this.options.maxLogFiles) {
                const fileStats = await Promise.all(
                    logFiles.map(async (file) => ({
                        name: file,
                        path: path.join(this.options.logDir, file),
                        mtime: (await fs.stat(path.join(this.options.logDir, file))).mtime
                    }))
                );
                
                fileStats.sort((a, b) => b.mtime - a.mtime);
                const toDelete = fileStats.slice(this.options.maxLogFiles);
                
                for (const file of toDelete) {
                    await fs.unlink(file.path).catch(() => null);
                    console.log(`${COLORS.YELLOW}[LOG]${COLORS.RESET} Log antigo removido: ${file.name}`);
                }
            }
        } catch (err) {
            // Silenciar erros de limpeza
        }
    }
    
    // ==================== MÉTODOS PARA HANDLER CENTRAL ====================
    
    /**
     * Handler para componentes (botões e selects)
     * Chamado pelo InteractionHandler quando customId começa com "error:"
     */
    async handleComponent(interaction, action, param) {
        try {
            switch (action) {
                case 'view':
                    await this.handleViewLogs(interaction, param);
                    break;
                case 'clear':
                    await this.handleClearLogs(interaction);
                    break;
                case 'export':
                    await this.handleExportLogs(interaction);
                    break;
                default:
                    await interaction.editReply({
                        content: `❌ Ação "${action}" não reconhecida no sistema de logs.`,
                        components: []
                    });
            }
        } catch (error) {
            console.error('❌ Erro no handleComponent do errorLogger:', error);
            await interaction.editReply({
                content: '❌ Ocorreu um erro ao processar os logs.',
                components: []
            });
        }
    }
    
    /**
     * Handler para modais
     */
    async handleModal(interaction, action) {
        try {
            switch (action) {
                case 'filter':
                    await this.processFilterModal(interaction);
                    break;
                default:
                    await interaction.editReply({
                        content: `❌ Modal "${action}" não reconhecido no sistema de logs.`,
                        ephemeral: true
                    });
            }
        } catch (error) {
            console.error('❌ Erro no handleModal do errorLogger:', error);
            await interaction.editReply({
                content: '❌ Ocorreu um erro ao processar o modal.',
                ephemeral: true
            });
        }
    }
    
    /**
     * Visualiza logs recentes
     */
    async handleViewLogs(interaction, param) {
        const limit = param ? parseInt(param) : 10;
        
        try {
            const logPath = path.join(this.options.logDir, 'system_errors.log');
            const content = await fs.readFile(logPath, 'utf8').catch(() => '');
            
            if (!content) {
                return await interaction.editReply({
                    content: '📭 Nenhum log encontrado.',
                    components: []
                });
            }
            
            const lines = content.split('\n').filter(l => l.trim());
            const recentLogs = lines.slice(-limit * 8); // Cada erro ocupa ~8 linhas
            
            if (recentLogs.length === 0) {
                return await interaction.editReply({
                    content: '📭 Nenhum log encontrado.',
                    components: []
                });
            }
            
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            
            const embed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setTitle('📋 Logs do Sistema')
                .setDescription(`Últimos ${Math.min(limit, Math.floor(recentLogs.length / 8))} erros registrados`)
                .addFields({
                    name: 'Logs Recentes',
                    value: `\`\`\`\n${recentLogs.join('\n').slice(0, 1800)}\n\`\`\``
                })
                .setFooter({ text: `Total de linhas: ${lines.length} | Diretório: logs/` })
                .setTimestamp();
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('error:clear')
                    .setLabel('🗑️ Limpar Logs')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('error:export')
                    .setLabel('📥 Exportar')
                    .setStyle(ButtonStyle.Secondary)
            );
            
            await interaction.editReply({
                embeds: [embed],
                components: [row]
            });
            
        } catch (error) {
            await interaction.editReply({
                content: '❌ Erro ao ler arquivo de logs.',
                components: []
            });
        }
    }
    
    /**
     * Limpa todos os logs
     */
    async handleClearLogs(interaction) {
        try {
            const logPath = path.join(this.options.logDir, 'system_errors.log');
            await fs.writeFile(logPath, '', 'utf8');
            
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Logs Limpos')
                .setDescription('Todos os logs do sistema foram removidos com sucesso.')
                .setTimestamp();
            
            await interaction.editReply({
                embeds: [embed],
                components: []
            });
            
        } catch (error) {
            await interaction.editReply({
                content: '❌ Erro ao limpar arquivo de logs.',
                components: []
            });
        }
    }
    
    /**
     * Exporta logs em formato JSON
     */
    async handleExportLogs(interaction) {
        try {
            const logPath = path.join(this.options.logDir, 'system_errors.log');
            const content = await fs.readFile(logPath, 'utf8').catch(() => '');
            
            // Parse logs para JSON
            const logs = this.parseLogsToJSON(content);
            
            const { AttachmentBuilder } = require('discord.js');
            const jsonBuffer = Buffer.from(JSON.stringify(logs, null, 2), 'utf8');
            const attachment = new AttachmentBuilder(jsonBuffer, { name: `logs_${Date.now()}.json` });
            
            await interaction.editReply({
                content: '📥 Exportação de logs concluída:',
                files: [attachment],
                components: []
            });
            
        } catch (error) {
            await interaction.editReply({
                content: '❌ Erro ao exportar logs.',
                components: []
            });
        }
    }
    
    /**
     * Processa modal de filtro
     */
    async processFilterModal(interaction) {
        const filter = interaction.fields.getTextInputValue('filter');
        
        try {
            const logPath = path.join(this.options.logDir, 'system_errors.log');
            const content = await fs.readFile(logPath, 'utf8').catch(() => '');
            
            const lines = content.split('\n');
            const filtered = lines.filter(l => l.toLowerCase().includes(filter.toLowerCase()));
            
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setTitle(`🔍 Logs filtrados por: ${filter}`)
                .setDescription(`Encontrados ${filtered.length} resultados`)
                .addFields({
                    name: 'Resultados',
                    value: `\`\`\`\n${filtered.slice(0, 50).join('\n') || 'Nenhum resultado encontrado'}\n\`\`\``
                })
                .setTimestamp();
            
            await interaction.editReply({
                embeds: [embed],
                components: []
            });
            
        } catch (error) {
            await interaction.editReply({
                content: '❌ Erro ao filtrar logs.',
                ephemeral: true
            });
        }
    }
    
    // ==================== FUNÇÕES PRINCIPAIS ====================
    
    /**
     * Registra um erro de forma persistente e visível no console.
     * @param {string} context - Onde o erro ocorreu (ex: 'Command_Strike')
     * @param {Error|string|object} error - O erro em si
     * @param {object} metadata - Opcional: Dados extras (user, guild, etc)
     * @param {string} level - Nível do erro: 'error', 'warn', 'info', 'debug'
     */
    async log(context, error, metadata = null, level = 'error') {
        await this.init();
        
        const timestamp = new Date().toLocaleString('pt-BR');
        const isoTimestamp = new Date().toISOString();
        
        // 1. Normalização do Erro
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : 'Sem stack trace';
        const extra = metadata ? `\nMETADATA: ${JSON.stringify(metadata, null, 2)}` : '';
        
        // Nível de severidade com emoji
        const levelEmoji = {
            error: '🔴',
            warn: '🟡',
            info: '🔵',
            debug: '⚪'
        };
        
        const logEntry = [
            `╔═ [${timestamp}] ${levelEmoji[level] || '🔴'} ══════════════════════════════════════════════`,
            `║ CONTEXTO: ${context.toUpperCase()}`,
            `║ NÍVEL: ${level.toUpperCase()}`,
            `║ MENSAGEM: ${message}`,
            `║ STACK: ${stack}${extra}`,
            `║ TIMESTAMP: ${isoTimestamp}`,
            `╚═══════════════════════════════════════════════════════════════`,
            ''
        ].join('\n');
        
        // Adicionar ao buffer
        this.logBuffer.push({
            timestamp: isoTimestamp,
            context,
            level,
            message,
            stack,
            metadata
        });
        
        if (this.logBuffer.length > this.bufferSize) {
            this.logBuffer.shift();
        }
        
        // 2. Escrita em arquivo
        if (this.options.logToFile) {
            try {
                const logPath = path.join(this.options.logDir, 'system_errors.log');
                await fs.appendFile(logPath, logEntry, 'utf8');
            } catch (err) {
                console.error(`${COLORS.BG_RED}[CRITICAL]${COLORS.RESET} Falha ao gravar log no disco:`, err.message);
            }
        }
        
        // 3. Output Visual no Terminal
        if (this.options.logToConsole) {
            const color = level === 'error' ? COLORS.RED : (level === 'warn' ? COLORS.YELLOW : COLORS.CYAN);
            console.error(`${COLORS.BOLD}${color}[${level.toUpperCase()}]${COLORS.RESET} ${context}: ${message}`);
            if (metadata && level === 'error') {
                console.dir(metadata, { depth: null, colors: true });
            }
        }
        
        // 4. Enviar para webhook do Discord se configurado
        if (this.options.enableDiscordWebhook && this.options.discordWebhookUrl && level === 'error') {
            await this.sendToWebhook(context, message, stack, metadata);
        }
    }
    
    /**
     * Registra um erro com nível WARN
     */
    async warn(context, message, metadata = null) {
        await this.log(context, message, metadata, 'warn');
    }
    
    /**
     * Registra uma informação
     */
    async info(context, message, metadata = null) {
        await this.log(context, message, metadata, 'info');
    }
    
    /**
     * Registra um erro de interação do Discord
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
            customId: interaction.customId
        };
        
        await this.log(`Interaction_${type}`, error, metadata, 'error');
    }
    
    /**
     * Envia erro para webhook do Discord
     */
    async sendToWebhook(context, message, stack, metadata) {
        try {
            const fetch = require('node-fetch');
            const webhookData = {
                content: `⚠️ **ERRO CRÍTICO**`,
                embeds: [{
                    title: `🚨 Erro em ${context}`,
                    color: 0xFF0000,
                    fields: [
                        { name: 'Mensagem', value: `\`\`\`${message.slice(0, 500)}\`\`\``, inline: false },
                        { name: 'Stack Trace', value: `\`\`\`${stack.slice(0, 500)}\`\`\``, inline: false },
                        { name: 'Timestamp', value: new Date().toISOString(), inline: true }
                    ],
                    timestamp: new Date().toISOString()
                }]
            };
            
            if (metadata) {
                webhookData.embeds[0].fields.push({
                    name: 'Metadata',
                    value: `\`\`\`json\n${JSON.stringify(metadata, null, 2).slice(0, 500)}\n\`\`\``,
                    inline: false
                });
            }
            
            await fetch(this.options.discordWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(webhookData)
            });
        } catch (err) {
            console.error('❌ Erro ao enviar webhook de erro:', err.message);
        }
    }
    
    /**
     * Obtém estatísticas dos logs
     */
    async getStats() {
        try {
            const logPath = path.join(this.options.logDir, 'system_errors.log');
            const content = await fs.readFile(logPath, 'utf8').catch(() => '');
            const lines = content.split('\n').filter(l => l.trim());
            
            // Contar erros por contexto
            const errorsByContext = {};
            for (const line of lines) {
                const match = line.match(/CONTEXTO: (.+)/);
                if (match) {
                    const context = match[1];
                    errorsByContext[context] = (errorsByContext[context] || 0) + 1;
                }
            }
            
            return {
                totalLines: lines.length,
                totalErrors: Object.values(errorsByContext).reduce((a, b) => a + b, 0),
                errorsByContext,
                bufferSize: this.logBuffer.length,
                logDir: this.options.logDir,
                lastError: this.logBuffer[this.logBuffer.length - 1] || null
            };
        } catch (error) {
            return { error: 'Não foi possível obter estatísticas' };
        }
    }
    
    /**
     * Parseia logs para formato JSON
     */
    parseLogsToJSON(content) {
        const logs = [];
        const lines = content.split('\n');
        
        let currentLog = {};
        
        for (const line of lines) {
            if (line.startsWith('╔═')) {
                if (Object.keys(currentLog).length > 0) {
                    logs.push(currentLog);
                }
                const match = line.match(/\[(.*?)\]/);
                currentLog = { timestamp: match ? match[1] : null };
            } else if (line.startsWith('║ CONTEXTO:')) {
                currentLog.context = line.replace('║ CONTEXTO:', '').trim();
            } else if (line.startsWith('║ NÍVEL:')) {
                currentLog.level = line.replace('║ NÍVEL:', '').trim();
            } else if (line.startsWith('║ MENSAGEM:')) {
                currentLog.message = line.replace('║ MENSAGEM:', '').trim();
            } else if (line.startsWith('║ STACK:')) {
                currentLog.stack = line.replace('║ STACK:', '').trim();
            }
        }
        
        if (Object.keys(currentLog).length > 0) {
            logs.push(currentLog);
        }
        
        return logs;
    }
    
    /**
     * Limpa o buffer de logs em memória
     */
    clearBuffer() {
        this.logBuffer = [];
    }
}

// ==================== EXPORTAÇÃO CORRIGIDA ====================

// Criar a instância singleton
let instance = null;

function getInstance(options = {}) {
    if (!instance) {
        instance = new ErrorLogger(options);
    }
    return instance;
}

// Obter a instância (sem options, usa padrões)
const defaultInstance = getInstance();

// Exportar a instância padrão (para uso geral)
module.exports = defaultInstance;

// Exportar a classe (para quem quiser instanciar separadamente)
module.exports.ErrorLogger = ErrorLogger;

// Exportar os métodos principais diretamente (bind corrigido)
module.exports.handleComponent = async (interaction, action, param) => {
    return defaultInstance.handleComponent(interaction, action, param);
};

module.exports.handleModal = async (interaction, action) => {
    return defaultInstance.handleModal(interaction, action);
};

module.exports.handleViewLogs = async (interaction, param) => {
    return defaultInstance.handleViewLogs(interaction, param);
};

module.exports.handleClearLogs = async (interaction) => {
    return defaultInstance.handleClearLogs(interaction);
};

module.exports.handleExportLogs = async (interaction) => {
    return defaultInstance.handleExportLogs(interaction);
};

module.exports.logInteractionError = async (interaction, error, type) => {
    return defaultInstance.logInteractionError(interaction, error, type);
};

module.exports.log = async (context, error, metadata, level) => {
    return defaultInstance.log(context, error, metadata, level);
};

module.exports.warn = async (context, message, metadata) => {
    return defaultInstance.warn(context, message, metadata);
};

module.exports.info = async (context, message, metadata) => {
    return defaultInstance.info(context, message, metadata);
};

module.exports.getStats = async () => {
    return defaultInstance.getStats();
};