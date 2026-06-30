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
        
        const safeGuildId = interaction.guildId || 'dm';
        
        try {
            if (interaction.isCommand()) {
                await handler.handleCommand(interaction);
                return;
            }

            // ==================== PAGINAÇÃO (PaginationBuilder) ====================
            if (interaction.customId?.startsWith('pag_')) {
                return;
            }

            // ==================== REPORTCHAT - ABRIR MODAL ====================
            if (interaction.customId === 'open_report') {
                const reportSystem = new ReportChatSystem(client);
                const modal = reportSystem.getOpenModal();
                await interaction.showModal(modal);
                return;
            }

            // ==================== BOTÕES NA DM (COM GUILD_ID) ====================
            
            if (interaction.customId?.startsWith('close_reason:')) {
                const parts = interaction.customId.split(':');
                const guildId = parts[1];
                const reportNumber = parseInt(parts[2]);
                
                const reportSystem = new ReportChatSystem(client);
                const reportId = `#R${reportNumber}`;
                
                sessionManager.set(interaction.user.id, safeGuildId, 'closing', 'closing', { reportNumber, guildId, reportId }, 300000);
                
                let isStaff = false;
                if (guildId) {
                    const guild = client.guilds.cache.get(guildId);
                    if (guild) {
                        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
                        const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
                        isStaff = member?.roles?.cache?.has(staffRoleId);
                    }
                }
                
                const modal = isStaff ? reportSystem.getCloseModalStaff() : reportSystem.getCloseModalUser();
                await interaction.showModal(modal);
                return;
            }

            if (interaction.customId?.startsWith('rate:')) {
                const parts = interaction.customId.split(':');
                const guildId = parts[1];
                const reportNumber = parseInt(parts[2]);
                
                const reportSystem = new ReportChatSystem(client);
                const reportId = `#R${reportNumber}`;
                
                sessionManager.set(interaction.user.id, safeGuildId, 'rating', 'rating', { reportNumber, guildId, reportId }, 300000);
                const modal = reportSystem.getRatingModal();
                await interaction.showModal(modal);
                return;
            }

            if (interaction.customId?.startsWith('close:') && !interaction.customId.includes('reason')) {
                const parts = interaction.customId.split(':');
                const guildId = parts[1];
                const reportNumber = parseInt(parts[2]);
                
                const reportSystem = new ReportChatSystem(client);
                await reportSystem.closeReport(interaction, reportNumber, null, null, false, guildId);
                return;
            }

            // ==================== REPORTCHAT - AÇÕES (NO SERVIDOR) ====================
            if (interaction.customId?.startsWith('join:')) {
                const reportSystem = new ReportChatSystem(client);
                const reportId = interaction.customId.split(':')[1];
                await reportSystem.joinReport(interaction, reportId);
                return;
            }

            // ==================== MODAIS REPORTCHAT ====================
            
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

            if (interaction.customId === 'close_modal_staff') {
                await interaction.deferReply({ flags: 64 });
                const session = sessionManager.get(interaction.user.id, safeGuildId, 'closing', 'closing');
                if (session?.reportNumber && session?.guildId) {
                    const reportSystem = new ReportChatSystem(client);
                    const motivo = interaction.fields.getTextInputValue('motivo');
                    const punicao = interaction.fields.getTextInputValue('punicao');
                    await reportSystem.closeReport(interaction, session.reportNumber, motivo, punicao, true, session.guildId);
                    sessionManager.delete(interaction.user.id, safeGuildId, 'closing', 'closing');
                }
                return;
            }

            if (interaction.customId === 'close_modal_user') {
                await interaction.deferReply({ flags: 64 });
                const session = sessionManager.get(interaction.user.id, safeGuildId, 'closing', 'closing');
                if (session?.reportNumber && session?.guildId) {
                    const reportSystem = new ReportChatSystem(client);
                    const motivo = interaction.fields.getTextInputValue('motivo');
                    await reportSystem.closeReport(interaction, session.reportNumber, motivo, null, true, session.guildId);
                    sessionManager.delete(interaction.user.id, safeGuildId, 'closing', 'closing');
                }
                return;
            }

            if (interaction.customId === 'rating_modal') {
                await interaction.deferReply({ flags: 64 });
                const session = sessionManager.get(interaction.user.id, safeGuildId, 'rating', 'rating');
                if (session?.reportNumber && session?.guildId) {
                    const reportSystem = new ReportChatSystem(client);
                    const nota = parseInt(interaction.fields.getTextInputValue('nota'));
                    const comentario = interaction.fields.getTextInputValue('comentario');
                    await reportSystem.rateReport(interaction, session.reportNumber, nota, comentario, session.guildId);
                    sessionManager.delete(interaction.user.id, safeGuildId, 'rating', 'rating');
                }
                return;
            }
            
            // ==================== CONFIGURAÇÕES ====================
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
            
            if (interaction.customId === 'config-points:strike:modal:submit') {
                await ConfigSystem.processPointsStrikeModal(interaction);
                return;
            }

            if (interaction.customId === 'config-points:limites:modal:submit') {
                await ConfigSystem.processLimitesModal(interaction);
                return;
            }

            // ==================== PATH OF TITANS - RESET ====================
            if (interaction.customId?.startsWith('pot_reset_')) {
                const parts = interaction.customId.split('_');
                const action = parts[2];   // confirm | cancel
                const guildId = parts[3];
                const userId = parts[4];
                const scope = parts.slice(5).join('_');

                if (interaction.user.id !== userId) {
                    await interaction.reply({ content: '❌ Apenas quem iniciou o reset pode confirmar.', flags: 64 });
                    return;
                }

                await interaction.deferUpdate();

                if (action === 'cancel') {
                    await interaction.editReply({ content: '❌ Reset cancelado.', components: [] });
                    return;
                }

                const { executeReset } = require('../commands/pot/reset');
                const result = await executeReset(guildId, scope);
                await interaction.editReply({
                    content: `${result.success ? '✅' : '❌'} ${result.message}`,
                    components: []
                });
                return;
            }

            // ==================== PATH OF TITANS - PAINEL DE WEBHOOKS ====================
            // Customid: pot_webhook:<action>:<event|_>:<guildId>:<page>
            // ':' como separador (não '_') porque eventos como "admin_command"
            // têm underscore no próprio nome — '_' como separador quebrava o parsing.
            if (interaction.customId?.startsWith('pot_webhook:')) {
                const [, action, eventRaw, guildId, pageRaw] = interaction.customId.split(':');
                const event = eventRaw === '_' ? null : eventRaw;
                const page = parseInt(pageRaw) || 0;

                if (guildId !== interaction.guildId) {
                    await interaction.reply({ content: '❌ Este painel não pertence a este servidor.', flags: 64 });
                    return;
                }

                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferReply({ flags: 64 });
                }

                const PoTWebhookSystem = require('../systems/potWebhookSystem');

                switch (action) {
                    case 'create':
                        await PoTWebhookSystem.handleCreate(interaction, event, guildId, page);
                        break;
                    case 'test':
                        await PoTWebhookSystem.handleTest(interaction, event, guildId, page);
                        break;
                    case 'remove':
                        await PoTWebhookSystem.handleRemove(interaction, event, guildId, page);
                        break;
                    case 'logchan':
                        await PoTWebhookSystem.handleCreateLogChannel(interaction, event, guildId, page);
                        break;
                    case 'gameini':
                        await PoTWebhookSystem.handleGameIni(interaction);
                        break;
                    case 'channels':
                        await PoTWebhookSystem.handleShowChannels(interaction);
                        break;
                    case 'page':
                        await PoTWebhookSystem.renderPanel(interaction, page);
                        break;
                    default:
                        await interaction.editReply({ content: '❌ Ação desconhecida.', components: [] });
                }
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