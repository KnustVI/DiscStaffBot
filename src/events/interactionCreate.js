const InteractionHandler = require('../systems/handlers');
const ResponseManager = require('../utils/responseManager');
const ReportChatSystem = require('../systems/reportChatSystem');
const ReportChatFormatter = require('../utils/reportChatFormatter');

let handler = null;
let reportChatSystem = null;

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        console.log(`🔍 Interação recebida: ${interaction.customId || interaction.commandName}`);
        // Inicializar
        if (!handler) handler = new InteractionHandler(client);
        if (!reportChatSystem) reportChatSystem = new ReportChatSystem(client);
        
        try {
            // ==================== SLASH COMMANDS ====================
            if (interaction.isCommand()) {
                const isEphemeral = ['config', 'strike', 'unstrike', 'repset', 'config-rep', 'config-strike', 'reportchat'].includes(interaction.commandName);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.deferReply({ flags: isEphemeral ? 64 : 0 });
                }
                await handler.handleCommand(interaction);
                return;
            }
            
            // ==================== REPORCHAT SYSTEM ====================

            // Botão que ABRE o modal de criação
            if (interaction.customId === 'reportchat:create') {
                console.log('📌 Abrindo modal de criação');
                const modal = ReportChatFormatter.createOpenModal();
                await interaction.showModal(modal);
                return;
            }

            // Botão entrar no report
            if (interaction.customId?.startsWith('reportchat:join:')) {
                console.log('📌 Staff entrando no report');
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.deferUpdate();
                }
                const reportId = interaction.customId.split(':')[2];
                await reportChatSystem.joinReport(interaction, reportId);
                return;
            }

            // Botão fechar com motivo - abre modal
            if (interaction.customId?.startsWith('reportchat:close:reason:')) {
                console.log('📌 Abrindo modal de fechamento com motivo');
                const reportId = interaction.customId.split(':')[3];
                const modal = ReportChatFormatter.createCloseReasonModal();
                await interaction.showModal(modal);
                const sessionManager = require('../utils/sessionManager');
                sessionManager.set(interaction.user.id, interaction.guildId, 'reportchat', 'closing', { reportId }, 300000);
                return;
            }

            // Botão fechar sem motivo
            if (interaction.customId?.startsWith('reportchat:close:no-reason:')) {
                console.log('📌 Fechando report sem motivo');
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.deferUpdate();
                }
                const reportId = interaction.customId.split(':')[3];
                await reportChatSystem.closeReport(interaction, reportId, null, null, false);
                return;
            }

            // Botão avaliar - abre modal
            if (interaction.customId?.startsWith('reportchat:rate:')) {
                console.log('📌 Abrindo modal de avaliação');
                const reportId = interaction.customId.split(':')[2];
                const modal = ReportChatFormatter.createRatingModal();
                await interaction.showModal(modal);
                const sessionManager = require('../utils/sessionManager');
                sessionManager.set(interaction.user.id, interaction.guildId, 'reportchat', 'rating', { reportId }, 300000);
                return;
            }

           // ==================== MODAIS ====================
            if (interaction.isModalSubmit()) {
                const sessionManager = require('../utils/sessionManager');
                
                // MODAL DE ABERTURA - processa os dados
                if (interaction.customId === 'reportchat:open:modal') {
                    console.log('📌 Processando modal de abertura');
                    const data = {
                        seuNick: interaction.fields.getTextInputValue('seu_nick'),
                        alvoNick: interaction.fields.getTextInputValue('alvo_nick'),
                        dataHora: interaction.fields.getTextInputValue('data_hora'),
                        regra: interaction.fields.getTextInputValue('regra'),
                        descricao: interaction.fields.getTextInputValue('descricao')
                    };
                    await reportChatSystem.openReport(interaction, data);
                    return;
                }
                
                // Modal de fechamento com motivo
                if (interaction.customId === 'reportchat:close:reason:modal') {
                    console.log('📌 Processando modal de fechamento');
                    const session = sessionManager.get(interaction.user.id, interaction.guildId, 'reportchat', 'closing');
                    if (session?.reportId) {
                        const motivo = interaction.fields.getTextInputValue('motivo');
                        const punicao = interaction.fields.getTextInputValue('punicao');
                        await reportChatSystem.closeReport(interaction, session.reportId, motivo, punicao, true);
                        sessionManager.delete(interaction.user.id, interaction.guildId, 'reportchat', 'closing');
                    }
                    return;
                }
                
                // Modal de avaliação
                if (interaction.customId === 'reportchat:rating') {
                    console.log('📌 Processando modal de avaliação');
                    const session = sessionManager.get(interaction.user.id, interaction.guildId, 'reportchat', 'rating');
                    if (session?.reportId) {
                        const nota = parseInt(interaction.fields.getTextInputValue('nota'));
                        const comentario = interaction.fields.getTextInputValue('comentario');
                        await reportChatSystem.rateReport(interaction, session.reportId, nota, comentario);
                        sessionManager.delete(interaction.user.id, interaction.guildId, 'reportchat', 'rating');
                    }
                    return;
                }
                
                // Outros modais
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '⏳ Processando...', flags: 64 });
                }
                await handler.handleModal(interaction);
                return;
            }
            
            // ==================== COMPONENTES GERAIS ====================
            if (interaction.isButton() || interaction.isStringSelectMenu() || 
                interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
                
                if (!interaction.customId) {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '❌ Configuração inválida.', flags: 64 });
                    }
                    return;
                }
                
                const needsDefer = !interaction.customId.endsWith(':modal') && 
                                !interaction.customId.startsWith('reportchat:close:rate') &&
                                !interaction.customId.startsWith('reportchat:close:reason') &&
                                !interaction.customId.startsWith('reportchat:rate') &&
                                !interaction.customId.startsWith('reportchat:create') &&  
                                !interaction.customId.startsWith('reportchat:join');    
                
                if (needsDefer && !interaction.replied && !interaction.deferred) {
                    await interaction.deferUpdate();
                }
                
                // Só processa se NÃO for do reportchat
                if (!interaction.customId.startsWith('reportchat')) {
                    await handler.handleComponent(interaction);
                }
                
                return;
            }
            
        } catch (error) {
            console.error(`❌ Erro fatal:`, error);
            
            // Tentar recuperar a interação
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '❌ Ocorreu um erro. Tente novamente.', flags: 64 });
                } else if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply({ content: '❌ Ocorreu um erro. Tente novamente.' });
                }
            } catch (err) {
                console.error('❌ Falha ao responder:', err);
            }
        }
    }
};