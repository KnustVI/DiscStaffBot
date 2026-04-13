// src/events/interactionCreate.js
const InteractionHandler = require('../systems/handlers');
const ReportChatSystem = require('../systems/reportChatSystem');

let handler = null;
let reportSystem = null;

// Cache SIMPLES para modais do reportchat (não interfere com sessionManager)
const reportModalCache = new Map();

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (!handler) handler = new InteractionHandler(client);
        if (!reportSystem) reportSystem = new ReportChatSystem(client);
        
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
            
            // ==================== BOTÃO: ABRIR PAINEL ====================
            if (interaction.customId === 'reportchat:create') {
                const modal = reportSystem.getOpenModal();
                await interaction.showModal(modal);
                return;
            }
            
            // ==================== BOTÃO: ABRIR REPORT (do painel) ====================
            if (interaction.customId === 'open_report') {
                const modal = reportSystem.getOpenModal();
                await interaction.showModal(modal);
                return;
            }
            
            // ==================== BOTÃO: ENTRAR NA THREAD ====================
            if (interaction.customId?.startsWith('join_')) {
                await interaction.deferUpdate();
                const reportId = interaction.customId.replace('join_', '');
                await reportSystem.joinThread(interaction, reportId);
                return;
            }
            
            // ==================== BOTÃO: FECHAR REPORT ====================
            if (interaction.customId?.startsWith('close_')) {
                const reportId = interaction.customId.replace('close_', '');
                
                // Verificar se é staff (se tiver guild)
                let isStaff = false;
                if (interaction.guildId && interaction.member) {
                    const ConfigSystem = require('../systems/configSystem');
                    const staffRoleId = ConfigSystem.getSetting(interaction.guildId, 'staff_role');
                    isStaff = staffRoleId && interaction.member.roles?.cache?.has(staffRoleId);
                }
                
                // Se for staff ou for DM (usuário fechando), pode fechar
                if (isStaff || !interaction.guildId) {
                    await interaction.deferUpdate();
                    await reportSystem.closeReport(interaction, reportId, null, null);
                } else {
                    // Usuário na thread: abrir modal para motivo
                    reportModalCache.set(interaction.user.id, { reportId, type: 'close' });
                    const modal = reportSystem.getCloseModal();
                    await interaction.showModal(modal);
                }
                return;
            }
            
            // ==================== BOTÃO: AVALIAR ====================
            if (interaction.customId?.startsWith('rate_')) {
                const reportId = interaction.customId.replace('rate_', '');
                reportModalCache.set(interaction.user.id, { reportId, type: 'rate' });
                const modal = reportSystem.getRatingModal();
                await interaction.showModal(modal);
                return;
            }
            
            // ==================== MODAL: ABRIR REPORT ====================
            if (interaction.customId === 'report_modal') {
                const data = {
                    seuNick: interaction.fields.getTextInputValue('seu_nick'),
                    alvoNick: interaction.fields.getTextInputValue('alvo_nick'),
                    dataHora: interaction.fields.getTextInputValue('data_hora'),
                    regra: interaction.fields.getTextInputValue('regra'),
                    descricao: interaction.fields.getTextInputValue('descricao')
                };
                await reportSystem.openReport(interaction, data);
                return;
            }
            
            // ==================== MODAL: FECHAR ====================
            if (interaction.customId === 'close_modal') {
                await interaction.deferReply({ flags: 64 });
                const cached = reportModalCache.get(interaction.user.id);
                if (cached && cached.type === 'close') {
                    const motivo = interaction.fields.getTextInputValue('motivo');
                    const punicao = interaction.fields.getTextInputValue('punicao');
                    await reportSystem.closeReport(interaction, cached.reportId, motivo, punicao);
                    reportModalCache.delete(interaction.user.id);
                }
                return;
            }
            
            // ==================== MODAL: AVALIAR ====================
            if (interaction.customId === 'rating_modal') {
                await interaction.deferReply({ flags: 64 });
                const cached = reportModalCache.get(interaction.user.id);
                if (cached && cached.type === 'rate') {
                    const nota = parseInt(interaction.fields.getTextInputValue('nota'));
                    const comentario = interaction.fields.getTextInputValue('comentario');
                    await reportSystem.rateReport(interaction, cached.reportId, nota, comentario);
                    reportModalCache.delete(interaction.user.id);
                }
                return;
            }
            
            // ==================== OUTROS COMPONENTES ====================
            // Deixar o handler cuidar dos outros sistemas (punições, strikes, etc)
            if (interaction.isButton() || interaction.isStringSelectMenu() || 
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