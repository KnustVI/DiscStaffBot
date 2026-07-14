// /home/ubuntu/DiscStaffBot/src/events/interactionCreate.js
const InteractionHandler = require('../systems/core/handlers');
const ReportChatSystem = require('../systems/moderation/reportChatSystem');
const ConfigSystem = require('../systems/core/configSystem');
const sessionManager = require('../utils/sessionManager');
const { AdvancedContainerBuilder, COLORS } = require('../utils/containerBuilder');

let EMOJIS = {};
try {
    EMOJIS = require('../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

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

            // ==================== REVISÃO DE PUNIÇÃO - ABRIR MODAL ====================
            if (interaction.customId === 'review_punishment') {
                const reportSystem = new ReportChatSystem(client);
                await interaction.showModal(reportSystem.getReviewModal());
                return;
            }

            // ==================== CADASTRO DE JOGADOR - ABRIR MODAL ====================
            if (interaction.customId === 'player_register:open') {
                const PlayerRegistrationSystem = require('../systems/pot/playerRegistrationSystem');
                const playerRegistration = new PlayerRegistrationSystem(client);
                await playerRegistration.handleOpenModal(interaction);
                return;
            }

            // ==================== CADASTRO DE JOGADOR - CONFIRMAR CÓDIGO (ABRIR MODAL) ====================
            if (interaction.customId === 'player_register:confirm_code') {
                const PlayerRegistrationSystem = require('../systems/pot/playerRegistrationSystem');
                const playerRegistration = new PlayerRegistrationSystem(client);
                await playerRegistration.handleConfirmCodeButton(interaction);
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

                // ── A pergunta de punição só deve aparecer no modal de
                // fechamento da STAFF (painel em logs-reports). O botão é
                // idêntico na DM do usuário, mas lá o clique acontece fora de
                // um servidor (interaction.guildId nulo), então usamos isso
                // — e não o cargo do clicante — para decidir o modal. ──────
                const isStaffPanel = Boolean(interaction.guildId);

                const reportSystem = new ReportChatSystem(client);
                const modal = isStaffPanel ? reportSystem.getCloseModalStaff() : reportSystem.getCloseModalUser();
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

                // ── Precisa deferir ANTES do closeReport, que faz várias
                // chamadas assíncronas (DB, fetch de canal/thread, edição de
                // mensagens) que facilmente estouram os 3s de ack do Discord.
                // Sem isso, sendTempReply() tenta reply() numa interação
                // expirada e lança "Unknown interaction" (10062). Mesmo padrão
                // usado pelos modais close_modal_staff/close_modal_user. ──────
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferReply({ flags: 64 });
                }

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
                    personagem: interaction.fields.getTextInputValue('personagem'),
                    descricao: interaction.fields.getTextInputValue('descricao')
                });
                return;
            }

            if (interaction.customId === 'review_modal') {
                await interaction.deferReply({ flags: 64 });
                const reportSystem = new ReportChatSystem(client);
                await reportSystem.openPunishmentReview(interaction, interaction.fields.getTextInputValue('strike_number'));
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

            if (interaction.customId === 'player_register_modal') {
                await interaction.deferReply({ flags: 64 });
                const PlayerRegistrationSystem = require('../systems/pot/playerRegistrationSystem');
                const playerRegistration = new PlayerRegistrationSystem(client);
                await playerRegistration.handleModalSubmit(interaction);
                return;
            }

            if (interaction.customId === 'player_register_verify_modal') {
                await interaction.deferReply({ flags: 64 });
                const PlayerRegistrationSystem = require('../systems/pot/playerRegistrationSystem');
                const playerRegistration = new PlayerRegistrationSystem(client);
                await playerRegistration.handleVerifyCodeSubmit(interaction);
                return;
            }

            // ==================== CONFIGURAÇÕES ====================

            if (interaction.customId === 'config-punishments:level:create:modal') { await ConfigSystem.handleCreateLevelModal(interaction); return; }
            if (interaction.customId?.startsWith('config-punishments:level:edit:modal:') && !interaction.customId.startsWith('config-punishments:level:edit:modal:submit:')) {
                const levelId = interaction.customId.split(':')[4];
                await ConfigSystem.handleEditLevelModal(interaction, levelId);
                return;
            }
            if (interaction.customId === 'config-punishments:limites:modal') { await ConfigSystem.handleLimitesModal(interaction); return; }
            // ✅ BUG corrigido: faltava este special-case — sem ele, o botão
            // "Editar Recuperação Diária" caía no fluxo genérico de baixo
            // (deferUpdate() automático pra qualquer botão, antes de chamar
            // handleComponent), e showModal() SEMPRE falha depois de um
            // deferUpdate() (a interação já foi "respondida"). O botão
            // ficava com "essa interação falhou" sem nunca abrir o modal.
            if (interaction.customId === 'config-punishments:recovery:modal') { await ConfigSystem.handleRecoveryModal(interaction); return; }
            if (interaction.customId === 'config-punishments:reset') { await ConfigSystem.resetPoints(interaction); return; }
            if (interaction.customId === 'config-roles:staff') { await ConfigSystem.setRoles(interaction, 'staff_role'); return; }
            if (interaction.customId === 'config-roles:strike') { await ConfigSystem.setRoles(interaction, 'strike_role'); return; }
            if (interaction.customId === 'config-roles:exemplar') { await ConfigSystem.setRoles(interaction, 'role_exemplar'); return; }
            if (interaction.customId === 'config-roles:problematico') { await ConfigSystem.setRoles(interaction, 'role_problematico'); return; }
            if (interaction.customId === 'config-logs:geral') { await ConfigSystem.setLogChannel(interaction, 'log_channel'); return; }
            if (interaction.customId === 'config-logs:punishments') { await ConfigSystem.setLogChannel(interaction, 'log_punishments'); return; }
            if (interaction.customId === 'config-logs:automod') { await ConfigSystem.setLogChannel(interaction, 'log_automod'); return; }
            if (interaction.customId === 'config-logs:reports') { await ConfigSystem.setLogChannel(interaction, 'log_reports'); return; }
            if (interaction.customId === 'config-logs:staff') { await ConfigSystem.setLogChannel(interaction, 'log_staff'); return; }
            if (interaction.customId === 'config-logs:criar') { await ConfigSystem.confirmCreateLogChannels(interaction); return; }
            if (interaction.customId === 'config-punishments:limites:modal:submit') { await ConfigSystem.processLimitesModal(interaction); return; }
            if (interaction.customId === 'config-personalizar:reportchat-message:modal') { await ConfigSystem.handleReportChatMessageModal(interaction); return; }
            if (interaction.customId === 'config-personalizar:aparencia-color:modal') { await ConfigSystem.handlePanelColorModal(interaction); return; }
            if (interaction.customId === 'config-personalizar:aparencia-footer:modal') { await ConfigSystem.handlePanelFooterModal(interaction); return; }

            // ==================== PATH OF TITANS - RESET ====================

            if (interaction.customId?.startsWith('pot_reset_')) {
                const parts = interaction.customId.split('_');
                const action = parts[2];
                const guildId = parts[3];
                const userId = parts[4];
                const scope = parts.slice(5).join('_');

                if (interaction.user.id !== userId) {
                    await interaction.reply({ content: `${EMOJIS.circlealert || '❌'} Apenas quem iniciou o reset pode confirmar.`, flags: 64 });
                    return;
                }

                await interaction.deferUpdate();

                // A mensagem original (confirmação de reset) é Components V2 —
                // deferUpdate() mantém essa flag, e o Discord rejeita `content`
                // em qualquer edição dela (erro 50035 "MESSAGE_CANNOT_USE_
                // LEGACY_FIELDS_WITH_COMPONENTS_V2"). Por isso o resultado
                // também precisa ser montado como container, não como content.
                if (action === 'cancel') {
                    const cancelBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                        .text(`${EMOJIS.circlealert || '❌'} Reset cancelado.`)
                        .footer(interaction.guild?.name);
                    await interaction.editReply(cancelBuilder.build());
                    return;
                }

                const { executeReset } = require('../commands/pot/reset');
                const result = await executeReset(guildId, scope);
                const resultBuilder = new AdvancedContainerBuilder({ accentColor: result.success ? COLORS.SUCCESS : COLORS.ERROR })
                    .text(`${result.success ? (EMOJIS.circlecheck || '✅') : (EMOJIS.circlealert || '❌')} ${result.message}`)
                    .footer(interaction.guild?.name);
                await interaction.editReply(resultBuilder.build());
                return;
            }

            // ==================== PATH OF TITANS - MODAL DE URL DE WEBHOOK ====================
            // Tratado ANTES do bloco genérico de modais abaixo.

            if (interaction.isModalSubmit() && interaction.customId.startsWith('pot_webhook:url_modal:')) {
                const PoTWebhookSystem = require('../systems/pot/potWebhookSystem');
                await PoTWebhookSystem.handleUrlModalSubmit(interaction);
                return;
            }

            // ==================== PATH OF TITANS - PAINEL DE WEBHOOKS ====================

            if (interaction.customId?.startsWith('pot_webhook:')) {
                const [, action, groupId, guildId, pageRaw] = interaction.customId.split(':');
                const page = parseInt(pageRaw) || 0;

                if (guildId !== interaction.guildId) {
                    await interaction.reply({ content: `${EMOJIS.circlealert || '❌'} Este painel não pertence a este servidor.`, flags: 64 });
                    return;
                }

                const PoTWebhookSystem = require('../systems/pot/potWebhookSystem');

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
                    default: {
                        // Mesmo motivo do bloco pot_reset acima: a mensagem do
                        // painel é Components V2, não aceita `content`.
                        const unknownBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                            .text(`${EMOJIS.circlealert || '❌'} Ação desconhecida.`)
                            .footer(interaction.guild?.name);
                        await interaction.editReply(unknownBuilder.build());
                    }
                }
                return;
            }

            // ==================== EVENTO - TELEPORTE (ABRIR MODAL) ====================
            // Especial-caseado ANTES do bloco genérico de botões abaixo pelo
            // mesmo motivo de config-punishments:recovery:modal acima:
            // showModal() só funciona como PRIMEIRA resposta, e o bloco
            // genérico já faz deferUpdate() antes de rotear qualquer botão.
            if (interaction.customId?.startsWith('event-tp:config-modal:')) {
                const EventTeleportSystem = require('../systems/events/eventTeleportSystem');
                await EventTeleportSystem.handleOpenConfigModal(interaction);
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
                // Sem isso, qualquer erro lançado DEPOIS de um deferReply/
                // deferUpdate (interaction já "deferred") não respondia nada
                // — a interação ficava "pensando..." pra sempre do lado do
                // usuário, mesmo o bot já tendo desistido internamente.
                const message = `${EMOJIS.circlealert || '❌'} Erro. Tente novamente.`;
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: message, flags: 64 });
                } else {
                    // followUp (mensagem NOVA) em vez de editReply: a mensagem
                    // original pode ser Components V2 (painéis do bot), que o
                    // Discord rejeita com "Invalid Form Body" se tentar
                    // sobrescrever com `content` — followUp nunca conflita com
                    // o formato da mensagem original.
                    await interaction.followUp({ content: message, flags: 64 });
                }
            } catch (err) {}
        }
    }
};