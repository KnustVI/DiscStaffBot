// Importação dos handlers específicos do seu sistema
const configSystem = require('./configSystem');
const punishmentSystem = require('./punishmentSystem');
const autoModerationModule = require('./autoModeration');
const systemStatus = require('./systemStatus');
const errorLoggerModule = require('./errorLogger');

// Inicializar corretamente os módulos que precisam de instância
// autoModerationModule é uma função que espera receber o client
// errorLoggerModule é uma função singleton que retorna a instância

class InteractionHandler {
    constructor(client) {
        this.client = client;
        
        // Inicializar autoModeration com o client (se for função)
        let autoModeration;
        if (typeof autoModerationModule === 'function') {
            // Se for uma função que retorna uma instância
            const result = autoModerationModule(client);
            autoModeration = result;
        } else if (autoModerationModule.AutoModerationSystem) {
            // Se for a classe exportada
            autoModeration = new autoModerationModule.AutoModerationSystem(client);
        } else {
            // Se já for o objeto direto
            autoModeration = autoModerationModule;
        }
        
        // Inicializar errorLogger (já é singleton, só pegar a instância)
        const errorLogger = errorLoggerModule;
        
        // Cache estático de handlers (evita require dinâmico)
        this.handlers = {
            config: configSystem,
            punishment: punishmentSystem,
            moderation: autoModeration,
            automod: autoModeration,      // Alias para automod
            status: systemStatus,
            error: errorLogger
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
            filter: 'handleFilterLogs'
        };
    }
    
    /**
     * Processa comandos slash
     */
    async handleCommand(interaction) {
        const command = this.client.commands.get(interaction.commandName);
        
        if (!command) {
            return interaction.editReply({ 
                content: '❌ Comando não encontrado.', 
                ephemeral: true 
            });
        }
        
        try {
            await command.execute(interaction, this.client);
        } catch (error) {
            await this.handleError(interaction, error, 'command');
        }
    }
    
    /**
     * Processa componentes (botões e selects)
     * CustomId padrão: sistema:acao:parametro
     */
    async handleComponent(interaction) {
        const parts = interaction.customId.split(':');
        const system = parts[0];
        const action = parts[1];
        const param = parts.slice(2).join(':') || null;
        
        const handler = this.handlers[system];
        if (!handler) {
            console.warn(`⚠️ Handler não encontrado para sistema: ${system}`);
            return interaction.editReply({ 
                content: `❌ Sistema "${system}" não reconhecido.`, 
                components: [] 
            });
        }
        
        // Verificar se o handler tem o método handleComponent
        if (handler.handleComponent && typeof handler.handleComponent === 'function') {
            try {
                await handler.handleComponent(interaction, action, param);
            } catch (error) {
                console.error(`❌ Erro no handleComponent do sistema ${system}:`, error);
                await this.handleError(interaction, error, 'component');
            }
        } else {
            // Fallback: tentar usar o actionMap
            const methodName = this.actionMap[action];
            if (methodName && handler[methodName] && typeof handler[methodName] === 'function') {
                try {
                    await handler[methodName](interaction, param);
                } catch (error) {
                    console.error(`❌ Erro no método ${methodName} do sistema ${system}:`, error);
                    await this.handleError(interaction, error, 'component');
                }
            } else {
                await interaction.editReply({ 
                    content: `❌ Ação "${action}" não implementada para o sistema "${system}".`,
                    components: [] 
                });
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
            return interaction.editReply({ 
                content: `❌ Sistema "${system}" não reconhecido.`, 
                ephemeral: true 
            });
        }
        
        // Verificar se o handler tem o método handleModal
        if (handler.handleModal && typeof handler.handleModal === 'function') {
            try {
                await handler.handleModal(interaction, action);
            } catch (error) {
                console.error(`❌ Erro no handleModal do sistema ${system}:`, error);
                await this.handleError(interaction, error, 'modal');
            }
        } else {
            // Fallback: tentar método específico
            const methodName = `handleModal${action.charAt(0).toUpperCase() + action.slice(1)}`;
            if (handler[methodName] && typeof handler[methodName] === 'function') {
                try {
                    await handler[methodName](interaction);
                } catch (error) {
                    await this.handleError(interaction, error, 'modal');
                }
            } else {
                await interaction.editReply({ 
                    content: `❌ Modal "${action}" não implementado para o sistema "${system}".`,
                    ephemeral: true 
                });
            }
        }
    }
    
    /**
     * Tratamento de erros unificado
     */
    async handleError(interaction, error, type) {
        console.error(`❌ Erro no ${type}:`, error);
        
        const errorMessage = '❌ Ocorreu um erro ao processar esta interação.';
        
        // Garantir que a interação sempre recebe resposta
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            } else if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ content: errorMessage });
            } else if (interaction.replied && type === 'modal') {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            }
        } catch (err) {
            console.error('❌ Erro ao enviar mensagem de erro:', err);
        }
        
        // Log detalhado no sistema de erros (se disponível)
        if (this.handlers.error?.logInteractionError) {
            await this.handlers.error.logInteractionError(interaction, error, type);
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