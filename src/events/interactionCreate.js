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
            // Os botões têm collector próprio em PaginationBuilder.start().
            // NÃO interceptar aqui ou causa "Unknown interaction" (10062).
            if (interaction.customId?.startsWith('pag_')) {
                return;
            }

            // ==================== REPORTCHAT - ABRIR MODAL ====================
            if (interaction.customId === 'open_report') {
                const reportSystem = new ReportChatSystem(client);
                await interaction.showModal(reportSystem.getOpenModal());
                return;
            }

            // ==================== BOTÕES NA DM (COM GUILD_ID) ====================

            if (interaction.customId?.startsWith('close_reason:')) {
                const parts = interaction.customId.split(':');
                const guildId = parts[1];
                const reportNumber = parseInt(parts[2]);

                sessionManager.set(interaction.user.id, safeGuildId, 'closing', 'closing', {
                    reportNumber, guildId, reportId: `#R${reportNumber}`
                }, 300000);

                let isStaff = false;
                if (guildId) {
                    const guild = client.guilds.cache.get(guildId);
                    if (guild) {
                        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
                        const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
                        isStaff = member?.roles?.cache?.has(staffRoleId);
                    }
                }

                const reportSystem = new ReportChatSystem(client);
                const modal = isStaff ? reportSystem.getCloseModalStaff() : reportSystem.getCloseModalUser();
                await interaction.showModal(modal);
                return;
            }

            if (interaction.customId?.startsWith('rate:')) {
                const parts = interaction.customId.split(':');
                const guildId = parts[1];
                const reportNumber = parseInt(parts[2]);

                sessionManager.set(interaction.user.id, safeGuildId, 'rating', 'rating', {
                    reportNumber, guildId, reportId: `#R${reportNumber}`
                }, 300000);

                const reportSystem = new ReportChatSystem(client);
                await interaction.showModal(reportSystem.getRatingModal());
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

            // ==================== REPORTCHAT - AÇÕES ====================
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
                await reportSystem.openReport(interaction, {
                    regra: interaction.fields.getTextInputValue('regra'),
                    dataHora: interaction.fields.getTextInputValue('data_hora'),
                    local: interaction.fields.getTextInputValue('local'),
                    descricao: interaction.fields.getTextInputValue('descricao'),
                    termo: interaction.fields.getTextInputValue('termo')
                });
                return;
            }

            if (interaction.customId === 'close_modal_staff') {
                await interaction.deferReply({ flags: 64 });
                const session = sessionManager.get(interaction.user.id, safeGuildId, 'closing', 'closing');
                if (session?.reportNumber && session?.guildId) {
                    const reportSystem = new ReportChatSystem(client);
                    await reportSystem.closeReport(
                        interaction, session.reportNumber,
                        interaction.fields.getTextInputValue('motivo'),
                        interaction.fields.getTextInputValue('punicao'),
                        true, session.guildId
                    );
                    sessionManager.delete(interaction.user.id, safeGuildId, 'closing', 'closing');
                }
                return;
            }

            if (interaction.customId === 'close_modal_user') {
                await interaction.deferReply({ flags: 64 });
                const session = sessionManager.get(interaction.user.id, safeGuildId, 'closing', 'closing');
                if (session?.reportNumber && session?.guildId) {
                    const reportSystem = new ReportChatSystem(client);
                    await reportSystem.closeReport(
                        interaction, session.reportNumber,
                        interaction.fields.getTextInputValue('motivo'),
                        null, true, session.guildId
                    );
                    sessionManager.delete(interaction.user.id, safeGuildId, 'closing', 'closing');
                }
                return;
            }

            if (interaction.customId === 'rating_modal') {
                await interaction.deferReply({ flags: 64 });
                const session = sessionManager.get(interaction.user.id, safeGuildId, 'rating', 'rating');
                if (session?.reportNumber && session?.guildId) {
                    const reportSystem = new ReportChatSystem(client);
                    await reportSystem.rateReport(
                        interaction, session.reportNumber,
                        parseInt(interaction.fields.getTextInputValue('nota')),
                        interaction.fields.getTextInputValue('comentario'),
                        session.guildId
                    );
                    sessionManager.delete(interaction.user.id, safeGuildId, 'rating', 'rating');
                }
                return;
            }

            // ==================== CONFIGURAÇÕES ====================

            if (interaction.customId === 'config-punishments:strike:modal') { await ConfigSystem.handleStrikeModal(interaction); return; }
            if (interaction.customId === 'config-punishments:limites:modal') { await ConfigSystem.handleLimitesModal(interaction); return; }
            if (interaction.customId === 'config-punishments:reset') { await ConfigSystem.resetPoints(interaction); return; }
            if (interaction.customId === 'config-roles:staff') { await ConfigSystem.setRole(interaction, 'staff_role'); return; }
            if (interaction.customId === 'config-roles:strike') { await ConfigSystem.setRole(interaction, 'strike_role'); return; }
            if (interaction.customId === 'config-roles:exemplar') { await ConfigSystem.setRole(interaction, 'role_exemplar'); return; }
            if (interaction.customId === 'config-roles:problematico') { await ConfigSystem.setRole(interaction, 'role_problematico'); return; }
            if (interaction.customId === 'config-logs:geral') { await ConfigSystem.setLogChannel(interaction, 'log_channel'); return; }
            if (interaction.customId === 'config-logs:punishments') { await ConfigSystem.setLogChannel(interaction, 'log_punishments'); return; }
            if (interaction.customId === 'config-logs:automod') { await ConfigSystem.setLogChannel(interaction, 'log_automod'); return; }
            if (interaction.customId === 'config-logs:reports') { await ConfigSystem.setLogChannel(interaction, 'log_reports'); return; }
            if (interaction.customId === 'config-logs:criar') { await ConfigSystem.createLogChannels(interaction); return; }
            if (interaction.customId === 'config-punishments:strike:modal:submit') { await ConfigSystem.processPointsStrikeModal(interaction); return; }
            if (interaction.customId === 'config-punishments:limites:modal:submit') { await ConfigSystem.processLimitesModal(interaction); return; }

            // ==================== PATH OF TITANS - RESET ====================

            if (interaction.customId?.startsWith('pot_reset_')) {
                const parts = interaction.customId.split('_');
                const action = parts[2];
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

            // ==================== PATH OF TITANS - MODAL DE URL DE WEBHOOK ====================
            // Tratado ANTES do bloco genérico de modais abaixo.

            if (interaction.isModalSubmit() && interaction.customId.startsWith('pot_webhook:url_modal:')) {
                const PoTWebhookSystem = require('../systems/potWebhookSystem');
                await PoTWebhookSystem.handleUrlModalSubmit(interaction);
                return;
            }

            // ==================== PATH OF TITANS - PAINEL DE WEBHOOKS ====================

            if (interaction.customId?.startsWith('pot_webhook:')) {
                const [, action, groupId, guildId, pageRaw] = interaction.customId.split(':');
                const page = parseInt(pageRaw) || 0;

                if (guildId !== interaction.guildId) {
                    await interaction.reply({ content: '❌ Este painel não pertence a este servidor.', flags: 64 });
                    return;
                }

                const PoTWebhookSystem = require('../systems/potWebhookSystem');

                // 'config' abre modal — deve ser a PRIMEIRA resposta, sem deferral antes.
                if (action === 'config') {
                    await PoTWebhookSystem.handleShowConfigModal(interaction, groupId, guildId, page);
                    return;
                }

                const opensNewMessage = action === 'gameini' || action === 'webhooks';

                if (!interaction.deferred && !interaction.replied) {
                    if (opensNewMessage) {
                        await interaction.deferReply({ flags: 64 });
                    } else {
                        await interaction.deferUpdate();
                    }
                }

                switch (action) {
                    case 'test':
                        await PoTWebhookSystem.handleTest(interaction, groupId, guildId, page);
                        break;
                    case 'remove':
                        await PoTWebhookSystem.handleRemove(interaction, groupId, guildId, page);
                        break;
                    case 'gameini':
                        await PoTWebhookSystem.handleGameIni(interaction);
                        break;
                    case 'webhooks':
                        await PoTWebhookSystem.handleShowWebhooks(interaction);
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