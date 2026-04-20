// src/events/interactionCreate.js
const InteractionHandler = require('../systems/handlers');
const ReportChatSystem = require('../systems/reportChatSystem');
const ConfigSystem = require('../systems/configSystem');
const sessionManager = require('../utils/sessionManager');

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

            // ==================== REPORTCHAT - ABRIR MODAL ====================
            if (interaction.customId === 'open_report') {
                const reportSystem = new ReportChatSystem(client);
                const modal = reportSystem.getOpenModal();
                await interaction.showModal(modal);
                return;
            }

            if (interaction.customId?.startsWith('close_reason:')) {
                const reportSystem = new ReportChatSystem(client);
                const reportId = interaction.customId.split(':')[1];
                sessionManager.set(interaction.user.id, interaction.guildId || 'dm', 'closing', { reportId }, 300000);
                const modal = reportSystem.getCloseModal();
                await interaction.showModal(modal);
                return;
            }

            if (interaction.customId?.startsWith('rate:')) {
                const reportSystem = new ReportChatSystem(client);
                const reportId = interaction.customId.split(':')[1];
                sessionManager.set(interaction.user.id, interaction.guildId || 'dm', 'rating', { reportId }, 300000);
                const modal = reportSystem.getRatingModal();
                await interaction.showModal(modal);
                return;
            }

            // ==================== REPORTCHAT - AÇÕES ====================
            if (interaction.customId?.startsWith('join:')) {
                await interaction.deferUpdate();
                const reportSystem = new ReportChatSystem(client);
                const reportId = interaction.customId.split(':')[1];
                await reportSystem.joinReport(interaction, reportId);
                return;
            }

            if (interaction.customId?.startsWith('close:') && !interaction.customId.includes('reason')) {
                await interaction.deferUpdate();
                const reportSystem = new ReportChatSystem(client);
                const reportId = interaction.customId.split(':')[1];
                await reportSystem.closeReport(interaction, reportId, null, null, false);
                return;
            }

            // ==================== MODAIS REPORTCHAT ====================
            if (interaction.customId === 'report_modal') {
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
                const session = sessionManager.get(interaction.user.id, interaction.guildId || 'dm', 'closing');
                if (session?.reportId) {
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
                const session = sessionManager.get(interaction.user.id, interaction.guildId || 'dm', 'rating');
                if (session?.reportId) {
                    const reportSystem = new ReportChatSystem(client);
                    const nota = parseInt(interaction.fields.getTextInputValue('nota'));
                    const comentario = interaction.fields.getTextInputValue('comentario');
                    await reportSystem.rateReport(interaction, session.reportId, nota, comentario);
                    sessionManager.delete(interaction.user.id, interaction.guildId || 'dm', 'rating');
                }
                return;
            }
            
            // ==================== CONFIG-POINTS ====================
            if (interaction.customId === 'config-points:strike:modal') {
                await ConfigSystem.handleStrikeModal(interaction);
                return;
            }

            if (interaction.customId === 'config-points:limites:modal') {
                await ConfigSystem.handleLimitesModal(interaction);
                return;
            }

            if (interaction.customId === 'config-points:reset') {
                await ConfigSystem.resetPoints(interaction);
                return;
            }

            // ==================== CONFIG-ROLES ====================
            if (interaction.customId === 'config-roles:staff') {
                await ConfigSystem.setRole(interaction, 'staff_role');
                return;
            }
            if (interaction.customId === 'config-roles:strike') {
                await ConfigSystem.setRole(interaction, 'strike_role');
                return;
            }
            if (interaction.customId === 'config-roles:exemplar') {
                await ConfigSystem.setRole(interaction, 'role_exemplar');
                return;
            }
            if (interaction.customId === 'config-roles:problematico') {
                await ConfigSystem.setRole(interaction, 'role_problematico');
                return;
            }

            // ==================== CONFIG-LOGS ====================
            if (interaction.customId === 'config-logs:geral') {
                await ConfigSystem.setLogChannel(interaction, 'log_channel');
                return;
            }
            if (interaction.customId === 'config-logs:punishments') {
                await ConfigSystem.setLogChannel(interaction, 'log_punishments');
                return;
            }
            if (interaction.customId === 'config-logs:automod') {
                await ConfigSystem.setLogChannel(interaction, 'log_automod');
                return;
            }
            if (interaction.customId === 'config-logs:reports') {
                await ConfigSystem.setLogChannel(interaction, 'log_reports');
                return;
            }
            if (interaction.customId === 'config-logs:criar') {
                await ConfigSystem.createLogChannels(interaction);
                return;
            }
            
            // ==================== MODAIS DE CONFIGURAÇÃO ====================
            if (interaction.customId === 'config-points:strike:modal') {
                await ConfigSystem.processPointsStrikeModal(interaction);
                return;
            }

            if (interaction.customId === 'config-points:limites:modal') {
                await ConfigSystem.processLimitesModal(interaction);
                return;
            }
            
            // ==================== OUTROS COMPONENTES ====================
            if (interaction.isButton() || interaction.isStringSelectMenu() || 
                interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
                
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.deferUpdate();
                }
                await handler.handleComponent(interaction);
                return;
            }
            
            // ==================== MODAIS ====================
            if (interaction.isModalSubmit()) {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.deferReply({ flags: 64 });
                }
                await handler.handleModal(interaction);
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