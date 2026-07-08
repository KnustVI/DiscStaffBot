// /home/ubuntu/DiscStaffBot/src/systems/moderation/reportChatSystem.js
const db = require('../../database/index');
const ConfigSystem = require('../core/configSystem');
const { 
    ChannelType, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    MessageFlags,
} = require('discord.js');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const PremiumSystem = require('../premium/premiumSystem');
const { buildIdentityBlock } = require('../../utils/userIdentity');

let EMOJIS = {};
try {
    const emojisFile = require('../../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

class ReportChatSystem {
    constructor(client) {
        this.client = client;
    }

    // ==================== LIMITES DE TIER (chats abertos + cooldown) ====================
    // Report e revisão de punição têm contadores SEPARADOS por tier (ver
    // PremiumSystem.GUILD_LIMITS.maxOpenReports/maxOpenReviews) — o cooldown
    // de abertura, esse sim, é combinado (conta a última abertura de
    // qualquer um dos dois tipos).

    countOpenChatsForUser(guildId, userId, type) {
        return db.prepare(`
            SELECT COUNT(*) AS c FROM reports
            WHERE guild_id = ? AND user_id = ? AND type = ? AND status NOT IN ('closed_no_reason', 'closed_with_reason')
        `).get(guildId, userId, type)?.c || 0;
    }

    getLastChatOpenedAt(guildId, userId) {
        return db.prepare(`
            SELECT MAX(created_at) AS ts FROM reports WHERE guild_id = ? AND user_id = ?
        `).get(guildId, userId)?.ts || null;
    }

    /**
     * Checa limite de chats abertos + cooldown pro tier do servidor. Retorna
     * null se pode abrir, ou uma string de erro pronta pra exibir se não.
     *
     * @param {string} type - 'report' ou 'punishment_review' (mesmos valores da coluna `reports.type`)
     */
    checkChatLimits(guildId, userId, type) {
        const limits = PremiumSystem.getGuildLimits(guildId);
        const maxAllowed = type === 'punishment_review' ? limits.maxOpenReviews : limits.maxOpenReports;
        const typeLabel = type === 'punishment_review' ? 'revisões de punição' : 'chats de reporte';

        const openCount = this.countOpenChatsForUser(guildId, userId, type);
        if (openCount >= maxAllowed) {
            return `${EMOJIS.circlealert || '❌'} Você já atingiu o limite de ${typeLabel} abertos para este servidor (${maxAllowed}). Feche um antes de abrir outro.`;
        }

        if (limits.chatCooldownMs > 0) {
            const lastOpenedAt = this.getLastChatOpenedAt(guildId, userId);
            if (lastOpenedAt && Date.now() - lastOpenedAt < limits.chatCooldownMs) {
                const retryAt = Math.floor((lastOpenedAt + limits.chatCooldownMs) / 1000);
                return `${EMOJIS.clockalert || '⏳'} Aguarde antes de abrir outro chat — disponível <t:${retryAt}:R>.`;
            }
        }

        return null;
    }

    getNextId(guildId) {
        const last = db.prepare(`
            SELECT report_number FROM reports 
            WHERE guild_id = ? 
            ORDER BY created_at DESC LIMIT 1
        `).get(guildId);
        
        if (!last) return 1;
        return last.report_number + 1;
    }

    getStatusText(status, closedBy = null, closedReason = null, closedAt = null) {
        const statusMap = {
            waiting: `${EMOJIS.clockalert || '⏳'} Aguardando staff`,
            responded: `${EMOJIS.messagecircle || '💬'} Respondido`,
            inactive: `${EMOJIS.trianglealert || '⚠️'} Inativo`,
            closed_no_reason: `${EMOJIS.lock || '🔒'} Fechado`,
            closed_with_reason: `${EMOJIS.circlecheck || '✅'} Concluído`
        };
        
        let baseStatus = statusMap[status] || status;
        
        if ((status === 'closed_no_reason' || status === 'closed_with_reason') && closedBy) {
            const closedTime = closedAt ? `<t:${Math.floor(closedAt / 1000)}:R>` : '';
            baseStatus = `${baseStatus} por ${closedBy} ${closedTime}`.trim();
        }
        
        return baseStatus;
    }

    // ==================== BASE CONTAINER ====================

    /**
     * Container compartilhado entre a DM do usuário e o painel de log da
     * staff — ambos são sempre EDITADOS (nunca recriados) a cada mudança de
     * status, para manter as duas cópias sincronizadas.
     *
     * options.audience controla o que difere entre as duas audiências:
     *  - 'dm'    → tem banner de topo; NUNCA mostra timestamps brutos.
     *  - 'staff' (padrão) → sem banner; mostra timestamp de entrada de cada
     *    staff, de fechamento e de atualização de status.
     *
     * Em ambas: o usuário que abriu o chat e o primeiro staff que entrou
     * ganham um card completo (seção + thumbnail); os demais presentes
     * aparecem só como menção simples.
     */
    createBaseContainer(guild, reportNumber, user, status = 'waiting', staffs = [], options = {}) {
        const audience = options.audience === 'dm' ? 'dm' : 'staff';
        const showTimestamps = audience === 'staff';

        // Buscar informações adicionais do report
        const reportInfo = db.prepare(`
            SELECT last_reply_by, last_reply_at, closed_by, closed_at, closed_reason, punishment,
                   rating, rating_comment, thread_id, type
            FROM reports
            WHERE guild_id = ? AND report_number = ?
        `).get(guild.id, reportNumber);

        const typeLabel = reportInfo?.type === 'punishment_review' ? 'REVISÃO DE PUNIÇÃO' : 'REPORTE';

        // Determinar a cor baseada no status — paleta única do bot (3 tons)
        let color;
        if (status === 'closed_no_reason' || status === 'closed_with_reason' || status === 'responded') {
            color = COLORS.SUCCESS;
        } else if (status === 'inactive') {
            color = COLORS.ERROR;
        } else {
            color = COLORS.DEFAULT;
        }

        const builder = new AdvancedContainerBuilder({ accentColor: color });
        if (audience === 'dm') builder.banner('title_report_chat');
        const reportIdDisplay = `#R${reportNumber}`;

        // ==================== 1. TÍTULO ====================
        // No painel da staff (logs-reports), o título leva o avatar do servidor.
        if (audience === 'staff') {
            builder.section(
                `## ${typeLabel} | ${reportIdDisplay}`,
                AdvancedContainerBuilder.thumbnail(guild.iconURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png'),
            );
        } else {
            builder.text(`## ${typeLabel} | ${reportIdDisplay}`);
        }
        builder.separator();

        // ==================== 2. CARD DO JOGADOR (quem abriu) ====================
        builder.section(
            `## JOGADOR\n${buildIdentityBlock(user)}`,
            AdvancedContainerBuilder.thumbnail(user.displayAvatarURL({ size: 128 })),
        );
        builder.separator();

        // ==================== 3. PRESENÇA: 1º staff com card, resto por menção ====================
        if (staffs && staffs.length > 0) {
            const [firstStaff, ...restStaffs] = staffs;
            const firstStaffUser = this.client.users.cache.get(firstStaff.id);
            const firstStaffJoinTime = showTimestamps && firstStaff.timestamp
                ? ` (entrou <t:${Math.floor(firstStaff.timestamp / 1000)}:R>)`
                : '';

            if (firstStaffUser) {
                const identityLines = buildIdentityBlock(firstStaffUser).split('\n');
                identityLines[0] += firstStaffJoinTime;
                builder.section(
                    `## STAFF RESPONSAVEL\n${identityLines.join('\n')}`,
                    AdvancedContainerBuilder.thumbnail(firstStaffUser.displayAvatarURL({ size: 128 })),
                );
            } else {
                builder.text(`## STAFF RESPONSAVEL\n<@${firstStaff.id}>${firstStaffJoinTime}`);
            }
            builder.separator();

            if (restStaffs.length > 0) {
                let restText = `### ${EMOJIS.users || '👥'} Demais presentes:\n`;
                for (const s of restStaffs) {
                    restText += showTimestamps
                        ? `<@${s.id}> (entrou <t:${Math.floor(s.timestamp / 1000)}:R>)\n`
                        : `<@${s.id}>\n`;
                }
                builder.text(restText);
                builder.separator();
            }
        }

        // ==================== 4. STATUS ====================
        let statusText = '';
        let closedByName = null;
        let closedAt = null;
        let closedReason = reportInfo?.closed_reason || null;
        let punishment = reportInfo?.punishment || null;

        if (reportInfo && reportInfo.closed_by) {
            try {
                const closedUser = this.client.users.cache.get(reportInfo.closed_by);
                closedByName = closedUser ? closedUser.toString() : `Usuário desconhecido`;
                closedAt = reportInfo.closed_at;
            } catch (err) {
                closedByName = `Usuário (${reportInfo.closed_by})`;
            }
        }

        const closedTime = showTimestamps && closedAt ? ` <t:${Math.floor(closedAt / 1000)}:R>` : '';

        if (status === 'closed_with_reason') {
            statusText = `### ${EMOJIS.gauge || '📊'} Status:\n${EMOJIS.circlecheck || '✅'} **Concluído por:** ${closedByName}${closedTime}\n${EMOJIS.trianglealert || '⚠️'} **Punição aplicada:** ${punishment || 'Nenhuma'}`;
        } else if (status === 'closed_no_reason') {
            statusText = `### ${EMOJIS.gauge || '📊'} Status:\n${EMOJIS.lock || '🔒'} **Fechado sem motivo por:** ${closedByName}${closedTime}`;
        } else if (status === 'waiting') {
            statusText = `### ${EMOJIS.gauge || '📊'} Status:\n${EMOJIS.clockalert || '⏳'} **Aguardando staff**`;
        } else if (status === 'responded') {
            const respondedTime = showTimestamps && reportInfo?.last_reply_at ? ` <t:${Math.floor(reportInfo.last_reply_at / 1000)}:R>` : '';
            statusText = `### ${EMOJIS.gauge || '📊'} Status:\n${EMOJIS.messagecircle || '💬'} **Respondido**${respondedTime}`;
        } else if (status === 'inactive') {
            statusText = `### ${EMOJIS.gauge || '📊'} Status:\n${EMOJIS.trianglealert || '⚠️'} **Inativo** (24h sem mensagens)`;
        }

        // Criar botão de link se existir thread
        if (reportInfo?.thread_id) {
            const threadLink = `https://discord.com/channels/${guild.id}/${reportInfo.thread_id}`;
            const linkButton = new ButtonBuilder()
                .setURL(threadLink)
                .setLabel('Ir para o chat')
                .setEmoji(EMOJIS.wifi || '🔗')
                .setStyle(ButtonStyle.Link);
            builder.section(statusText, linkButton);
        } else {
            builder.text(statusText);
        }
        builder.separator();

        // ==================== 5. MOTIVO ====================
        if (closedReason) {
            builder.text(`### ${EMOJIS.messagesquare || '📝'} Motivo:\n\`\`\`${closedReason}\`\`\``);
            builder.separator();
        }

        // ==================== 6. AVALIAÇÃO (sempre sem timestamp) ====================
        if (reportInfo?.rating && reportInfo.rating > 0) {
            const starEmoji = EMOJIS.starfull || '⭐';
            const stars = starEmoji.repeat(reportInfo.rating);
            let ratingText = `### ${starEmoji} Avaliação: ${reportInfo.rating}/5\n`;
            if (reportInfo.rating_comment) {
                ratingText += `\`\`\`${reportInfo.rating_comment}\`\`\`\n`;
            }
            ratingText += `${stars}`;
            builder.text(ratingText);
            builder.separator();
        }

        // ==================== 7. FOOTER ====================
        builder.footer(guild.name);

        return builder;
    }

    // ==================== MODAIS ====================

    getOpenModal() {
        const modal = new ModalBuilder().setCustomId('report_modal').setTitle('Abrir Report');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('regra').setLabel('Qual a regra quebrada?').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: Regra 5 - Flood')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('data_hora').setLabel('Quando aconteceu?').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: 09/04/2026 14:30')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('local').setLabel('Qual local do mapa?').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Ex: Floresta Central')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('descricao').setLabel('Descreva a quebra de regra').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Descreva detalhadamente...')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('termo').setLabel('Termo de boa convivência').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Declaro que as informações são verdadeiras...'))
        );
        return modal;
    }

    getCloseModalStaff() {
        const modal = new ModalBuilder().setCustomId('close_modal_staff').setTitle('Fechar Report (Staff)');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('motivo').setLabel('Qual motivo do fechamento?').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: Resolvido')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('punicao').setLabel('Punição aplicada (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Ex: Advertência, Strike, Ban'))
        );
        return modal;
    }

    getCloseModalUser() {
        const modal = new ModalBuilder().setCustomId('close_modal_user').setTitle('Fechar Report');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('motivo').setLabel('Qual motivo do fechamento?').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: Problema resolvido')));
        return modal;
    }

    getRatingModal() {
        const modal = new ModalBuilder().setCustomId('rating_modal').setTitle('Avaliar Atendimento');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nota').setLabel('Qual nota você dá para o atendimento? (1-5)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: 5')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('comentario').setLabel('Observação adicional?').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('Seu feedback...'))
        );
        return modal;
    }

    getReviewModal() {
        const modal = new ModalBuilder().setCustomId('review_modal').setTitle('Revisar Punição');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('strike_number').setLabel('Número do Strike a revisar').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: 15'))
        );
        return modal;
    }

    // ==================== PAINEL ====================

    getPanel(guildName, guildIcon, guildId) {
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });

        // Banner e mensagem são personalizáveis a partir do Caçador (ver
        // /config reportchat) — fora desse tier (ou sem nada configurado
        // ainda), cai sempre no padrão do bot. A checagem de tier acontece
        // AQUI (na leitura), não só na escrita: se o servidor perder o
        // Caçador, volta pro padrão sozinho, sem precisar resetar nada.
        const isCustomizable = guildId && PremiumSystem.isGuildAtLeast(guildId, 'cacador');
        const bannerKey = (isCustomizable && ConfigSystem.getSetting(guildId, 'report_chat_banner_key')) || 'title_report_chat';
        const customMessage = isCustomizable ? ConfigSystem.getSetting(guildId, 'report_chat_message') : null;

        builder.banner(bannerKey);
        builder.text(`## ${EMOJIS.ticket || '🎫'} Denúncia de jogador`);
        builder.text(customMessage || [
            `- **Abra um Reporte**: Clique no botão abaixo para abrir uma denúncia.`,
            `- **Preencha o Formulário**: Responda o formulário enviado pelo bot.`,
            `- **Descreva a Situação**: Explique o que aconteceu.`,
            `- **Envie as Provas**: Inclua vídeos ou prints.`,
            `- **Aguarde a Análise**: A equipe analisará o caso.`,
            ``,
            `- **Revisar uma Punição**: Recebeu um strike e quer contestar? Use o botão "Revisar Punição" e informe o número do strike.`,
        ].join('\n'));
        builder.footer(guildName);

        // Botões do painel usando ButtonBuilder
        const reportButton = new ButtonBuilder()
            .setCustomId('open_report')
            .setLabel('Reportar Jogador')
            .setStyle(ButtonStyle.Primary)
            .setEmoji(EMOJIS.ticket || '🎫');

        const reviewButton = new ButtonBuilder()
            .setCustomId('review_punishment')
            .setLabel('Revisar Punição')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(EMOJIS.gavel || '⚖️');

        const { components, flags, files } = builder.build();

        // Container + botões separadamente
        return {
            components: [...components, new ActionRowBuilder().addComponents(reportButton, reviewButton)],
            flags: [flags],
            files
        };
    }

    // ==================== ABRIR REPORT ====================
    
    async openReport(interaction, data) {
        const { guild, user } = interaction;

        await interaction.editReply({
            content: `${EMOJIS.clockalert || '⏳'} Criando report...`,
            flags: [MessageFlags.Ephemeral]
        });

        try {
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
            if (!logChannelId) {
                await interaction.editReply({ content: `${EMOJIS.circlealert || '❌'} Canal de logs não configurado!`, flags: [MessageFlags.Ephemeral] });
                return;
            }

            const limitError = this.checkChatLimits(guild.id, user.id, 'report');
            if (limitError) {
                await interaction.editReply({ content: limitError, flags: [MessageFlags.Ephemeral] });
                return;
            }

            const reportNumber = this.getNextId(guild.id);
            const reportId = `#R${reportNumber}`;
            const threadName = `【${reportId}】report-${user.username}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
            
            const thread = await interaction.channel.threads.create({
                name: threadName,
                type: ChannelType.PrivateThread,
                invitable: false,
                reason: `Report de ${user.tag}`
            });
            await thread.members.add(user.id);

            // ==================== CONTAINER DA THREAD ====================
            const threadBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
            threadBuilder.banner('title_report_chat');
            threadBuilder.text(`## ${EMOJIS.ticket || '🗨️'} REPORTE | ${reportId}`);
            threadBuilder.text(`Obrigado por abrir o reporte. Um membro da staff irá te atender em breve.\n\nEnquanto aguarda, você pode adicionar mais informações ou provas neste chat.`);
            threadBuilder.footer(guild.name);

            const { components: threadComponents, flags: threadFlags, files: threadFiles } = threadBuilder.build();
            const threadMsg = await thread.send({
                components: threadComponents,
                flags: [threadFlags],
                files: threadFiles
            });

            // Insere o report ANTES de montar os painéis de DM/log: createBaseContainer
            // lê thread_id/type direto do banco, então sem isso os painéis iniciais
            // saem sem o botão "Ir para o chat" e (no caso de revisão) com o título errado.
            db.prepare(`
                INSERT INTO reports (guild_id, report_number, user_id, thread_id, thread_message_id, status, staffs, created_at, last_message_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(guild.id, reportNumber, user.id, thread.id, threadMsg.id, 'waiting', '[]', Date.now(), Date.now());

            // ==================== CONTAINER DE INFORMAÇÕES ====================
            const infoBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
            infoBuilder.title(`${EMOJIS.clipboardlist || '📋'} Informações do Report`, 1);
            infoBuilder.separator();
            infoBuilder.text(`**${EMOJIS.messagesquare || '📝'} Regra quebrada:** ${data.regra}`);
            infoBuilder.text(`**${EMOJIS.clock || '⏰'} Quando aconteceu:** ${data.dataHora}`);
            infoBuilder.text(`**${EMOJIS.mappin || '📍'} Local:** ${data.local || 'Não informado'}`);
            infoBuilder.text(`**${EMOJIS.descricao || '📋'} Descrição:** ${data.descricao}`);
            infoBuilder.text(`**${EMOJIS.gavel || '⚖️'} Termo de convivência:** ${data.termo}`);
            infoBuilder.footer(guild.name);
            
            const { components: infoComponents, flags: infoFlags } = infoBuilder.build();
            await thread.send({ 
                components: infoComponents, 
                flags: [infoFlags] 
            });

            // ==================== DM DO USUÁRIO ====================
            const dmBuilder = this.createBaseContainer(guild, reportNumber, user, 'waiting', [], { audience: 'dm' });

            const closeButton = new ButtonBuilder()
                .setCustomId(`close:${guild.id}:${reportNumber}`)
                .setLabel('Fechar')
                .setStyle(ButtonStyle.Danger);

            const closeReasonButton = new ButtonBuilder()
                .setCustomId(`close_reason:${guild.id}:${reportNumber}`)
                .setLabel('Fechar com Motivo')
                .setStyle(ButtonStyle.Primary);

            // Adicionar botões ao builder (usando o método buttons do AdvancedContainerBuilder)
            const { components: dmComponents, flags: dmFlags, files: dmFiles } = dmBuilder.build();
            const dmRow = new ActionRowBuilder().addComponents(closeButton, closeReasonButton);

            const dmMessage = await user.send({
                components: [...dmComponents, dmRow],
                flags: [dmFlags],
                files: dmFiles
            }).catch(() => null);

            // ==================== LOG DA STAFF ====================
            const logChannel = await guild.channels.fetch(logChannelId);
            const logBuilder = this.createBaseContainer(guild, reportNumber, user, 'waiting', []);
            
            const joinButton = new ButtonBuilder()
                .setCustomId(`join:${reportId}`)
                .setLabel('Entrar no Reporte')
                .setStyle(ButtonStyle.Success);
                
            const logCloseButton = new ButtonBuilder()
                .setCustomId(`close:${guild.id}:${reportNumber}`)
                .setLabel('Fechar')
                .setStyle(ButtonStyle.Danger);

            const logCloseReasonButton = new ButtonBuilder()
                .setCustomId(`close_reason:${guild.id}:${reportNumber}`)
                .setLabel('Fechar com Motivo')
                .setStyle(ButtonStyle.Primary);
            
            const { components: logComponents, flags: logFlags } = logBuilder.build();
            const logRow = new ActionRowBuilder().addComponents(joinButton, logCloseButton, logCloseReasonButton);
            
            const logMessage = await logChannel.send({
                components: [...logComponents, logRow],
                flags: [logFlags]
            });

            // ==================== ATUALIZAR IDS DAS MENSAGENS ====================
            db.prepare(`
                UPDATE reports SET log_message_id = ?, dm_message_id = ?
                WHERE guild_id = ? AND report_number = ?
            `).run(logMessage.id, dmMessage?.id || null, guild.id, reportNumber);

            await interaction.editReply({
                content: `${EMOJIS.circlecheck || '✅'} ${reportId} criado! ${thread.url}`,
                flags: [MessageFlags.Ephemeral]
            });

        } catch (error) {
            console.error('❌ Erro ao criar report:', error);
            await interaction.editReply({ content: `${EMOJIS.circlealert || '❌'} Erro ao criar report.`, flags: [MessageFlags.Ephemeral] });
        }
    }

    // ==================== REVISAR PUNIÇÃO ====================

    /**
     * Abre uma "Revisão de Punição" — mesma infraestrutura do ReportChat
     * (thread privada, DM, painel de log, fechar/entrar/status), mudando
     * apenas como o chat é aberto (pede o número do strike em vez do
     * formulário de denúncia) e a mensagem inicial da thread (resumo da
     * punição em vez de regra/data/local/descrição).
     *
     * @param {import('discord.js').ModalSubmitInteraction} interaction
     * @param {string} strikeNumberRaw - Valor bruto digitado no modal
     */
    async openPunishmentReview(interaction, strikeNumberRaw) {
        const { guild, user } = interaction;

        await interaction.editReply({
            content: `${EMOJIS.clockalert || '⏳'} Abrindo revisão...`,
            flags: [MessageFlags.Ephemeral]
        });

        try {
            const strikeNumber = parseInt(String(strikeNumberRaw).replace(/[^\d]/g, ''));
            if (isNaN(strikeNumber)) {
                await interaction.editReply({ content: `${EMOJIS.circlealert || '❌'} Número de strike inválido.`, flags: [MessageFlags.Ephemeral] });
                return;
            }

            const punishment = db.prepare(`
                SELECT * FROM punishments WHERE guild_id = ? AND strike_number = ?
            `).get(guild.id, strikeNumber);
            if (!punishment) {
                await interaction.editReply({ content: `${EMOJIS.circlealert || '❌'} Punição #${strikeNumber} não encontrada.`, flags: [MessageFlags.Ephemeral] });
                return;
            }

            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
            if (!logChannelId) {
                await interaction.editReply({ content: `${EMOJIS.circlealert || '❌'} Canal de logs não configurado!`, flags: [MessageFlags.Ephemeral] });
                return;
            }

            const limitError = this.checkChatLimits(guild.id, user.id, 'punishment_review');
            if (limitError) {
                await interaction.editReply({ content: limitError, flags: [MessageFlags.Ephemeral] });
                return;
            }

            const reportNumber = this.getNextId(guild.id);
            const reportId = `#R${reportNumber}`;
            const threadName = `【${reportId}】revisao-strike-${strikeNumber}`.toLowerCase().replace(/[^a-z0-9]/g, '-');

            const thread = await interaction.channel.threads.create({
                name: threadName,
                type: ChannelType.PrivateThread,
                invitable: false,
                reason: `Revisão do strike #${strikeNumber} solicitada por ${user.tag}`
            });
            await thread.members.add(user.id);

            // ==================== CONTAINER DA THREAD ====================
            const threadBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
            threadBuilder.banner('title_report_chat');
            threadBuilder.text(`## ${EMOJIS.ticket || '🗨️'} REVISÃO DE PUNIÇÃO | ${reportId}`);
            threadBuilder.text(`Obrigado por solicitar a revisão. Um membro da staff irá analisar o caso em breve.\n\nEnquanto aguarda, você pode adicionar mais informações ou provas neste chat.`);
            threadBuilder.footer(guild.name);

            const { components: threadComponents, flags: threadFlags, files: threadFiles } = threadBuilder.build();
            const threadMsg = await thread.send({
                components: threadComponents,
                flags: [threadFlags],
                files: threadFiles
            });

            // Insere o report ANTES de montar os painéis de DM/log (mesmo motivo do openReport):
            // createBaseContainer lê thread_id/type direto do banco.
            db.prepare(`
                INSERT INTO reports (guild_id, report_number, type, punishment_id, user_id, thread_id, thread_message_id, status, staffs, created_at, last_message_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(guild.id, reportNumber, 'punishment_review', punishment.id, user.id, thread.id, threadMsg.id, 'waiting', '[]', Date.now(), Date.now());

            // ==================== RESUMO DA PUNIÇÃO ====================
            const PunishmentSystem = require('./punishmentSystem');
            const severityIcon = PunishmentSystem.severityIconFor({ levelSeverity: punishment.level_severity, severity: punishment.severity });
            const severityLabel = punishment.level_severity || (punishment.severity ? `Nível ${punishment.severity}` : 'Registro simples');
            const moderator = await this.client.users.fetch(punishment.moderator_id).catch(() => null);

            const summaryBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
            summaryBuilder.title(`${EMOJIS.gavel || '⚖️'} Resumo da Punição #${strikeNumber}`, 1);
            summaryBuilder.separator();
            summaryBuilder.text(`**${EMOJIS.calendar || '📅'} Data:** <t:${Math.floor(punishment.created_at / 1000)}:F>`);
            summaryBuilder.text(`**${EMOJIS.shield || '🛡️'} Moderador:** ${moderator ? moderator.toString() : `\`${punishment.moderator_id}\``}`);
            summaryBuilder.text(`${severityIcon} **Severidade:** ${severityLabel}`);
            if (PremiumSystem.getGuildLimits(guild.id).reputationEnabled) {
                summaryBuilder.text(`**${EMOJIS.doublearrowdown || '📉'} Pontos descontados:** -${punishment.points_deducted}`);
            }
            summaryBuilder.text(`**${EMOJIS.messagesquare || '📝'} Motivo:**\n\`\`\`text\n${punishment.reason}\n\`\`\``);
            if (punishment.report_id) summaryBuilder.text(`**${EMOJIS.ticket || '🎫'} Report original:** ${punishment.report_id}`);
            summaryBuilder.text(`**Status:** ${punishment.status === 'revoked' ? `${EMOJIS.circlecheck || '✅'} Já anulado` : `${EMOJIS.trianglealert || '⚠️'} Ativo`}`);
            summaryBuilder.footer(guild.name);

            const { components: summaryComponents, flags: summaryFlags } = summaryBuilder.build();
            await thread.send({
                components: summaryComponents,
                flags: [summaryFlags]
            });

            // ==================== DM DO USUÁRIO ====================
            const dmBuilder = this.createBaseContainer(guild, reportNumber, user, 'waiting', [], { audience: 'dm' });

            const closeButton = new ButtonBuilder()
                .setCustomId(`close:${guild.id}:${reportNumber}`)
                .setLabel('Fechar')
                .setStyle(ButtonStyle.Danger);

            const closeReasonButton = new ButtonBuilder()
                .setCustomId(`close_reason:${guild.id}:${reportNumber}`)
                .setLabel('Fechar com Motivo')
                .setStyle(ButtonStyle.Primary);

            const { components: dmComponents, flags: dmFlags, files: dmFiles } = dmBuilder.build();
            const dmRow = new ActionRowBuilder().addComponents(closeButton, closeReasonButton);

            const dmMessage = await user.send({
                components: [...dmComponents, dmRow],
                flags: [dmFlags],
                files: dmFiles
            }).catch(() => null);

            // ==================== LOG DA STAFF ====================
            const logChannel = await guild.channels.fetch(logChannelId);
            const logBuilder = this.createBaseContainer(guild, reportNumber, user, 'waiting', []);

            const joinButton = new ButtonBuilder()
                .setCustomId(`join:${reportId}`)
                .setLabel('Entrar no Reporte')
                .setStyle(ButtonStyle.Success);

            const logCloseButton = new ButtonBuilder()
                .setCustomId(`close:${guild.id}:${reportNumber}`)
                .setLabel('Fechar')
                .setStyle(ButtonStyle.Danger);

            const logCloseReasonButton = new ButtonBuilder()
                .setCustomId(`close_reason:${guild.id}:${reportNumber}`)
                .setLabel('Fechar com Motivo')
                .setStyle(ButtonStyle.Primary);

            const { components: logComponents, flags: logFlags } = logBuilder.build();
            const logRow = new ActionRowBuilder().addComponents(joinButton, logCloseButton, logCloseReasonButton);

            const logMessage = await logChannel.send({
                components: [...logComponents, logRow],
                flags: [logFlags]
            });

            // ==================== ATUALIZAR IDS DAS MENSAGENS ====================
            db.prepare(`
                UPDATE reports SET log_message_id = ?, dm_message_id = ?
                WHERE guild_id = ? AND report_number = ?
            `).run(logMessage.id, dmMessage?.id || null, guild.id, reportNumber);

            await interaction.editReply({
                content: `${EMOJIS.circlecheck || '✅'} ${reportId} criado! ${thread.url}`,
                flags: [MessageFlags.Ephemeral]
            });

        } catch (error) {
            console.error('❌ Erro ao criar revisão de punição:', error);
            await interaction.editReply({ content: `${EMOJIS.circlealert || '❌'} Erro ao criar revisão de punição.`, flags: [MessageFlags.Ephemeral] });
        }
    }
    
    // ==================== STAFF ENTRAR ====================
    
    async joinReport(interaction, reportId) {
        const { guild, user, member } = interaction;
        
        try {
            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            if (!member?.roles?.cache?.has(staffRoleId)) {
                await this.sendTempReply(interaction, `Você não tem permissão para entrar em reports.`, false);
                return;
            }

            const reportNumber = parseInt(reportId.replace('#R', ''));
            const report = db.prepare(`SELECT * FROM reports WHERE guild_id = ? AND report_number = ?`).get(guild.id, reportNumber);
            if (!report) {
                await this.sendTempReply(interaction, `Report ${reportId} não encontrado.`, false);
                return;
            }

            const thread = await guild.channels.fetch(report.thread_id);
            if (thread) await thread.members.add(user.id);

            let staffs = report.staffs ? JSON.parse(report.staffs) : [];
            const existingStaff = staffs.find(s => s.id === user.id);
            if (!existingStaff) {
                staffs.push({ id: user.id, name: user.tag, timestamp: Date.now() });
                db.prepare(`UPDATE reports SET staffs = ? WHERE guild_id = ? AND report_number = ?`).run(JSON.stringify(staffs), guild.id, reportNumber);
            }

            const targetUser = await this.client.users.fetch(report.user_id);
            
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
            if (logChannelId && report.log_message_id) {
                const logChannel = await guild.channels.fetch(logChannelId);
                const logMessage = await logChannel.messages.fetch(report.log_message_id);
                if (logMessage) {
                    const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, report.status, staffs);
                    
                    // Extrair componentes existentes (botões) que não são o container principal
                    const existingComponents = logMessage.components;
                    const buttonsToPreserve = existingComponents.slice(1);
                    
                    const { components: updatedComponents, flags: updatedFlags } = updatedBuilder.build();
                    await logMessage.edit({ 
                        components: [updatedComponents[0], ...buttonsToPreserve],
                        flags: [updatedFlags] 
                    });
                }
            }

            if (report.dm_message_id) {
                const dmMessage = await user.createDM().then(dm => dm.messages.fetch(report.dm_message_id)).catch(() => null);
                if (dmMessage) {
                    const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, report.status, staffs, { audience: 'dm' });
                    const existingComponents = dmMessage.components;
                    const buttonsToPreserve = existingComponents.slice(1);

                    const { components: updatedComponents, flags: updatedFlags, files: updatedFiles } = updatedBuilder.build();
                    await dmMessage.edit({
                        components: [updatedComponents[0], ...buttonsToPreserve],
                        flags: [updatedFlags],
                        files: updatedFiles
                    });
                }
            }

            await this.sendTempReply(interaction, `${user} entrou no ${reportId}`, true);
            
        } catch (error) {
            console.error('❌ Erro ao entrar:', error);
            await this.sendTempReply(interaction, `Erro ao entrar no report ${reportId}.`, false);
        }
    }

    // ==================== FECHAR REPORT ====================
    
    async closeReport(interaction, reportNumber, motivo, punicao, hasReason, guildId = null) {
        try {
            const targetGuildId = guildId || interaction.guildId;
            
            const report = db.prepare(`
                SELECT * FROM reports 
                WHERE guild_id = ? AND report_number = ?
            `).get(targetGuildId, reportNumber);
            
            if (!report) {
                const reportId = `#R${reportNumber}`;
                await this.sendTempReply(interaction, `Report ${reportId} não encontrado.`, false);
                return;
            }
            
            const reportId = `#R${reportNumber}`;
            const guild = this.client.guilds.cache.get(report.guild_id);
            
            if (!guild) {
                await this.sendTempReply(interaction, `Servidor do report ${reportId} não encontrado.`, false);
                return;
            }

            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            const isStaff = interaction.member?.roles?.cache?.has(staffRoleId);
            const closedByMention = interaction.user.toString();
            const status = hasReason ? 'closed_with_reason' : 'closed_no_reason';
            const closedAt = Date.now();

            db.prepare(`
                UPDATE reports 
                SET status = ?, closed_at = ?, closed_by = ?, closed_reason = ?, punishment = ? 
                WHERE guild_id = ? AND report_number = ?
            `).run(status, closedAt, interaction.user.id, motivo || null, punicao || null, guild.id, reportNumber);

            const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
            if (thread) {
                await thread.send({
                    content: `${EMOJIS.lock || '🔒'} Report fechado por ${closedByMention}`
                }).catch(() => {});
                await thread.setLocked(true).catch(() => {});
                await thread.setArchived(true).catch(() => {});
            }

            const staffs = report.staffs ? JSON.parse(report.staffs) : [];
            const targetUser = await this.client.users.fetch(report.user_id);
            
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
            if (logChannelId && report.log_message_id) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId);
                    const logMessage = await logChannel.messages.fetch(report.log_message_id);
                    if (logMessage) {
                        const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, status, staffs);
                        const { components: updatedComponents, flags: updatedFlags } = updatedBuilder.build();
                        await logMessage.edit({ 
                            components: updatedComponents, 
                            flags: [updatedFlags] 
                        });
                    }
                } catch (err) {}
            }

            if (report.dm_message_id) {
                try {
                    const dmMessage = await targetUser.createDM().then(dm => dm.messages.fetch(report.dm_message_id)).catch(() => null);
                    if (dmMessage) {
                        const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, status, staffs, { audience: 'dm' });

                        const rateButton = new ButtonBuilder()
                            .setCustomId(`rate:${guild.id}:${reportNumber}`)
                            .setLabel('Avaliar Atendimento')
                            .setStyle(ButtonStyle.Secondary);

                        const { components: updatedComponents, flags: updatedFlags, files: updatedFiles } = updatedBuilder.build();
                        const rateRow = new ActionRowBuilder().addComponents(rateButton);

                        await dmMessage.edit({
                            components: [...updatedComponents, rateRow],
                            flags: [updatedFlags],
                            files: updatedFiles
                        });
                    }
                } catch (err) {}
            }

            await this.sendTempReply(interaction, `${reportId} foi fechado por ${interaction.user}.`, true);

        } catch (error) {
            console.error('❌ Erro ao fechar:', error);
            await this.sendTempReply(interaction, `Erro ao fechar o report #${reportNumber}.`, false);
        }
    }

    // ==================== VÁLVULA DE SEGURANÇA (reports travados) ====================
    // Agora que o tier Free limita a 1 chat aberto por vez (ver checkChatLimits),
    // um report travado (thread apagada, painel quebrado, bot reiniciado no meio
    // do fluxo) bloquearia o usuário pra sempre — a função abaixo libera a vaga
    // automaticamente, independente do tier.

    /**
     * Libera automaticamente um report quando sua thread é apagada
     * (ver src/events/threadDelete.js) — sem isso, apagar a thread deixaria
     * o report "aberto" pra sempre no banco.
     */
    releaseReportByThreadId(threadId) {
        const report = db.prepare(`
            SELECT * FROM reports WHERE thread_id = ? AND status NOT IN ('closed_no_reason', 'closed_with_reason')
        `).get(threadId);
        if (!report) return null;

        db.prepare(`
            UPDATE reports SET status = 'closed_no_reason', closed_reason = ?, closed_at = ?
            WHERE guild_id = ? AND report_number = ?
        `).run('Thread excluída - liberado automaticamente', Date.now(), report.guild_id, report.report_number);

        this.updateStatus(report.guild_id, `#R${report.report_number}`, 'closed_no_reason').catch(() => {});

        return report;
    }

    async _tryArchiveThread(guildId, threadId) {
        if (!threadId) return;
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;
        const thread = await guild.channels.fetch(threadId).catch(() => null);
        if (!thread) return;
        await thread.setLocked(true).catch(() => {});
        await thread.setArchived(true).catch(() => {});
    }

    // ==================== AVALIAR ====================
    
    async rateReport(interaction, reportNumber, nota, comentario, guildId = null) {
        try {
            const targetGuildId = guildId || interaction.guildId;
            
            const report = db.prepare(`
                SELECT * FROM reports 
                WHERE guild_id = ? AND report_number = ? AND user_id = ?
            `).get(targetGuildId, reportNumber, interaction.user.id);
            
            if (!report) {
                const reportId = `#R${reportNumber}`;
                await this.sendTempReply(interaction, `Report ${reportId} não encontrado.`, false);
                return;
            }
            
            const reportId = `#R${reportNumber}`;
            
            if (report.rating) {
                await this.sendTempReply(interaction, `Este report já foi avaliado.`, false);
                return;
            }

            db.prepare(`
                UPDATE reports 
                SET rating = ?, rating_comment = ? 
                WHERE guild_id = ? AND report_number = ?
            `).run(nota, comentario, targetGuildId, reportNumber);

            const guild = this.client.guilds.cache.get(report.guild_id);
            const staffs = report.staffs ? JSON.parse(report.staffs) : [];
            const targetUser = await this.client.users.fetch(report.user_id);
            
            const logChannelId = ConfigSystem.getSetting(report.guild_id, 'log_reports');
            if (logChannelId && report.log_message_id && guild) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId);
                    const logMessage = await logChannel.messages.fetch(report.log_message_id);
                    if (logMessage) {
                        const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, report.status, staffs);
                        const { components: updatedComponents, flags: updatedFlags } = updatedBuilder.build();
                        await logMessage.edit({ 
                            components: updatedComponents, 
                            flags: [updatedFlags] 
                        });
                    }
                } catch (err) {}
            }

            await this.sendTempReply(interaction, `Avaliação registrada! Obrigado.`, true);
            
        } catch (error) {
            console.error('❌ Erro ao avaliar:', error);
            await this.sendTempReply(interaction, `Erro ao avaliar report #${reportNumber}.`, false);
        }
    }

    // ==================== RESPOSTA TEMPORÁRIA ====================
    
    async sendTempReply(interaction, content, success = true) {
        const emoji = success ? (EMOJIS.circlecheck || '✅') : (EMOJIS.circlealert || '❌');
        
        const replyOptions = { 
            content: `${emoji} ${content}`, 
            flags: [MessageFlags.Ephemeral]
        };
        
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply(replyOptions);
        } else {
            await interaction.reply(replyOptions);
        }
        
        setTimeout(async () => {
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.deleteReply();
                }
            } catch (err) {}
        }, 20000);
    }
    
    // ==================== ATUALIZAR STATUS ====================
    
    async updateStatus(guildId, reportId, newStatus) {
        const reportNumber = parseInt(reportId.replace('#R', ''));
        const report = db.prepare(`SELECT * FROM reports WHERE guild_id = ? AND report_number = ?`).get(guildId, reportNumber);
        if (!report) return;

        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;

        const staffs = report.staffs ? JSON.parse(report.staffs) : [];
        const targetUser = await this.client.users.fetch(report.user_id);
        
        const logChannelId = ConfigSystem.getSetting(guildId, 'log_reports');
        if (logChannelId && report.log_message_id) {
            const logChannel = await guild.channels.fetch(logChannelId);
            const logMessage = await logChannel.messages.fetch(report.log_message_id);
            if (logMessage) {
                const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, newStatus, staffs);
                const existingComponents = logMessage.components;
                const buttonsToPreserve = existingComponents.slice(1);
                
                const { components: updatedComponents, flags: updatedFlags } = updatedBuilder.build();
                await logMessage.edit({ 
                    components: [updatedComponents[0], ...buttonsToPreserve],
                    flags: [updatedFlags] 
                });
            }
        }

        if (report.dm_message_id) {
            const dmMessage = await targetUser.createDM().then(dm => dm.messages.fetch(report.dm_message_id)).catch(() => null);
            if (dmMessage) {
                const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, newStatus, staffs, { audience: 'dm' });
                const existingComponents = dmMessage.components;
                const buttonsToPreserve = existingComponents.slice(1);

                const { components: updatedComponents, flags: updatedFlags, files: updatedFiles } = updatedBuilder.build();
                await dmMessage.edit({
                    components: [updatedComponents[0], ...buttonsToPreserve],
                    flags: [updatedFlags],
                    files: updatedFiles
                });
            }
        }
    }
}

module.exports = ReportChatSystem;