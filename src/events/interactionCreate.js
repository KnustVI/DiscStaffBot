// /home/ubuntu/DiscStaffBot/src/events/interactionCreate.js
const InteractionHandler = require('../systems/handlers');
const ReportChatSystem = require('../systems/reportChatSystem');
const ConfigSystem = require('../systems/configSystem');
const sessionManager = require('../utils/sessionManager');

let handler = null;

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (!handler) handler = new InteractionHandler(client);
        
        // Safe guildId para DMs (SessionManager aceita null e converte para 'dm')
        const safeGuildId = interaction.guildId || 'dm';
        
        try {
            // ==================== COMANDOS ====================
            if (interaction.isCommand()) {
                await handler.handleCommand(interaction);
                return;
            }

            // ==================== AJUDA (BOTÕES DE NAVEGAÇÃO) ====================
            if (interaction.customId === 'ajuda_prev' || interaction.customId === 'ajuda_next') {
                return;
            }

            // ==================== REPORTCHAT - ABRIR MODAL ====================
            if (interaction.customId === 'open_report') {
                const reportSystem = new ReportChatSystem(client);
                const modal = reportSystem.getOpenModal();
                await interaction.showModal(modal);
                return;
            }

            // Botão de fechar com motivo (verifica se é staff ou usuário)
            if (interaction.customId?.startsWith('close_reason:')) {
                const reportSystem = new ReportChatSystem(client);
                const reportId = interaction.customId.split(':')[1]; // ex: "#R2"
                
                // Extrair o número do report (remover #R)
                const reportNumber = parseInt(reportId.replace('#R', ''));
                
                // Salvar na sessão com o número
                sessionManager.set(interaction.user.id, safeGuildId, 'closing', 'closing', { reportNumber, reportId }, 300000);
                
                // Verificar se quem clicou é staff
                let isStaff = false;
                if (interaction.guildId) {
                    const staffRoleId = ConfigSystem.getSetting(interaction.guildId, 'staff_role');
                    isStaff = interaction.member?.roles?.cache?.has(staffRoleId);
                }
                
                const modal = isStaff ? reportSystem.getCloseModalStaff() : reportSystem.getCloseModalUser();
                await interaction.showModal(modal);
                return;
            }

            if (interaction.customId?.startsWith('rate:')) {
                const reportSystem = new ReportChatSystem(client);
                const reportId = interaction.customId.split(':')[1];
                const reportNumber = parseInt(reportId.replace('#R', ''));
                
                sessionManager.set(interaction.user.id, safeGuildId, 'rating', 'rating', { reportNumber, reportId }, 300000);
                const modal = reportSystem.getRatingModal();
                await interaction.showModal(modal);
                return;
            }


            // ==================== REPORTCHAT - AÇÕES ====================
            if (interaction.customId?.startsWith('join:')) {
                // NÃO usar deferUpdate - o método já vai responder
                const reportSystem = new ReportChatSystem(client);
                const reportId = interaction.customId.split(':')[1];
                await reportSystem.joinReport(interaction, reportId);
                return;
            }

            if (interaction.customId?.startsWith('close:') && !interaction.customId.includes('reason')) {
                const reportSystem = new ReportChatSystem(client);
                const reportId = interaction.customId.split(':')[1];
                const reportNumber = parseInt(reportId.replace('#R', ''));
                await reportSystem.closeReport(interaction, reportNumber, null, null, false);
                return;
            }

            // ==================== MODAIS REPORTCHAT (COM DEFER) ====================
            
            // Modal de abertura do report
            if (interaction.customId === 'report_modal') {
                await interaction.deferReply({ flags: 64 });
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

            // Modal de fechamento para STAFF (com punição)
                if (interaction.customId === 'close_modal_staff') {
                    await interaction.deferReply({ flags: 64 });
                    const session = sessionManager.get(interaction.user.id, safeGuildId, 'closing', 'closing');
                    if (session?.reportNumber) {
                        const reportSystem = new ReportChatSystem(client);
                        const motivo = interaction.fields.getTextInputValue('motivo');
                        const punicao = interaction.fields.getTextInputValue('punicao');
                        await reportSystem.closeReport(interaction, session.reportNumber, motivo, punicao, true);
                        sessionManager.delete(interaction.user.id, safeGuildId, 'closing', 'closing');
                    }
                    return;
                }

            // Modal de fechamento para USUÁRIO (apenas motivo)
                if (interaction.customId === 'close_modal_user') {
                        await interaction.deferReply({ flags: 64 });
                        const session = sessionManager.get(interaction.user.id, safeGuildId, 'closing', 'closing');
                        if (session?.reportNumber) {
                            const reportSystem = new ReportChatSystem(client);
                            const motivo = interaction.fields.getTextInputValue('motivo');
                            await reportSystem.closeReport(interaction, session.reportNumber, motivo, null, true);
                            sessionManager.delete(interaction.user.id, safeGuildId, 'closing', 'closing');
                        }
                        return;
                    }

            // Modal de avaliação (rating)
                if (interaction.customId === 'rating_modal') {
                    await interaction.deferReply({ flags: 64 });
                    const session = sessionManager.get(interaction.user.id, safeGuildId, 'rating', 'rating');
                    if (session?.reportNumber) {
                        const reportSystem = new ReportChatSystem(client);
                        const nota = parseInt(interaction.fields.getTextInputValue('nota'));
                        const comentario = interaction.fields.getTextInputValue('comentario');
                        await reportSystem.rateReport(interaction, session.reportNumber, nota, comentario);
                        sessionManager.delete(interaction.user.id, safeGuildId, 'rating', 'rating');
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
            if (interaction.customId === 'config-points:strike:modal:submit') {
                await ConfigSystem.processPointsStrikeModal(interaction);
                return;
            }

            if (interaction.customId === 'config-points:limites:modal:submit') {
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
            
            // ==================== MODAIS (GENÉRICO) ====================
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