// src/events/interactionCreate.js
const InteractionHandler = require('../systems/handlers');

let handler = null;

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (!handler) handler = new InteractionHandler(client);
        
        try {
            // ==================== COMANDOS ====================
            if (interaction.isCommand()) {
                const isEphemeral = ['config', 'strike', 'unstrike', 'repset', 'config-rep', 'config-strike'].includes(interaction.commandName);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.deferReply({ flags: isEphemeral ? 64 : 0 });
                }
                await handler.handleCommand(interaction);
                return;
            }

            // ==================== REPORTCHAT ====================
            if (interaction.customId === 'open_report') {
                const ReportChatSystem = require('../systems/reportChatSystem');
                const reportSystem = new ReportChatSystem(client);
                const modal = reportSystem.getOpenModal();
                await interaction.showModal(modal);
                return;
            }

            if (interaction.customId?.startsWith('join:')) {
                await interaction.deferUpdate();
                const ReportChatSystem = require('../systems/reportChatSystem');
                const reportSystem = new ReportChatSystem(client);
                const reportId = interaction.customId.split(':')[1];
                await reportSystem.joinReport(interaction, reportId);
                return;
            }

            if (interaction.customId?.startsWith('close:') && !interaction.customId.includes('reason')) {
                await interaction.deferUpdate();
                const ReportChatSystem = require('../systems/reportChatSystem');
                const reportSystem = new ReportChatSystem(client);
                const reportId = interaction.customId.split(':')[1];
                await reportSystem.closeReport(interaction, reportId, null, null, false);
                return;
            }

            if (interaction.customId?.startsWith('close_reason:')) {
                const ReportChatSystem = require('../systems/reportChatSystem');
                const reportSystem = new ReportChatSystem(client);
                const reportId = interaction.customId.split(':')[1];
                // Usar sessionManager para armazenar o reportId temporariamente
                const sessionManager = require('../utils/sessionManager');
                sessionManager.set(interaction.user.id, interaction.guildId || 'dm', 'closing', { reportId }, 300000);
                const modal = reportSystem.getCloseModal();
                await interaction.showModal(modal);
                return;
            }

            if (interaction.customId?.startsWith('rate:')) {
                const ReportChatSystem = require('../systems/reportChatSystem');
                const reportSystem = new ReportChatSystem(client);
                const reportId = interaction.customId.split(':')[1];
                const sessionManager = require('../utils/sessionManager');
                sessionManager.set(interaction.user.id, interaction.guildId || 'dm', 'rating', { reportId }, 300000);
                const modal = reportSystem.getRatingModal();
                await interaction.showModal(modal);
                return;
            }

            if (interaction.customId === 'report_modal') {
                const ReportChatSystem = require('../systems/reportChatSystem');
                const reportSystem = new ReportChatSystem(client);
                const data = {
                    regra: interaction.fields.getTextInputValue('regra'),
                    dataHora: interaction.fields.getTextInputValue('data_hora'),
                    local: interaction.fields.getTextInputValue('local'),
                    descricao: interaction.fields.getTextInputValue('descricao'),
                    termo: interaction.fields.getTextInputValue('termo')
                };
                await reportSystem.openReport(interaction, data);
                return;
            }

            if (interaction.customId === 'close_modal') {
                await interaction.deferReply({ flags: 64 });
                const sessionManager = require('../utils/sessionManager');
                const session = sessionManager.get(interaction.user.id, interaction.guildId || 'dm', 'closing');
                if (session?.reportId) {
                    const ReportChatSystem = require('../systems/reportChatSystem');
                    const reportSystem = new ReportChatSystem(client);
                    const motivo = interaction.fields.getTextInputValue('motivo');
                    const punicao = interaction.fields.getTextInputValue('punicao');
                    await reportSystem.closeReport(interaction, session.reportId, motivo, punicao, true);
                    sessionManager.delete(interaction.user.id, interaction.guildId || 'dm', 'closing');
                }
                return;
            }

            if (interaction.customId === 'rating_modal') {
                await interaction.deferReply({ flags: 64 });
                const sessionManager = require('../utils/sessionManager');
                const session = sessionManager.get(interaction.user.id, interaction.guildId || 'dm', 'rating');
                if (session?.reportId) {
                    const ReportChatSystem = require('../systems/reportChatSystem');
                    const reportSystem = new ReportChatSystem(client);
                    const nota = parseInt(interaction.fields.getTextInputValue('nota'));
                    const comentario = interaction.fields.getTextInputValue('comentario');
                    await reportSystem.rateReport(interaction, session.reportId, nota, comentario);
                    sessionManager.delete(interaction.user.id, interaction.guildId || 'dm', 'rating');
                }
                return;
            }
            
            // ==================== COMPONENTES ====================
            if (interaction.isButton() || interaction.isStringSelectMenu() || 
                interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu() ||
                interaction.isModalSubmit()) {
                
                if (!interaction.replied && !interaction.deferred) {
                    if (interaction.isModalSubmit()) {
                        await interaction.deferReply({ flags: 64 });
                    } else {
                        await interaction.deferUpdate();
                    }
                }
                await handler.handleComponent(interaction);
                return;
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