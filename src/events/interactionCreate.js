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
            // Os botões de paginação (`pag_<timestamp>_<userId>_prev_X`, `_next_X`, `_page_X`)
            // possuem seu próprio InteractionCollector criado em PaginationBuilder.start().
            // Esse collector já chama i.deferUpdate() e i.editReply() internamente.
            // Por isso, NÃO podemos interceptar/deferir esses customIds aqui,
            // ou a segunda tentativa de ack causa "Unknown interaction" (10062).
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
    
       // ==================== POT SERVER - WEBHOOK PANEL ====================
        // Só processa se for interação (botão/modal), NÃO comandos
        // E IGNORA botões de reset (pot_reset_*)
        if (interaction.customId?.startsWith('pot_') && !interaction.isCommand()) {
            
            // ============================================================
            // IMPORTANTE: IGNORAR botões de reset (eles são gerenciados pelo reset.js)
            // ============================================================
            if (interaction.customId?.startsWith('pot_reset_')) {
                return; // Deixa o reset.js lidar com isso
            }
            
            const PoTWebhookSystem = require('../systems/potWebhookSystem');
            
            try {
                const parts = interaction.customId.split('_');
                const action = parts[1];
                const eventOrAction = parts[2];
                const guildId = parts[3] || interaction.guildId;
                
                // Verifica se é para esta guild
                if (guildId !== interaction.guildId) {
                    await interaction.reply({ 
                        content: '❌ Este painel não pertence a este servidor.',
                        flags: 64 
                    });
                    return;
                }
                
                // Deferir a interação
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferReply({ flags: 64 });
                }
                
                // Verificar se é para gerar Game.ini
                if (action === 'gameini' && eventOrAction === 'generate') {
                    await PoTWebhookSystem.handleGameIni(interaction);
                    return;
                }
                
                // Se for ação de evento (create, test, remove)
                const eventName = action;
                const actionType = eventOrAction;
                
                if (['create', 'test', 'remove'].includes(actionType)) {
                    switch(actionType) {
                        case 'create':
                            await PoTWebhookSystem.handleCreate(interaction, eventName);
                            break;
                        case 'test':
                            await PoTWebhookSystem.handleTest(interaction, eventName);
                            break;
                        case 'remove':
                            await PoTWebhookSystem.handleRemove(interaction, eventName);
                            break;
                        default:
                            await interaction.editReply({ 
                                content: '❌ Ação desconhecida.',
                                flags: 64 
                            });
                    }
                    return;
                }
                
                // Se chegou aqui, é um comando de página (paginação)
                // O PaginationBuilder já lida com isso, então ignoramos
                
            } catch (error) {
                console.error('❌ Erro no painel PoT:', error);
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ 
                            content: '❌ Erro ao processar ação. Tente novamente.',
                            flags: 64 
                        });
                    } else {
                        await interaction.editReply({ 
                            content: '❌ Erro ao processar ação. Tente novamente.',
                            flags: 64 
                        });
                    }
                } catch (err) {
                    console.error('❌ Erro ao responder interação:', err);
                }
            }
            return;
        }
        
    }
};