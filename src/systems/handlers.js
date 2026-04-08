const ResponseManager = require('../utils/responseManager');
const sessionManager = require('../utils/sessionManager');

// Importação dos handlers específicos do seu sistema
const configSystem = require('./configSystem');
const punishmentSystem = require('./punishmentSystem');
const autoModerationModule = require('./autoModeration');
const systemStatus = require('./systemStatus');
const errorLoggerModule = require('./errorLogger');

class InteractionHandler {
    constructor(client) {
        this.client = client;
        
        // Inicializar autoModeration com o client
        let autoModeration;
        if (typeof autoModerationModule === 'function') {
            const result = autoModerationModule(client);
            autoModeration = result;
        } else if (autoModerationModule.AutoModerationSystem) {
            autoModeration = new autoModerationModule.AutoModerationSystem(client);
        } else {
            autoModeration = autoModerationModule;
        }
        
        // Inicializar errorLogger
        const errorLogger = errorLoggerModule;
        
        // Cache estático de handlers
        this.handlers = {
            config: configSystem,
            punishment: punishmentSystem,
            moderation: autoModeration,
            automod: autoModeration,
            status: systemStatus,   
            error: errorLogger,
            'config-points': configSystem,
            'config-roles': configSystem,
            'config-logs': configSystem
        };
        
        // Mapeamento de ações para métodos
        this.actionMap = {
            // Configurações
            set: 'handleSet',
            get: 'handleGet',
            reset: 'handleReset',
            menu: 'handleConfigMenu',
            
            // Punições
            strike: 'handleStrike',
            unstrike: 'handleUnstrike',
            history: 'handleHistory',
            confirm: 'handleStrikeConfirmation',
            
            // Auto Moderação
            automod: 'handleAutoMod',
            toggle: 'handleToggleAutoMod',
            report: 'handleAutoModReport',
            limits: 'handleAutoModConfig',
            
            // Status do Sistema
            status: 'handleStatus',
            refresh: 'handleRefreshStatus',
            details: 'handleDetailedStatus',
            
            // Error Logger
            error: 'handleError',
            view: 'handleViewLogs',
            clear: 'handleClearLogs',
            export: 'handleExportLogs',
            filter: 'handleFilterLogs',

            // Config Strike
            'config-points': 'handleComponent', 
            'config-roles': 'handleComponent',   
            'config-logs': 'handleComponent',   
             
            // Ticket System
            'ticket': 'handleTicket',
        };
    }
    
    /**
     * Processa comandos slash
     */
    async handleCommand(interaction) {
        const command = this.client.commands.get(interaction.commandName);
        
        if (!command) {
            return await ResponseManager.error(interaction, 'Comando não encontrado.');
        }
        
        try {
            await command.execute(interaction, this.client);
        } catch (error) {
            await this.handleError(interaction, error, 'command');
        }
    }
    
    /**
     * Processa componentes (botões e selects)
     */
    async handleComponent(interaction) {
        const parts = interaction.customId.split(':');
        const system = parts[0];
        const action = parts[1];
        const param = parts.slice(2).join(':') || null;
        
        const handler = this.handlers[system];
        if (!handler) {
            return await ResponseManager.error(interaction, `Sistema "${system}" não reconhecido.`);
        }
        
        if (handler.handleComponent && typeof handler.handleComponent === 'function') {
            try {
                await handler.handleComponent(interaction, action, param);
            } catch (error) {
                console.error(`❌ Erro no handleComponent do sistema ${system}:`, error);
                await this.handleError(interaction, error, 'component');
            }
        } else {
            const methodName = this.actionMap[action];
            if (methodName && handler[methodName] && typeof handler[methodName] === 'function') {
                try {
                    await handler[methodName](interaction, param);
                } catch (error) {
                    console.error(`❌ Erro no método ${methodName}:`, error);
                    await this.handleError(interaction, error, 'component');
                }
            } else {
                await ResponseManager.error(interaction, `Ação "${action}" não implementada para o sistema "${system}".`);
            }
        }
    }
    
    /**
     * Processa modais
     */
    async handleModal(interaction) {
        const parts = interaction.customId.split(':');
        const system = parts[0];
        const action = parts[1];
        
        const handler = this.handlers[system];
        if (!handler) {
            return await ResponseManager.error(interaction, `Sistema "${system}" não reconhecido.`);
        }
        
        if (handler.handleModal && typeof handler.handleModal === 'function') {
            try {
                await handler.handleModal(interaction, action);
            } catch (error) {
                console.error(`❌ Erro no handleModal do sistema ${system}:`, error);
                await this.handleError(interaction, error, 'modal');
            }
        } else {
            const methodName = `handleModal${action.charAt(0).toUpperCase() + action.slice(1)}`;
            if (handler[methodName] && typeof handler[methodName] === 'function') {
                try {
                    await handler[methodName](interaction);
                } catch (error) {
                    await this.handleError(interaction, error, 'modal');
                }
            } else {
                await ResponseManager.error(interaction, `Modal "${action}" não implementado para o sistema "${system}".`);
            }
        }
    }
    
    /**
     * Tratamento de erros unificado com logging profissional
     */
    async handleError(interaction, error, type) {
        // Log detalhado
        console.error(`❌ Erro no ${type}:`, error);
        
        // Registrar no sistema de logs com categoria
        if (this.handlers.error?.logInteractionError) {
            await this.handlers.error.logInteractionError(interaction, error, type);
        } else {
            // Fallback: log no console
            const ErrorLogger = require('./errorLogger');
            await ErrorLogger.error('system', `Interaction_${type}`, error, {
                interactionId: interaction.id,
                guildId: interaction.guildId,
                userId: interaction.user?.id,
                commandName: interaction.commandName,
                customId: interaction.customId
            });
        }
        
        // Garantir resposta amigável ao usuário
        try {
            await ResponseManager.error(interaction, 'Ocorreu um erro ao processar sua solicitação. A equipe foi notificada.');
        } catch (err) {
            console.error('❌ Erro ao enviar mensagem de erro:', err);
        }
    }
    
    /**
     * Carrega todos os caches dos sistemas
     */
    async loadAllCaches() {
        const results = {};
        
        for (const [name, handler] of Object.entries(this.handlers)) {
            if (handler && handler.loadCache && typeof handler.loadCache === 'function') {
                try {
                    results[name] = await handler.loadCache();
                } catch (error) {
                    console.error(`❌ Erro ao carregar cache de ${name}:`, error);
                    results[name] = false;
                }
            }
        }
        
        return results;
    }
}

module.exports = InteractionHandler;