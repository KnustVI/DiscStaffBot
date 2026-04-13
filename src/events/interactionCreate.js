const InteractionHandler = require('../systems/handlers');
const ReportChatSystem = require('../systems/reportChatSystem');
const ReportChatFormatter = require('../utils/reportChatFormatter');

let handler = null;
let reportChatSystem = null;

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // Inicializar
        if (!handler) handler = new InteractionHandler(client);
        if (!reportChatSystem) reportChatSystem = new ReportChatSystem(client);
        
        try {
            // ==================== COMANDOS ====================
            if (interaction.isCommand()) {
                const isEphemeral = ['config', 'strike', 'unstrike', 'repset', 'config-rep', 'config-strike', 'reportchat'].includes(interaction.commandName);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.deferReply({ flags: isEphemeral ? 64 : 0 });
                }
                await handler.handleCommand(interaction);
                return;
            }
            
            // ==================== REPORTCHAT - BOTÕES ====================
            if (interaction.isButton()) {
                const customId = interaction.customId;
                
                // Botão criar report
                if (customId === 'reportchat:create') {
                    await interaction.showModal(ReportChatFormatter.createOpenModal());
                    return;
                }
                
                // Botão entrar (join:XXX)
                if (customId.startsWith('join:')) {
                    await interaction.deferUpdate();
                    const reportId = customId.split(':')[1];
                    await reportChatSystem.joinReport(interaction, reportId);
                    return;
                }
                
                // Botão fechar sem motivo (close:XXX)
                if (customId.startsWith('close:') && !customId.includes('reason')) {
                    await interaction.deferUpdate();
                    const reportId = customId.split(':')[1];
                    await reportChatSystem.closeReport(interaction, reportId, null, null, false, true);
                    return;
                }
                
                // Botão abrir modal de fechamento com motivo (close_reason:XXX)
                if (customId.startsWith('close_reason:')) {
                    const reportId = customId.split(':')[1];
                    // Salvar na sessão
                    const sessionManager = require('../utils/sessionManager');
                    sessionManager.set(interaction.user.id, interaction.guildId || 'dm', 'closing', { reportId }, 300000);
                    await interaction.showModal(ReportChatFormatter.createCloseReasonModal());
                    return;
                }
                
                // Botão avaliar (rate:XXX)
                if (customId.startsWith('rate:')) {
                    const reportId = customId.split(':')[1];
                    const sessionManager = require('../utils/sessionManager');
                    sessionManager.set(interaction.user.id, interaction.guildId || 'dm', 'rating', { reportId }, 300000);
                    await interaction.showModal(ReportChatFormatter.createRatingModal());
                    return;
                }
                
                // Outros botões (não reportchat) - enviar para handler
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.deferUpdate();
                }
                await handler.handleComponent(interaction);
                return;
            }
            
            // ==================== REPORTCHAT - MODAIS ====================
            if (interaction.isModalSubmit()) {
                const customId = interaction.customId;
                const sessionManager = require('../utils/sessionManager');
                
                // Modal de abertura
                if (customId === 'reportchat:open:modal') {
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
                if (customId === 'reportchat:close:reason:modal') {
                    await interaction.deferReply({ flags: 64 });
                    const session = sessionManager.get(interaction.user.id, interaction.guildId || 'dm', 'closing');
                    if (session?.reportId) {
                        const motivo = interaction.fields.getTextInputValue('motivo');
                        const punicao = interaction.fields.getTextInputValue('punicao');
                        await reportChatSystem.closeReport(interaction, session.reportId, motivo, punicao, true, true);
                        sessionManager.delete(interaction.user.id, interaction.guildId || 'dm', 'closing');
                    }
                    return;
                }
                
                // Modal de avaliação
                if (customId === 'reportchat:rating') {
                    await interaction.deferReply({ flags: 64 });
                    const session = sessionManager.get(interaction.user.id, interaction.guildId || 'dm', 'rating');
                    if (session?.reportId) {
                        const nota = parseInt(interaction.fields.getTextInputValue('nota'));
                        const comentario = interaction.fields.getTextInputValue('comentario');
                        await reportChatSystem.rateReport(interaction, session.reportId, nota, comentario);
                        sessionManager.delete(interaction.user.id, interaction.guildId || 'dm', 'rating');
                    }
                    return;
                }
                
                // Outros modais
                await handler.handleModal(interaction);
                return;
            }
            
            // ==================== OUTROS COMPONENTES ====================
            if (interaction.isButton() || interaction.isStringSelectMenu() || 
                interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
                
                if (!interaction.customId) {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '❌ Configuração inválida.', flags: 64 });
                    }
                    return;
                }
                
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.deferUpdate();
                }
                await handler.handleComponent(interaction);
                return;
            }
            
        } catch (error) {
            console.error(`❌ Erro:`, error);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '❌ Ocorreu um erro. Tente novamente.', flags: 64 });
                }
            } catch (err) {}
        }
    }
};