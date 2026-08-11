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
    LabelBuilder,
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

    /**
     * Emoji por status do report, usado como prefixo do título nos painéis
     * (pedido do dono, 2026-08-09: "No titulo do REPORTE nos paineis
     * adicione um emoji antes do titulo, um emoji para cada status do
     * report") — mesmos emojis já associados a cada status na linha de
     * "Status:" abaixo do título (getStatusText/seção 4 de
     * createBaseContainer), reaproveitados aqui pra não introduzir um
     * segundo vocabulário visual pro mesmo conceito.
     */
    getStatusEmoji(status) {
        const emojiMap = {
            waiting: EMOJIS.clockalert || '⏳',
            responded: EMOJIS.messagecircle || '💬',
            inactive: EMOJIS.trianglealert || '⚠️',
            closed_no_reason: EMOJIS.lock || '🔒',
            closed_with_reason: EMOJIS.circlecheck || '✅',
        };
        return emojiMap[status] || (EMOJIS.ticket || '🎫');
    }

    /**
     * Bolinha de status no NOME do tópico. Reduzido a SÓ 2 estados (pedido
     * do dono, 2026-08-10: "Reportes não estão sendo fechados e o nome dos
     * tópicos esta sendo alterado com muita frequencia... vamos manter
     * apenas o nome de indicação aberto com icone verde e o de inativo
     * após 24 horas") — a versão original (⚫ inativo / 🟠 aguardando staff
     * / 🟢 respondido) renomeava o tópico em TODA mensagem trocada dentro
     * dele (ver messageCreate.js: staff responde -> 'responded', usuário
     * responde -> 'waiting' de novo, mesmo já tendo sido respondido antes)
     * — uma conversa normal de ida-e-volta estourava o rate limit do
     * Discord pra renomear canal (2 trocas/10min) em poucas mensagens.
     * Como setName/setLocked/setArchived (usado por closeReport) competem
     * pelo MESMO bucket de rate limit do canal, o spam de renomeação
     * também travava o fechamento do report — a causa provável do "não
     * estão sendo fechados" relatado junto. Unicode LITERAL de propósito,
     * não EMOJIS.* — nome de canal/tópico do Discord não interpreta emoji
     * de aplicação custom (<:nome:id>, o formato usado em texto de
     * mensagem/embed em todo o resto do bot), só emoji Unicode renderiza
     * ali. 'waiting'/'responded' (não usados mais pra nome de tópico,
     * `getStatusText`/`createBaseContainer` continuam usando o status real
     * pra cor/texto do painel — só o NOME do tópico parou de acompanhar
     * cada transição) ficam de referência só pra não quebrar nada que já
     * dependa do formato do objeto.
     */
    static THREAD_STATUS_DOT = {
        open: '🟢',
        waiting: '🟠',
        responded: '🟢',
        inactive: '⚫',
    };

    /**
     * Nome padronizado do tópico: "<bolinha> Rep<N> - <username>". Chamado
     * na criação (openReport/openPunishmentReview, sempre 'open' — verde,
     * ver THREAD_STATUS_DOT acima) e por updateStatus só quando o novo
     * status é 'inactive' — nenhuma outra transição renomeia mais o
     * tópico, pra não estourar o rate limit de renomear canal do Discord.
     */
    buildThreadName(reportNumber, username, status) {
        const dot = ReportChatSystem.THREAD_STATUS_DOT[status] || ReportChatSystem.THREAD_STATUS_DOT.open;
        return `${dot} Rep${reportNumber} - ${username}`;
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

        // Determinar a cor baseada no status — paleta única do bot (3 tons).
        // SUCCESS/ERROR continuam fixos (refletem o status em si) — só o
        // "ainda aberto/aguardando" (nem fechado nem inativo) usa a cor
        // personalizada do servidor no lugar do DEFAULT fixo, pedido do
        // dono 2026-08-10.
        let color;
        if (status === 'closed_no_reason' || status === 'closed_with_reason' || status === 'responded') {
            color = COLORS.SUCCESS;
        } else if (status === 'inactive') {
            color = COLORS.ERROR;
        } else {
            color = ConfigSystem.getPanelPersonalization(guild.id).accentColor ?? COLORS.DEFAULT;
        }

        const builder = new AdvancedContainerBuilder({ accentColor: color });
        if (audience === 'dm') builder.banner('title_report_chat');
        const reportIdDisplay = `#REP${reportNumber}`;

        // Painel da staff (logs-reports) SEM nenhuma thumbnail — de usuário
        // OU de servidor (pedido do dono, 2026-08-09: "remova todas as
        // thumbnails de usuário e do servidor, precisamos de um painel mais
        // limpo e mais fácil de ler") — e nome do usuário menor (mesmo
        // pedido, "no nome do usuários pode deixar eles menores", ver
        // buildIdentityBlock({ compact: true })). A DM do usuário não muda
        // em nada: mantém os thumbnails e o tamanho de nome de sempre.
        const compactPanel = audience === 'staff';
        const identityOptions = compactPanel ? { compact: true } : {};

        // ==================== 1. TÍTULO ====================
        // Emoji de status antes do título, nos dois painéis (pedido do
        // dono, 2026-08-09 — ver getStatusEmoji acima).
        builder.text(`## ${this.getStatusEmoji(status)} ${typeLabel} | ${reportIdDisplay}`);
        builder.separator();

        // Menção de cargo(s) — só quando o chamador passa
        // options.mentionRoleIds (hoje só openReport/openPunishmentReview,
        // na abertura — ver config-roles:report-mention). Até 3 cargos
        // (pedido do dono, 2026-08-11), todos mencionados juntos na mesma
        // linha. Nunca no audience 'dm'.
        if (audience === 'staff' && options.mentionRoleIds && options.mentionRoleIds.length > 0) {
            builder.text(`${EMOJIS.megaphone || '📢'} ${options.mentionRoleIds.map(id => `<@&${id}>`).join(' ')}`);
            builder.separator();
        }

        // ==================== 2. CARD DO JOGADOR (quem abriu) ====================
        if (compactPanel) {
            builder.text(`## JOGADOR\n${buildIdentityBlock(user, identityOptions)}`);
        } else {
            builder.section(
                `## JOGADOR\n${buildIdentityBlock(user)}`,
                AdvancedContainerBuilder.thumbnail(user.displayAvatarURL({ size: 128 })),
            );
        }
        builder.separator();

        // ==================== 3. PRESENÇA: 1º staff com card, resto por menção ====================
        if (staffs && staffs.length > 0) {
            const [firstStaff, ...restStaffs] = staffs;
            const firstStaffUser = this.client.users.cache.get(firstStaff.id);
            const firstStaffJoinTime = showTimestamps && firstStaff.timestamp
                ? ` (entrou <t:${Math.floor(firstStaff.timestamp / 1000)}:R>)`
                : '';

            if (firstStaffUser) {
                const identityLines = buildIdentityBlock(firstStaffUser, identityOptions).split('\n');
                identityLines[0] += firstStaffJoinTime;
                if (compactPanel) {
                    builder.text(`## STAFF RESPONSAVEL\n${identityLines.join('\n')}`);
                } else {
                    builder.section(
                        `## STAFF RESPONSAVEL\n${identityLines.join('\n')}`,
                        AdvancedContainerBuilder.thumbnail(firstStaffUser.displayAvatarURL({ size: 128 })),
                    );
                }
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
        // Footer customizado aplicado normalmente (ver /config personalizar,
        // aba "Aparência Geral") — a COR aqui NÃO é sobrescrita de propósito:
        // ela indica o STATUS do report (verde=fechado, vermelho=inativo,
        // padrão=aguardando/respondido), sinal útil pra staff escanear o
        // canal de log, diferente da cor fixa usada em /strike, /unstrike e
        // nos outros paineis de report-chat.
        builder.footer(guild);

        return builder;
    }

    // ==================== MODAIS ====================

    getOpenModal() {
        // Cada pergunta com sua própria descrição (LabelBuilder.setDescription(),
        // visível permanentemente abaixo da pergunta, diferente do placeholder
        // que some ao digitar). Campo "termo" (Termo de boa convivência)
        // REMOVIDO — substituído por "personagem" (opcional) nesta revisão.
        //
        // SEM TextDisplayComponent solto pro texto de intro geral (existia
        // antes) — Discord rejeita o modal com 400/50035 "Invalid Form Body"
        // quando o total de componentes no nível raiz passa de 5 (visto ao
        // vivo em produção: 1 TextDisplay + 5 Labels = 6, estourava o
        // limite). A orientação de "detalhe e anexe evidências" foi
        // incorporada na descrição do campo "descricao" abaixo, em vez de
        // virar um 6º componente.
        const modal = new ModalBuilder().setCustomId('report_modal').setTitle('Abrir Reporte ao jogador.');
        modal.addLabelComponents(
            new LabelBuilder()
                .setLabel('Qual a regra quebrada?')
                .setDescription('Nome ou numeração da regra.')
                .setTextInputComponent(new TextInputBuilder().setCustomId('regra').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: Regra 4 - Desrespeito em chat.')),
            new LabelBuilder()
                .setLabel('Quando aconteceu?')
                .setDescription('Diga o dia e horário para facilitar a busca nos logs.')
                .setTextInputComponent(new TextInputBuilder().setCustomId('data_hora').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: 04/04/2044 as 04:44')),
            new LabelBuilder()
                .setLabel('Qual local do mapa?')
                .setDescription('Dê o nome da POI ou as coordenadas (podem ser encontradas em logs).')
                .setTextInputComponent(new TextInputBuilder().setCustomId('local').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Ex: Hollow Hills - (X=15121,Y=198475,Z=3195)')),
            new LabelBuilder()
                .setLabel('Perdeu algum personagem?')
                .setDescription('Informe o nome ou ID do personagem para localizar os logs e verificar a devolução de growth.')
                .setTextInputComponent(new TextInputBuilder().setCustomId('personagem').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Ex: Krawler 8A306AE6A9F84DDA84F2EED839543128')),
            new LabelBuilder()
                .setLabel('Descreva a quebra de regra:')
                .setDescription('Descreva com o máximo de detalhes e anexe evidências, se possível, pra facilitar a análise.')
                .setTextInputComponent(new TextInputBuilder().setCustomId('descricao').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Ex: Ao caçar um herbívoro, outro herbívoro do mesmo grupo me matou por vingança.'))
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

    /**
     * Banner e mensagem de boas-vindas da THREAD, personalizáveis a partir
     * do Caçador (ver /config personalizar, aba "reportchat") — mesmo
     * critério de getPanel() logo abaixo: a checagem de tier acontece AQUI
     * na leitura, não só na escrita do painel de config. Se o servidor
     * perder o Caçador, a thread volta a usar o banner/mensagem padrão do
     * bot sozinha — o valor customizado continua salvo no banco (não é
     * apagado), então volta a valer automaticamente se o Caçador for
     * readquirido depois.
     */
    async _resolveThreadPersonalization(guildId) {
        const isCustomizable = guildId && PremiumSystem.isGuildAtLeast(guildId, 'cacador');
        const CustomBannerResolver = require('../../utils/customBannerResolver');
        return {
            banner: await CustomBannerResolver.resolveBanner(this.client, guildId, 'reportchat'),
            welcomeMessage: isCustomizable ? ConfigSystem.getSetting(guildId, 'report_chat_welcome_message') : null,
        };
    }

    async getPanel(guildName, guildIcon, guildId) {
        // Banner, mensagem, cor e footer são personalizáveis a partir do
        // Caçador (ver /config personalizar) — fora desse tier (ou sem nada
        // configurado ainda), cai sempre no padrão do bot. A checagem de
        // tier acontece AQUI (na leitura), não só na escrita: se o servidor
        // perder o Caçador, volta pro padrão sozinho, sem precisar resetar
        // nada. Banner pode ser a chave estática do bot, uma foto do pool
        // ou uma imagem própria enviada (ver customBannerResolver.js).
        const isCustomizable = guildId && PremiumSystem.isGuildAtLeast(guildId, 'cacador');
        const CustomBannerResolver = require('../../utils/customBannerResolver');
        const banner = await CustomBannerResolver.resolveBanner(this.client, guildId, 'reportchat');
        const customMessage = isCustomizable ? ConfigSystem.getSetting(guildId, 'report_chat_message') : null;
        const personalization = ConfigSystem.getPanelPersonalization(guildId);

        const builder = new AdvancedContainerBuilder({ accentColor: personalization.accentColor ?? COLORS.DEFAULT });
        if (banner.type === 'buffer') builder.bannerFromBuffer(banner.value);
        else builder.banner(banner.value);
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
        builder.footer({ id: guildId, name: guildName });

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
            // `reports` tem FOREIGN KEY em guild_id/user_id (ver schema.js) —
            // sem isso, quem abre um report como a PRIMEIRA interação dele
            // com o bot (usuário nunca visto em `users`, ou servidor cujo
            // `guilds` ainda não foi criado) derrubava o INSERT abaixo com
            // SQLITE_CONSTRAINT_FOREIGNKEY. Mesmo padrão já usado em
            // historico.js antes de qualquer INSERT/SELECT que dependa
            // dessas linhas existirem.
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

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
            const reportId = `#REP${reportNumber}`;
            // Pedido do dono, 2026-08-10 (ver THREAD_STATUS_DOT/buildThreadName
            // acima) — sempre 'open' (verde) na criação; só volta a mudar
            // se o report ficar inativo (updateStatus), nunca a cada mensagem.
            const threadName = this.buildThreadName(reportNumber, user.username, 'open');

            const thread = await interaction.channel.threads.create({
                name: threadName,
                type: ChannelType.PrivateThread,
                invitable: false,
                reason: `Report de ${user.tag}`
            });
            await thread.members.add(user.id);

            // Cor/footer customizados (aba "Aparência Geral" de /config
            // personalizar) — os containers abaixo usam cor FIXA (DEFAULT),
            // não uma cor com significado próprio (diferente de
            // createBaseContainer, que usa a cor pra indicar status
            // waiting/fechado/inativo — essa continua intacta).
            const personalization = ConfigSystem.getPanelPersonalization(guild.id);
            // Banner e mensagem de boas-vindas — mesmo banner escolhido pro
            // painel do canal, aplicado aqui também pra manter a mesma
            // identidade visual na thread (tier já checado dentro do
            // helper, ver _resolveThreadPersonalization acima).
            const { banner: threadBanner, welcomeMessage } = await this._resolveThreadPersonalization(guild.id);

            // Menção de cargo(s) (pedido do dono, 2026-08-10: "ele deve ser
            // mencionado no canal de logs reportes, e nos tópicos que são
            // abertos pelos reportes" — antes só entrava no log, ver
            // mentionRoleIds mais abaixo; 2026-08-11: até 3 cargos, não só
            // 1, ver fixedLimit em ROLE_TABS/configSystem.js). Resolvida
            // aqui em cima porque a thread é criada ANTES do log — usada
            // nos dois. Mencionar dentro da thread também garante que quem
            // tem o cargo vire membro dela (Discord adiciona
            // automaticamente quem é mencionado numa thread), então a
            // staff é notificada mesmo sem abrir o canal de logs.
            const mentionRoleIds = ConfigSystem.getRoleIds(guild.id, 'report_mention_role');

            // ==================== CONTAINER DA THREAD ====================
            const threadBuilder = new AdvancedContainerBuilder({ accentColor: personalization.accentColor ?? COLORS.DEFAULT });
            if (threadBanner.type === 'buffer') threadBuilder.bannerFromBuffer(threadBanner.value);
            else threadBuilder.banner(threadBanner.value);
            threadBuilder.text(`## ${EMOJIS.ticket || '🗨️'} REPORTE | ${reportId}`);
            if (mentionRoleIds.length > 0) threadBuilder.text(`${EMOJIS.megaphone || '📢'} ${mentionRoleIds.map(id => `<@&${id}>`).join(' ')}`);
            threadBuilder.text(welcomeMessage || `Obrigado por abrir o reporte. Um membro da staff irá te atender em breve.\n\nEnquanto aguarda, você pode adicionar mais informações ou provas neste chat.`);
            threadBuilder.footer(guild);

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
            const infoBuilder = new AdvancedContainerBuilder({ accentColor: personalization.accentColor ?? COLORS.DEFAULT });
            infoBuilder.title(`${EMOJIS.clipboardlist || '📋'} Informações do Report`, 1);
            infoBuilder.separator();
            infoBuilder.text(`**${EMOJIS.messagesquare || '📝'} Regra quebrada:** ${data.regra}`);
            infoBuilder.text(`**${EMOJIS.clock || '⏰'} Quando aconteceu:** ${data.dataHora}`);
            infoBuilder.text(`**${EMOJIS.mappin || '📍'} Local:** ${data.local || 'Não informado'}`);
            infoBuilder.text(`**${EMOJIS.DinoFootprint || '🦶'} Personagem perdido:** ${data.personagem || 'Não informado'}`);
            infoBuilder.text(`**${EMOJIS.descricao || '📋'} Descrição:** ${data.descricao}`);
            infoBuilder.footer(guild);
            
            const { components: infoComponents, flags: infoFlags } = infoBuilder.build();
            await thread.send({ 
                components: infoComponents, 
                flags: [infoFlags] 
            });

            // ==================== DM DO USUÁRIO ====================
            const dmBuilder = this.createBaseContainer(guild, reportNumber, user, 'waiting', [], { audience: 'dm' });
            const { components: dmComponents, flags: dmFlags, files: dmFiles } = dmBuilder.build();
            const dmRow = this._buildDmButtonRow(guild, reportNumber);

            const dmMessage = await user.send({
                components: [...dmComponents, dmRow],
                flags: [dmFlags],
                files: dmFiles
            }).catch(() => null);

            // ==================== LOG DA STAFF ====================
            const logChannel = await guild.channels.fetch(logChannelId);
            // mentionRoleIds já resolvido lá em cima (reaproveitado na
            // thread também agora) — só passado AQUI e na thread, não nas
            // reconstruções de joinReport/closeReport/updateStatus/
            // rateReport (que chamam createBaseContainer sem essa opção) —
            // a menção aparece uma vez, na abertura, sem se repetir em toda
            // edição subsequente do mesmo painel.
            const logBuilder = this.createBaseContainer(guild, reportNumber, user, 'waiting', [], { mentionRoleIds });
            const { components: logComponents, flags: logFlags } = logBuilder.build();
            const logRow = this._buildLogButtonRow(guild, reportNumber, reportId);

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
            // Mesmo motivo do openReport() acima — `reports` tem FOREIGN
            // KEY em guild_id/user_id, sem isso o INSERT quebrava quando
            // quem pedia a revisão nunca tinha interagido com o bot antes
            // (bem provável aqui: alguém que acabou de levar um strike e
            // clica direto em "Revisar Punição").
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

            const strikeNumber = parseInt(String(strikeNumberRaw).replace(/[^\d]/g, ''));
            if (isNaN(strikeNumber)) {
                await interaction.editReply({ content: `${EMOJIS.circlealert || '❌'} Número de strike inválido.`, flags: [MessageFlags.Ephemeral] });
                return;
            }

            const punishment = db.prepare(`
                SELECT * FROM punishments WHERE guild_id = ? AND strike_number = ?
            `).get(guild.id, strikeNumber);
            if (!punishment) {
                await interaction.editReply({ content: `${EMOJIS.circlealert || '❌'} Punição #ID${strikeNumber} não encontrada.`, flags: [MessageFlags.Ephemeral] });
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
            const reportId = `#REP${reportNumber}`;
            // Mesmo padrão de openReport() acima — ver buildThreadName.
            const threadName = this.buildThreadName(reportNumber, user.username, 'open');
            const personalization = ConfigSystem.getPanelPersonalization(guild.id);

            const thread = await interaction.channel.threads.create({
                name: threadName,
                type: ChannelType.PrivateThread,
                invitable: false,
                reason: `Revisão do strike #ID${strikeNumber} solicitada por ${user.tag}`
            });
            await thread.members.add(user.id);

            // Banner e mensagem de boas-vindas — mesmo texto/banner
            // compartilhado com openReport() acima, já que /config
            // personalizar trata os dois fluxos como um só ("report-chat"),
            // tier já checado dentro do helper.
            const { banner: threadBanner, welcomeMessage } = await this._resolveThreadPersonalization(guild.id);

            // Menção de cargo(s) (pedido do dono, 2026-08-10 — ver
            // openReport() acima pro comentário completo; até 3, 2026-08-11)
            // — resolvida aqui em cima porque a thread é criada ANTES do
            // log, reaproveitada nos dois.
            const mentionRoleIds = ConfigSystem.getRoleIds(guild.id, 'report_mention_role');

            // ==================== CONTAINER DA THREAD ====================
            const threadBuilder = new AdvancedContainerBuilder({ accentColor: personalization.accentColor ?? COLORS.DEFAULT });
            if (threadBanner.type === 'buffer') threadBuilder.bannerFromBuffer(threadBanner.value);
            else threadBuilder.banner(threadBanner.value);
            threadBuilder.text(`## ${EMOJIS.ticket || '🗨️'} REVISÃO DE PUNIÇÃO | ${reportId}`);
            if (mentionRoleIds.length > 0) threadBuilder.text(`${EMOJIS.megaphone || '📢'} ${mentionRoleIds.map(id => `<@&${id}>`).join(' ')}`);
            threadBuilder.text(welcomeMessage || `Obrigado por solicitar a revisão. Um membro da staff irá analisar o caso em breve.\n\nEnquanto aguarda, você pode adicionar mais informações ou provas neste chat.`);
            threadBuilder.footer(guild);

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

            const summaryBuilder = new AdvancedContainerBuilder({ accentColor: personalization.accentColor ?? COLORS.DEFAULT });
            summaryBuilder.title(`${EMOJIS.gavel || '⚖️'} Resumo da Punição #ID${strikeNumber}`, 1);
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
            summaryBuilder.footer(guild);

            const { components: summaryComponents, flags: summaryFlags } = summaryBuilder.build();
            await thread.send({
                components: summaryComponents,
                flags: [summaryFlags]
            });

            // ==================== DM DO USUÁRIO ====================
            const dmBuilder = this.createBaseContainer(guild, reportNumber, user, 'waiting', [], { audience: 'dm' });
            const { components: dmComponents, flags: dmFlags, files: dmFiles } = dmBuilder.build();
            const dmRow = this._buildDmButtonRow(guild, reportNumber);

            const dmMessage = await user.send({
                components: [...dmComponents, dmRow],
                flags: [dmFlags],
                files: dmFiles
            }).catch(() => null);

            // ==================== LOG DA STAFF ====================
            const logChannel = await guild.channels.fetch(logChannelId);
            // mentionRoleIds já resolvido lá em cima (reaproveitado na thread também).
            const logBuilder = this.createBaseContainer(guild, reportNumber, user, 'waiting', [], { mentionRoleIds });
            const { components: logComponents, flags: logFlags } = logBuilder.build();
            const logRow = this._buildLogButtonRow(guild, reportNumber, reportId);

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
    
    // ==================== BOTÕES DOS PAINÉIS (reconstruídos, nunca preservados) ====================
    /**
     * Botões do painel de log da staff (Entrar/Fechar/Fechar com Motivo) e
     * da DM do usuário (Fechar/Fechar com Motivo) — SEMPRE reconstruídos do
     * zero a partir de guild.id/reportNumber/reportId em vez de extraídos
     * de logMessage.components/dmMessage.components de uma mensagem já
     * enviada (pedido do dono, 2026-08-09: "houve um painel que os botões
     * pararam de funcionar, logo não permitiu fechar o report"). O padrão
     * antigo (usado em joinReport/updateStatus) fazia
     * `existingComponents.slice(1)` pra "preservar" a linha de botões ao
     * reeditar o painel — depende de o Discord devolver
     * message.components na mesma forma exata que foi enviada, o que não é
     * garantido (mensagem/canal recriado, ordem diferente, etc) e falha
     * sem erro visível quando não bate. Os 3 (ou 2) botões são 100%
     * determinísticos a partir dos IDs já em mãos, então reconstruir é
     * estritamente mais robusto e não custa nada a mais.
     */
    _buildLogButtonRow(guild, reportNumber, reportId) {
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

        return new ActionRowBuilder().addComponents(joinButton, logCloseButton, logCloseReasonButton);
    }

    _buildDmButtonRow(guild, reportNumber) {
        const closeButton = new ButtonBuilder()
            .setCustomId(`close:${guild.id}:${reportNumber}`)
            .setLabel('Fechar')
            .setStyle(ButtonStyle.Danger);

        const closeReasonButton = new ButtonBuilder()
            .setCustomId(`close_reason:${guild.id}:${reportNumber}`)
            .setLabel('Fechar com Motivo')
            .setStyle(ButtonStyle.Primary);

        return new ActionRowBuilder().addComponents(closeButton, closeReasonButton);
    }

    // ==================== STAFF ENTRAR ====================

    async joinReport(interaction, reportId) {
        const { guild, user, member } = interaction;
        
        try {
            if (!ConfigSystem.memberHasModOrSupervisorRole(guild.id, member)) {
                await this.sendTempReply(interaction, `Você não tem permissão para entrar em reports.`, false);
                return;
            }

            // Aceita tanto o prefixo NOVO (#REP, pedido do dono 2026-08-09) quanto
        // o ANTIGO (#R) — customIds de botões já enviados em mensagens de log
        // anteriores a essa troca continuam com "#R..." gravado dentro deles
        // pra sempre (Discord não reescreve mensagens já enviadas), então o
        // parse precisa continuar reconhecendo o formato antigo indefinidamente.
        const reportNumber = parseInt(reportId.replace(/^#?(REP|R)/i, ''));
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

                const AnalyticsSystem = require('./analyticsSystem');
                AnalyticsSystem.recordReportJoin(guild.id, user.id);
            }

            const targetUser = await this.client.users.fetch(report.user_id);

            // Log e DM atualizados em try/catch SEPARADOS (pedido do dono,
            // 2026-08-09 — ver comentário de _buildLogButtonRow acima): o
            // join em si (thread.members.add + staffs no banco, já feito
            // acima) é o que realmente importa; se o painel de log ou a DM
            // falhar ao atualizar (mensagem apagada, canal reconfigurado
            // depois da abertura, etc), isso não pode impedir o outro
            // update nem esconder que o join funcionou.
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
            if (logChannelId && report.log_message_id) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId);
                    const logMessage = await logChannel.messages.fetch(report.log_message_id);
                    if (logMessage) {
                        const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, report.status, staffs);
                        const { components: updatedComponents, flags: updatedFlags } = updatedBuilder.build();
                        const logRow = this._buildLogButtonRow(guild, reportNumber, reportId);
                        await logMessage.edit({
                            components: [...updatedComponents, logRow],
                            flags: [updatedFlags]
                        });
                    }
                } catch (err) {
                    console.error('❌ [ReportChatSystem] Erro ao atualizar painel de log em joinReport:', err);
                }
            }

            if (report.dm_message_id) {
                try {
                    const dmMessage = await user.createDM().then(dm => dm.messages.fetch(report.dm_message_id)).catch(() => null);
                    if (dmMessage) {
                        const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, report.status, staffs, { audience: 'dm' });
                        const { components: updatedComponents, flags: updatedFlags, files: updatedFiles } = updatedBuilder.build();
                        const dmRow = this._buildDmButtonRow(guild, reportNumber);
                        await dmMessage.edit({
                            components: [...updatedComponents, dmRow],
                            flags: [updatedFlags],
                            files: updatedFiles
                        });
                    }
                } catch (err) {
                    console.error('❌ [ReportChatSystem] Erro ao atualizar DM em joinReport:', err);
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
                const reportId = `#REP${reportNumber}`;
                await this.sendTempReply(interaction, `Report ${reportId} não encontrado.`, false);
                return;
            }
            
            const reportId = `#REP${reportNumber}`;
            const guild = this.client.guilds.cache.get(report.guild_id);
            
            if (!guild) {
                await this.sendTempReply(interaction, `Servidor do report ${reportId} não encontrado.`, false);
                return;
            }

            const isStaff = ConfigSystem.memberHasConfiguredRole(guild.id, interaction.member, 'staff_role');
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
     * Registra quem apagou o tópico de um report/revisão (ver
     * src/events/threadDelete.js, resolvido via audit log — o evento em si
     * não vem com o executor) e, se o report ainda estava ABERTO, libera a
     * vaga automaticamente (mesmo critério de sempre — sem isso, apagar a
     * thread deixaria o report "aberto" pra sempre no banco).
     *
     * thread_deleted_by é gravado SEMPRE que a thread some, independente do
     * status — um tópico pode ser apagado bem depois do report já ter sido
     * fechado normalmente (limpeza de canal, por exemplo); isso é uma
     * informação separada de quem fechou o report de verdade (closed_by),
     * pedido do dono pro dashboard mostrar as duas coisas.
     *
     * @param {string} threadId
     * @param {string|null} [deletedBy] - ID de quem apagou (null se o audit
     *   log não achou/expirou — ainda registra a exclusão em si, só sem autor).
     */
    async releaseReportByThreadId(threadId, deletedBy = null) {
        const report = db.prepare(`SELECT * FROM reports WHERE thread_id = ?`).get(threadId);
        if (!report) return null;

        db.prepare(`
            UPDATE reports SET thread_deleted_by = ? WHERE guild_id = ? AND report_number = ?
        `).run(deletedBy, report.guild_id, report.report_number);

        const wasOpen = !['closed_no_reason', 'closed_with_reason'].includes(report.status);
        if (wasOpen) {
            db.prepare(`
                UPDATE reports SET status = 'closed_no_reason', closed_reason = ?, closed_at = ?
                WHERE guild_id = ? AND report_number = ?
            `).run('Thread excluída - liberado automaticamente', Date.now(), report.guild_id, report.report_number);

            this.updateStatus(report.guild_id, `#REP${report.report_number}`, 'closed_no_reason').catch(() => {});
        }

        await this._logThreadDeleted(report, deletedBy);

        return report;
    }

    /**
     * Avisa no canal de log Geral (pedido do dono) sempre que um tópico de
     * report/revisão é apagado — mesmo canal/estilo já usado por
     * ConfigSystem.logConfigChange, mas sem precisar de uma interaction de
     * verdade (esse evento vem do gateway puro, ver src/events/threadDelete.js).
     * Falha silenciosamente se o canal não estiver configurado ou não puder
     * ser alcançado, mesmo padrão dos demais envios de log.
     */
    async _logThreadDeleted(report, deletedBy) {
        try {
            const guild = this.client.guilds.cache.get(report.guild_id);
            if (!guild) return;

            const logChannelId = ConfigSystem.getUnifiedGeneralLogChannel(report.guild_id);
            if (!logChannelId) return;
            const channel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (!channel) return;

            const personalization = ConfigSystem.getPanelPersonalization(report.guild_id);
            const builder = new AdvancedContainerBuilder({ accentColor: personalization.accentColor ?? COLORS.ERROR });
            builder.title(`${EMOJIS.trianglealert || '⚠️'} Tópico de Report Apagado`);
            builder.text(`**Report:** ${EMOJIS.ticket || '🎫'} ${report.report_id}`);
            builder.text(`**Apagado por:** ${deletedBy ? `<@${deletedBy}>` : 'Não identificado (audit log não encontrou a exclusão)'}`);
            builder.separator();
            builder.footer(guild);

            const { components, flags } = builder.build();
            await channel.send({ components, flags: [flags] });
        } catch (error) {
            console.error('❌ [ReportChatSystem] Erro ao enviar log de tópico apagado:', error);
        }
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
                const reportId = `#REP${reportNumber}`;
                await this.sendTempReply(interaction, `Report ${reportId} não encontrado.`, false);
                return;
            }
            
            const reportId = `#REP${reportNumber}`;
            
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

            // Canal dedicado de avaliação de atendimento (pedido do dono,
            // 2026-08-10: "Feedback feito por reportes... para que apareçam
            // em um canal especifico para expor a avaliação de atendimento,
            // em config logs") — SEPARADO de log_reports acima: aquele só
            // edita o painel do report que já foi avaliado (precisa abrir
            // report por report pra ver notas); este manda 1 mensagem nova
            // por avaliação, pra acompanhar qualidade de atendimento sem
            // vasculhar reports individualmente. Best-effort, nunca quebra
            // o fluxo principal (a nota já foi salva no banco acima).
            if (guild) {
                try {
                    const feedbackChannelId = ConfigSystem.getSetting(report.guild_id, 'log_report_feedback');
                    if (feedbackChannelId) {
                        const feedbackChannel = await guild.channels.fetch(feedbackChannelId).catch(() => null);
                        if (feedbackChannel) {
                            const starEmoji = EMOJIS.starfull || '⭐';
                            // SUCCESS/ERROR continuam fixos (refletem a nota em si) —
                            // só a nota neutra (3 estrelas) usa a cor personalizada
                            // do servidor, pedido do dono 2026-08-10.
                            const feedbackAccent = nota >= 4 ? COLORS.SUCCESS : (nota <= 2 ? COLORS.ERROR : (ConfigSystem.getPanelPersonalization(guild.id).accentColor ?? COLORS.DEFAULT));
                            const feedbackBuilder = new AdvancedContainerBuilder({ accentColor: feedbackAccent });
                            feedbackBuilder.text(`## ${starEmoji} Nova Avaliação de Atendimento | ${reportId}`);
                            feedbackBuilder.separator();
                            feedbackBuilder.text(`${EMOJIS.user || '👤'} **Jogador:** ${targetUser}`);
                            if (staffs.length > 0) {
                                feedbackBuilder.text(`${EMOJIS.shieldcheck || '🛡️'} **Staff responsável:** <@${staffs[0].id}>`);
                            }
                            feedbackBuilder.text(`${starEmoji} **Nota:** ${starEmoji.repeat(nota)} (${nota}/5)`);
                            if (comentario) {
                                feedbackBuilder.text(`${EMOJIS.messagesquare || '📝'} **Comentário:**\n\`\`\`text\n${comentario}\n\`\`\``);
                            }
                            feedbackBuilder.footer(guild);
                            await feedbackChannel.send(feedbackBuilder.build());
                        }
                    }
                } catch (err) {
                    console.error('❌ [ReportChatSystem] Erro ao postar avaliação no canal dedicado:', err);
                }
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
        // Aceita tanto o prefixo NOVO (#REP, pedido do dono 2026-08-09) quanto
        // o ANTIGO (#R) — customIds de botões já enviados em mensagens de log
        // anteriores a essa troca continuam com "#R..." gravado dentro deles
        // pra sempre (Discord não reescreve mensagens já enviadas), então o
        // parse precisa continuar reconhecendo o formato antigo indefinidamente.
        const reportNumber = parseInt(reportId.replace(/^#?(REP|R)/i, ''));
        const report = db.prepare(`SELECT * FROM reports WHERE guild_id = ? AND report_number = ?`).get(guildId, reportNumber);
        if (!report) return;

        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;

        const staffs = report.staffs ? JSON.parse(report.staffs) : [];
        const targetUser = await this.client.users.fetch(report.user_id);

        // Reports FECHADOS não ganham a linha de botões de volta (mesmo
        // critério de closeReport — "Entrar"/"Fechar" não fazem sentido
        // num report já encerrado, e updateStatus(..., 'closed_no_reason')
        // é chamado por releaseReportByThreadId quando o TÓPICO foi
        // apagado, então "Entrar no Reporte" ficaria literalmente
        // quebrado se continuasse aparecendo).
        const isClosedStatus = newStatus === 'closed_no_reason' || newStatus === 'closed_with_reason';
        const normalizedReportId = `#REP${reportNumber}`;

        // Nome do tópico só muda MAIS UMA VEZ, quando o report vira
        // 'inactive' (pedido do dono, 2026-08-10 — ver THREAD_STATUS_DOT/
        // buildThreadName acima: renomear em toda transição de status
        // estourava o rate limit de renomear canal do Discord e travava o
        // fechamento junto, porque setName/setLocked/setArchived competem
        // pelo mesmo bucket). 'waiting'/'responded' NÃO renomeiam mais —
        // o tópico fica com o nome verde ("aberto") de quando foi criado
        // até virar inativo ou ser fechado (closeReport arquiva, não
        // renomeia). Try/catch: renomear continua best-effort, uma falha
        // aqui não pode derrubar a atualização do painel de log/DM abaixo.
        if (newStatus === 'inactive' && report.thread_id) {
            try {
                const thread = await guild.channels.fetch(report.thread_id);
                if (thread) await thread.setName(this.buildThreadName(reportNumber, targetUser.username, newStatus));
            } catch (err) {
                console.error('❌ [ReportChatSystem] Erro ao renomear tópico em updateStatus:', err);
            }
        }

        // Log e DM em try/catch SEPARADOS + botões reconstruídos do zero
        // (nunca preservados via slice de mensagem já enviada) — mesmo
        // motivo de joinReport, ver comentário de _buildLogButtonRow.
        const logChannelId = ConfigSystem.getSetting(guildId, 'log_reports');
        if (logChannelId && report.log_message_id) {
            try {
                const logChannel = await guild.channels.fetch(logChannelId);
                const logMessage = await logChannel.messages.fetch(report.log_message_id);
                if (logMessage) {
                    const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, newStatus, staffs);
                    const { components: updatedComponents, flags: updatedFlags } = updatedBuilder.build();
                    const finalComponents = isClosedStatus
                        ? updatedComponents
                        : [...updatedComponents, this._buildLogButtonRow(guild, reportNumber, normalizedReportId)];
                    await logMessage.edit({
                        components: finalComponents,
                        flags: [updatedFlags]
                    });
                }
            } catch (err) {
                console.error('❌ [ReportChatSystem] Erro ao atualizar painel de log em updateStatus:', err);
            }
        }

        if (report.dm_message_id) {
            try {
                const dmMessage = await targetUser.createDM().then(dm => dm.messages.fetch(report.dm_message_id)).catch(() => null);
                if (dmMessage) {
                    const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, newStatus, staffs, { audience: 'dm' });
                    const { components: updatedComponents, flags: updatedFlags, files: updatedFiles } = updatedBuilder.build();
                    const finalComponents = isClosedStatus
                        ? updatedComponents
                        : [...updatedComponents, this._buildDmButtonRow(guild, reportNumber)];
                    await dmMessage.edit({
                        components: finalComponents,
                        flags: [updatedFlags],
                        files: updatedFiles
                    });
                }
            } catch (err) {
                console.error('❌ [ReportChatSystem] Erro ao atualizar DM em updateStatus:', err);
            }
        }
    }
}

module.exports = ReportChatSystem;