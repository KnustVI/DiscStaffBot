// src/events/interactionCreate.js
const InteractionHandler = require('../systems/handlers');
const ReportChatSystem = require('../systems/reportChatSystem');
const ReportChatFormatter = require('../utils/reportChatFormatter');
const sessionManager = require('../utils/sessionManager');

let handler = null;
let reportChatSystem = null;

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
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
            
            // ==================== BOTÕES ====================
            if (interaction.isButton()) {
                const customId = interaction.customId;
                
                // Botão criar report
                if (customId === 'reportchat:create') {
                    await interaction.showModal(ReportChatFormatter.createOpenModal());
                    return;
                }
                
                // Botão JOIN (entrar como staff)
                if (customId.startsWith('join:')) {
                    await interaction.deferUpdate();
                    const reportId = customId.split(':')[1];
                    await reportChatSystem.joinReport(interaction, reportId);
                    return;
                }
                
                // Botão CLOSE (fechar sem motivo)
                if (customId.startsWith('close:') && !customId.includes('reason') && !customId.includes('user')) {
                    await interaction.deferUpdate();
                    const reportId = customId.split(':')[1];
                    await reportChatSystem.closeReport(interaction, reportId, null, null, false);
                    return;
                }
                
                // Botão CLOSE_REASON (abrir modal de fechamento com motivo)
                if (customId.startsWith('close_reason:')) {
                    const reportId = customId.split(':')[1];
                    sessionManager.set(interaction.user.id, interaction.guildId || 'dm', 'closing', { reportId }, 300000);
                    await interaction.showModal(ReportChatFormatter.createCloseReasonModal());
                    return;
                }
                
                // Botão RATE (avaliar)
                if (customId.startsWith('rate:')) {
                    const reportId = customId.split(':')[1];
                    sessionManager.set(interaction.user.id, interaction.guildId || 'dm', 'rating', { reportId }, 300000);
                    await interaction.showModal(ReportChatFormatter.createRatingModal());
                    return;
                }
            }
            
            // ==================== MODAIS ====================
            if (interaction.isModalSubmit()) {
                const customId = interaction.customId;
                
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
                        await reportChatSystem.closeReport(interaction, session.reportId, motivo, punicao, true);
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
            }
            
        } catch (error) {
            console.error('❌ Erro:', error);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '❌ Erro. Tente novamente.', flags: 64 });
                }
            } catch (err) {}
        }
    }
};