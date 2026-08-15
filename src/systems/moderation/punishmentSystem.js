// /home/ubuntu/DiscStaffBot/src/systems/moderation/punishmentSystem.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/index.js');
const { EMOJIS } = require('../../database/emojis.js');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const { PaginationBuilder } = require('../../utils/paginationBuilder');
const SessionManager = require('../../utils/sessionManager');
const SequenceManager = require('../../database/sequences');
const { getPlayerByDiscordId } = require('../pot/potPlayerRegistry');
const imageManager = require('../../utils/imageManager');
const PremiumSystem = require('../premium/premiumSystem');
const { buildIdentityBlock } = require('../../utils/userIdentity');
const PunishmentLevels = require('./punishmentLevels');
const ErrorLogger = require('../core/errorLogger');

// Convenção pra "alvo sem conta Discord conhecida" (ver /strike ingame e
// /strike personalizado com só AGID informado, sem vínculo /registrar) —
// punishments.user_id é NOT NULL, então em vez de bloquear a punição por
// falta de vínculo, guardamos esse valor sintético (nunca colide com um
// snowflake real do Discord, que é só dígitos). _isUnregisteredTargetId
// detecta essa convenção em qualquer lugar que precise (ex: /unstrike
// desfazendo a ação em jogo de uma punição assim).
const UNREGISTERED_TARGET_PREFIX = 'agid:';

function _isUnregisteredTargetId(targetId) {
    return typeof targetId === 'string' && targetId.startsWith(UNREGISTERED_TARGET_PREFIX);
}

function _unregisteredTargetId(alderonId) {
    return `${UNREGISTERED_TARGET_PREFIX}${alderonId}`;
}

// ── Sanitização de texto pra RCON (pedido do dono, 2026-08-11) — o console
// do Path of Titans quebra o comando ao meio se receber aspas duplas
// (fecham a string do parâmetro antes da hora) ou quebras de linha
// (interpretadas como fim da linha de comando). Remove esses caracteres
// (e outros de controle) em vez de tentar escapá-los — o PoT não documenta
// nenhuma sintaxe de escape confiável, então a aposta mais segura é não
// deixar o caractere perigoso chegar no console de jeito nenhum. Trunca no
// limite pedido (120 pro texto que o jogador vê — a UI do menu principal
// do jogo estoura acima disso). Não mexe no valor gravado no banco
// (`reason`/`notes` guardam exatamente o que o staff digitou) — só a cópia
// que de fato viaja pro RCON passa por aqui.
function sanitizeForRcon(text, maxLen = null) {
    if (!text) return '';
    let clean = String(text)
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/["\\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (maxLen && clean.length > maxLen) clean = clean.slice(0, maxLen).trim();
    return clean;
}

// ── "Motivo_Admin" da sintaxe oficial de /ban do PoT (visível só no
// console/log do servidor, nunca pro jogador) — construído automaticamente
// a partir do nível/staff/report, já que não existe (nem foi pedido) um
// campo separado pra staff digitar isso à mão. Serve de referência rápida
// pra quem olhar o log do servidor sem precisar abrir o Discord.
function buildAdminReasonLabel({ levelName, staffTag, reportId }) {
    const parts = [levelName || 'Registro manual'];
    if (staffTag) parts.push(`Staff: ${staffTag}`);
    if (reportId) parts.push(reportId);
    return sanitizeForRcon(parts.join(' - '), 150);
}

const PunishmentSystem = {
    _isUnregisteredTargetId,
    _unregisteredTargetId,

    
    // ==================== FUNÇÕES DE BUSCA E BANCO ====================
    
    async getUserHistory(guildId, userId, page = 1) {
        try {
            const limit = 5;
            const offset = (page - 1) * limit;

            let rep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            const points = rep ? rep.points : 100;

            const total = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            const totalRecords = total.count;
            const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

            const punishments = db.prepare(`
                SELECT * FROM punishments 
                WHERE guild_id = ? AND user_id = ? 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `).all(guildId, userId, limit, offset);

            return { reputation: points, punishments, totalRecords, totalPages };
        } catch (error) {
            console.error('❌ Erro ao buscar histórico:', error);
            return { reputation: 100, punishments: [], totalRecords: 0, totalPages: 1 };
        }
    },
    
    async getUserData(guildId, userId) {
        try {
            const rep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            const points = rep ? rep.points : 100;
            
            const lastPunishments = db.prepare(`
                SELECT * FROM punishments 
                WHERE guild_id = ? AND user_id = ? 
                ORDER BY created_at DESC LIMIT 3
            `).all(guildId, userId);
            
            const totalStrikes = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            
            return { reputation: points, lastPunishments, totalStrikes: totalStrikes?.count || 0 };
        } catch (error) {
            console.error('❌ Erro ao buscar dados:', error);
            return { reputation: 100, lastPunishments: [], totalStrikes: 0 };
        }
    },

    getNextStrikeNumber(guildId) {
        const nextValue = SequenceManager.getNextValue(guildId, 'punishments');
        return nextValue;
    },

    /**
     * "Honra" do card de perfil (/perfil) — ao contrário da reputação (pontos,
     * por servidor), a honra é GLOBAL: conta punições ATIVAS (não anuladas)
     * do usuário em TODOS os servidores, sem filtro de guild_id. Quanto menos
     * punições ativas, mais estrelas (0 a 5).
     */
    getGlobalHonorStars(userId) {
        const row = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE user_id = ? AND status = 'active'`).get(userId);
        const activeCount = row?.count || 0;
        if (activeCount === 0) return 5;
        if (activeCount <= 2) return 4;
        if (activeCount <= 4) return 3;
        if (activeCount <= 7) return 2;
        return 1;
    },

    /**
     * Ícone por severidade — fonte única, com 3 ramos: nível novo (texto,
     * ver punishmentLevels.SEVERITY_ICONS), linha legada (severidade
     * numérica 1-5 do sistema antigo, só pra punições já aplicadas antes
     * desta revisão) ou nenhuma (Free, sem conceito de nível/severidade).
     *
     * @param {{ levelSeverity?: string|null, severity?: number|null }} obj
     */
    severityIconFor({ levelSeverity, severity }) {
        if (levelSeverity) {
            return PunishmentLevels.SEVERITY_ICONS[levelSeverity] || EMOJIS.gavel || '⚖️';
        }
        if (severity && Number(severity) > 0) {
            const legacyIcons = ['', EMOJIS.severidadebaixa || '🟢', EMOJIS.severidademedia || '🟡', EMOJIS.severidadelaranja || '🟠', EMOJIS.severidadealta || '🔴', EMOJIS.Dead || '💀'];
            return legacyIcons[Number(severity)] || '❓';
        }
        return EMOJIS.messagesquare || '📝';
    },

    // ==================== GERADORES DE UI (CONTAINER) ====================

    /**
     * Busca todos os dados necessários e monta TODAS as páginas do histórico
     * de uma vez (necessário porque PaginationBuilder.addPage recebe uma
     * função síncrona que retorna um AdvancedContainerBuilder já pronto).
     *
     * @param {object} target   - User do discord.js
     * @param {string} guildId
     * @param {string} guildName
     * @returns {Promise<{ pages: Function[], totalPages: number, totalRecords: number, reputation: number }>}
     */
    async buildHistoryPages(target, guildId, guildName) {
        // Primeiro busca a página 1 só para saber o totalPages/reputation/totalRecords
        const first = await this.getUserHistory(guildId, target.id, 1);
        const totalPages = first.totalPages;

        // Busca os dados de todas as páginas de uma vez (poucas páginas, é OK)
        const allPagesData = [first];
        for (let p = 2; p <= totalPages; p++) {
            allPagesData.push(await this.getUserHistory(guildId, target.id, p));
        }

        const pageFactories = allPagesData.map((historyData) =>
            () => this.generateHistoryContainer(target, historyData, guildName, guildId),
        );

        return {
            pages: pageFactories,
            totalPages,
            totalRecords: first.totalRecords,
            reputation: first.reputation,
        };
    },

    /**
     * Monta o container de uma única página do histórico.
     */
    generateHistoryContainer(target, history, guildName, guildId) {
        // SUCCESS/ERROR continuam fixos (refletem a reputação em si) — só o
        // meio-termo (30-70, nem boa nem ruim) usa a cor personalizada do
        // servidor no lugar do DEFAULT fixo, pedido do dono 2026-08-10.
        let accentColor = this._resolvePersonalization(guildId).accentColor ?? COLORS.DEFAULT;
        if (history.reputation > 70) accentColor = COLORS.SUCCESS;
        else if (history.reputation < 30) accentColor = COLORS.ERROR;

        const repEmoji = history.reputation >= 90 ? (EMOJIS.starfull || '🌟') :
                        history.reputation >= 70 ? (EMOJIS.star || '⭐') :
                        history.reputation >= 50 ? (EMOJIS.thumbsup || '👍') : (EMOJIS.trianglealert || '⚠️');

        const builder = new AdvancedContainerBuilder({ accentColor });

        // Ícone via imageManager.getUrl() direto (não builder.assetThumbnail()):
        // este container roda dentro do PaginationBuilder, que só reaproveita
        // o attachment registrado globalmente via pagination.setFiles() (ver
        // historico.js) — um attachment registrado aqui dentro por página se
        // perderia ao trocar de página.
        builder.section(
            [
                '# HISTÓRICO DO JOGADOR',
                'Reputação e punições registradas para este usuário.',
            ].join('\n'),
            AdvancedContainerBuilder.thumbnail(imageManager.getUrl('icone_history') || 'https://cdn.discordapp.com/embed/avatars/0.png')
        );
        builder.separator();

        const avatar = target.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        builder.section(
            buildIdentityBlock(target),
            AdvancedContainerBuilder.thumbnail(avatar),
        );

        builder.separator();
        builder.text(`**Server:** ${guildName}`);
        if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
            builder.text(`${repEmoji} **Reputação Atual:** ${history.reputation}/100 pontos`);
        } else {
            builder.text(`${EMOJIS.messagesquare || 'ℹ️'} **Reputação:** disponível a partir do plano Rastreador`);
        }
        builder.text(`${EMOJIS.gavel || '⚠️'} **Total de Punições:** ${history.totalRecords}`);
        
        if (history.punishments.length > 0) {
            builder.separator();
            for (const p of history.punishments) {
                const date = `<t:${Math.floor(p.created_at / 1000)}:d>`;
                const severityIcon = this.severityIconFor({ levelSeverity: p.level_severity, severity: p.severity });
                const strikeNum = p.strike_number || p.id;
                builder.text(`${severityIcon} Strike #ID${strikeNum}${p.level_name ? ` (${p.level_name})` : ''} | ${date}`);
                builder.text(`┃ Moderador: <@${p.moderator_id}>`);
                if (p.report_id) builder.text(`┃ Report: \`${p.report_id}\``);
                if (p.approved_by) builder.text(`┃ Aprovado por: <@${p.approved_by}>`);
                if (p.notes) builder.text(`┃ Observações: ${p.notes}`);
                if (p.status === 'revoked') builder.text(`┃ Status: ${EMOJIS.circlecheck || '✅'} Anulado`);
                builder.separator();
            }
        } else {
            builder.text(`\`\`\`\nNenhuma punição registrada.\n\`\`\``);
        }
        
        builder.footer({ id: guildId, name: guildName });

        return builder;
    },

    /**
     * Cor de destaque customizada (aba "Aparência Geral" de /config
     * personalizar) — ver ConfigSystem.getPanelPersonalization. O rodapé
     * customizado (footerText) não precisa mais ser lido/aplicado à mão
     * aqui: builder.footer(guild) já resolve isso sozinho (ver
     * containerBuilder.js). Sempre retorna `{ accentColor: null, footerText:
     * null }` fora do Caçador (checagem já dentro de getPanelPersonalization).
     */
    _resolvePersonalization(guildId) {
        const ConfigSystem = require('../core/configSystem');
        return ConfigSystem.getPanelPersonalization(guildId);
    },

    // Reservado SÓ pro que pode ser visto pelo jogador (vai pra DM) E pra
    // qualquer staff que olhe o canal 'log_punishments' — pedido do dono,
    // 2026-08-13: "muitos servidores estão usando o canal de log de forma
    // publica para players", então NUNCA inclua aqui nada marcado como
    // observação/nota INTERNA da staff (coluna `notes`, ver `observacoes`
    // do /strike) — essa vai só pro canal 'log_staff', num card próprio
    // (ver _sendStrikeNotesToStaffLog), nunca reaproveitando este container.
    async generateStrikeUnifiedContainer(client, target, moderator, strikeNumber, levelName, levelSeverity, reason, reportId, pointsLost, newPoints, guildName, reportLink, guildId, jogoAct, ingameActionResult, approvedByTag = null) {
        const personalization = this._resolvePersonalization(guildId);
        const builder = new AdvancedContainerBuilder({ accentColor: personalization.accentColor ?? COLORS.ERROR });
        // Banner padrão do bot / pool de fotos / imagem própria enviada via
        // /config personalizar ou pelo dashboard — ver customBannerResolver.js.
        const CustomBannerResolver = require('../../utils/customBannerResolver');
        const strikeBanner = await CustomBannerResolver.resolveBanner(client, guildId, 'strike');
        if (strikeBanner.type === 'buffer') {
            builder.bannerFromBuffer(strikeBanner.value);
        } else {
            builder.banner(strikeBanner.value);
        }

        // ── Apresentação padrão: Moderador primeiro, logo após o banner ─────
        const moderatorAvatar = moderator.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        builder.section(
            `## STAFF RESPONSAVEL\n${buildIdentityBlock(moderator)}`,
            AdvancedContainerBuilder.thumbnail(moderatorAvatar),
        );
        builder.separator();

        // ── Apresentação padrão: Usuário alvo da punição ─────────────────────
        const targetAvatar = target?.displayAvatarURL?.({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        builder.section(
            `## JOGADOR\n${buildIdentityBlock(target)}`,
            AdvancedContainerBuilder.thumbnail(targetAvatar),
        );
        builder.separator();
        builder.text(`## ${EMOJIS.ban || '❌'} STRIKE | ***#ID${strikeNumber}***`, 1);
        if (levelSeverity) {
            builder.text(`${this.severityIconFor({ levelSeverity })} **Nível:** ${levelName} (${levelSeverity})`);
        } else {
            builder.text(`${EMOJIS.messagesquare || '📝'} **Tipo:** Registro simples (sem nível de punição)`);
        }
        if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
            builder.text(`**${EMOJIS.doublearrowdown || '❌'} Pontos subtraídos:** -${pointsLost}`);
            builder.text(`**${EMOJIS.star || '⭐'} Reputação:** ${newPoints + pointsLost} → ${newPoints}`);
        }
        builder.separator();
        builder.text(`**${EMOJIS.messagesquare || '📝'} Motivo:**`);
        if (reportId) builder.text(`**Report:** ${reportLink ? `[${reportId}](${reportLink})` : reportId}`);
        builder.text(`\`\`\`text\n${reason}\n\`\`\``);
        // "Aprovado por": pedido do dono, 2026-08-11 — punição severa exigiu
        // aprovação de Supervisor, então quem aprovou fica visível no
        // próprio registro (não só na resposta efêmera de handleSupervisorApproval).
        if (approvedByTag) {
            builder.text(`**${EMOJIS.shieldban || '🛡️'} Aprovado por:** ${approvedByTag}`);
        }

        const actions = this.getPunishmentActions(jogoAct, ingameActionResult);
        if (actions && actions !== `- ${EMOJIS.messagesquare || '📝'} **Apenas Registro:** Nenhuma ação automática aplicada`) {
            builder.separator();
            builder.text(`**${EMOJIS.trianglealert || '⚠️'} Ações Aplicadas:**`);
            for (const action of actions.split('\n')) {
                if (action.trim()) builder.text(action);
            }
        }

        builder.footer({ id: guildId, name: guildName });

        return builder;
    },

    async generateUnstrikeUnifiedContainer(client, target, moderator, strikeNumber, reason, pointsRestored, newPoints, originalReason, guildName, guildId) {
        const personalization = this._resolvePersonalization(guildId);
        const builder = new AdvancedContainerBuilder({ accentColor: personalization.accentColor ?? COLORS.SUCCESS });
        // Banner padrão do bot / pool de fotos / imagem própria enviada via
        // /config personalizar ou pelo dashboard — ver customBannerResolver.js.
        const CustomBannerResolver = require('../../utils/customBannerResolver');
        const unstrikeBanner = await CustomBannerResolver.resolveBanner(client, guildId, 'unstrike');
        if (unstrikeBanner.type === 'buffer') {
            builder.bannerFromBuffer(unstrikeBanner.value);
        } else {
            builder.banner(unstrikeBanner.value);
        }

        // ── Apresentação padrão: Moderador primeiro, logo após o banner ─────
        const moderatorAvatar = moderator.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        builder.section(
            `## STAFF RESPONSAVEL\n${buildIdentityBlock(moderator)}`,
            AdvancedContainerBuilder.thumbnail(moderatorAvatar),
        );
        builder.separator();

        // ── Apresentação padrão: Usuário alvo da anulação ────────────────────
        const targetAvatar = target?.displayAvatarURL?.({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        builder.section(
            `## JOGADOR\n${buildIdentityBlock(target)}`,
            AdvancedContainerBuilder.thumbnail(targetAvatar),
        );
        builder.separator();
        builder.text(`## ${EMOJIS.circlecheck || '✅'} STRIKE ANULADO | ***#ID${strikeNumber}***`, 1);
        if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
            builder.text(`**${EMOJIS.doublearrowup || '✅'} Pontos restaurados:** +${pointsRestored}`);
            builder.text(`**${EMOJIS.star || '⭐'} Reputação:** ${newPoints - pointsRestored} → ${newPoints}`);
        }
        builder.separator();
        builder.text(`**${EMOJIS.messagesquare || '📝'} Punição Original:**`);
        builder.text(`\`\`\`text\n${originalReason}\n\`\`\``);
        builder.separator();
        builder.text(`**${EMOJIS.messagesquare || '📝'} Motivo da Anulação:**`);
        builder.text(`\`\`\`text\n${reason}\n\`\`\``);
        builder.footer({ id: guildId, name: guildName });

        return builder;
    },
    
    /**
     * Monta o texto de "Ações Aplicadas" a partir do que foi REALMENTE
     * executado (jogoAct + o resultado de fato retornado por
     * _executeStrike) — antes esse texto era inferido só a partir da
     * severidade numérica, de forma cosmética e desconectada da ação real
     * escolhida (bug corrigido em revisão anterior). Ação automática no
     * Discord (timeout/kick/ban nativo) foi REMOVIDA do /strike por pedido
     * do dono, 2026-08-11 — o bot só age em jogo agora.
     */
    getPunishmentActions(jogoAct, ingameActionResult) {
        const actions = [];

        if (jogoAct && jogoAct !== 'none') {
            const icon = EMOJIS.game || '🎮';
            if (ingameActionResult && !ingameActionResult.toLowerCase().startsWith('falha')) {
                actions.push(`- ${icon} **Ação em jogo (${jogoAct}):** ${ingameActionResult}`);
            } else if (ingameActionResult) {
                actions.push(`- ${EMOJIS.circlealert || '❌'} **Ação em jogo (${jogoAct}):** ${ingameActionResult}`);
            }
        }

        if (actions.length === 0) {
            actions.push(`- ${EMOJIS.messagesquare || '📝'} **Apenas Registro:** Nenhuma ação automática aplicada`);
        }
        
        return actions.join('\n');
    },
    
    // ==================== MÉTODOS PARA HANDLER CENTRAL ====================

    /**
     * Monta um payload Components V2 de uma linha só. As mensagens de
     * confirmação de strike/unstrike são Components V2 (MessageFlags.
     * IsComponentsV2) — depois de um deferUpdate(), o Discord rejeita
     * `content` legado nelas (erro 50035 "MESSAGE_CANNOT_USE_LEGACY_
     * FIELDS_WITH_COMPONENTS_V2"). Por isso todo editReply de resultado/erro
     * aqui precisa passar por um container, não por `{ content }`.
     */
    _simpleReply(text, color = COLORS.ERROR, guild = null) {
        return new AdvancedContainerBuilder({ accentColor: color }).text(text).footer(guild).build();
    },

    async handleComponent(interaction, action, param) {
        try {
            const [subAction, targetId, page] = param ? param.split(':') : [];
            switch (action) {
                case 'confirm':
                    await this.handleStrikeConfirmation(interaction, subAction);
                    break;
                case 'unstrike_confirm':
                    await this.handleUnstrikeConfirmation(interaction, subAction);
                    break;
                case 'supervisor_approve':
                    await this.handleSupervisorApproval(interaction, param, true);
                    break;
                case 'supervisor_reject':
                    await this.handleSupervisorApproval(interaction, param, false);
                    break;
                case 'undo-rcon-test':
                    // Passa o param CRU ("Ban:250-488-341", ação:AGID), não
                    // subAction — formato próprio de /rcon-teste, diferente
                    // dos demais cases acima (subAction:targetId:page).
                    await this.handleUndoRconTest(interaction, param);
                    break;
                default:
                    await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Ação "${action}" não reconhecida.`, COLORS.ERROR, interaction.guild));
            }
        } catch (error) {
            console.error('❌ Erro no handleComponent:', error);
            await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Ocorreu um erro.`, COLORS.ERROR, interaction.guild));
        }
    },

    /**
     * Monta o container + botões de confirmação de um /strike — usado tanto
     * pelo caminho Free (registro.js, sem nível) quanto pelo caminho
     * Rastreador+ (src/commands/strike/index.js, sempre com nível) do
     * comando único /strike (ver ambos pra contexto completo do fluxo).
     *
     * @returns {Promise<{ components: object[], flags: number[] }>} pronto para editReply/reply
     */
    async buildStrikeConfirmPreview(session, guild, staffMember) {
        const guildId = guild.id;
        const isUnregisteredTarget = this._isUnregisteredTargetId(session.targetId);
        const targetUser = isUnregisteredTarget ? null : await guild.client.users.fetch(session.targetId).catch(() => null);
        const currentRep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, session.targetId)?.points || 100;
        const previewPoints = Math.max(0, currentRep - (session.pointsLost || 0));
        const durationLower = String(session.durationStr || '').toLowerCase();
        const isPermanent = durationLower === '' || durationLower === '0' || durationLower === 'perm';

        // Cor de destaque personalizada do servidor (Caçador) — pedido do
        // dono, 2026-08-10: era o único passo do fluxo de /strike ainda sem
        // personalização (o resultado final, generateStrikeUnifiedContainer
        // abaixo, já usa isso desde antes).
        const personalization = this._resolvePersonalization(guildId);
        const builder = new AdvancedContainerBuilder({ accentColor: personalization.accentColor ?? COLORS.DEFAULT });
        builder.title(`${EMOJIS.trianglealert || '⚠️'} Confirmar Aplicação de Strike`, 1);
        builder.separator();
        const targetFallback = isUnregisteredTarget
            ? { toString: () => `${session.targetPlayerName || 'Jogador'} \`${session.alderonId}\` (sem Discord vinculado)`, username: session.targetPlayerName || session.alderonId, id: session.targetId }
            : { toString: () => `\`${session.targetId}\``, username: '?', id: session.targetId };
        builder.section(
            `## JOGADOR\n${buildIdentityBlock(targetUser || targetFallback)}`,
            AdvancedContainerBuilder.thumbnail(targetUser?.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png'),
        );
        builder.separator();
        if (session.levelSeverity) {
            builder.text(`${this.severityIconFor({ levelSeverity: session.levelSeverity })} **Nível:** ${session.levelName} (${session.levelSeverity})`);
        } else {
            builder.text(`${EMOJIS.messagesquare || '📝'} **Tipo:** Registro simples (sem nível de punição)`);
        }
        builder.text(`**${EMOJIS.messagesquare || '📝'} Motivo:** ${session.reason}`);
        builder.text(`**${EMOJIS.clockalert || '⏳'} Duração:** ${isPermanent ? 'Permanente' : session.durationStr}`);
        if (session.reportId) builder.text(`**${EMOJIS.ticket || '🎫'} Report:** ${session.reportId}`);
        builder.separator();
        if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
            builder.text(`**${EMOJIS.doublearrowdown || '📉'} Pontos a perder:** -${session.pointsLost || 0} (${currentRep} → ${previewPoints})`);
        }
        // Nota geral (ex: alvo sem Discord vinculado, punição só em jogo) —
        // fora do gate de reputação de propósito: é um aviso sobre a
        // IDENTIDADE do alvo, não sobre pontos, então precisa aparecer
        // mesmo em planos sem reputationEnabled.
        if (session.noteText) {
            builder.text(`${EMOJIS.trianglealert || '⚠️'} ${session.noteText}`);
        }
        builder.text(`**${EMOJIS.game || '🎮'} Ação In-Game:** ${session.jogoAct === 'none' || !session.jogoAct ? 'Nenhuma' : session.jogoAct}`);
        if (session.jogoAct && session.jogoAct !== 'none' && !PremiumSystem.getGuildLimits(guildId).autoRcon) {
            builder.text(`${EMOJIS.trianglealert || '⚠️'} Ação em jogo (RCON) exige o plano Rastreador — a ação escolhida não será aplicada, só o registro da punição.`);
        }
        // Observações: visível só nesta prévia (staff) e no histórico — nunca
        // vai pro RCON nem aparece pro jogador (ver docblock de /strike).
        if (session.notes) {
            builder.text(`**${EMOJIS.messagesquare || '📝'} Observações (internas):** ${session.notes}`);
        }

        if (this.requiresSupervisorApproval(session, guild.id) && !(await this.memberHasSupervisorRole(guild, staffMember))) {
            builder.separator();
            builder.text(
                `${EMOJIS.shieldban || '🛡️'} **Requer aprovação de Supervisor**\n` +
                `Esta punição tem severidade Grave/Severa e/ou duração longa (>72h ou permanente). Como você não possui o cargo Supervisor (/config roles), ao confirmar o pedido será enviado para o canal de log de punições, marcando o cargo Supervisor — a punição só será aplicada depois de aprovada.`
            );
        }

        builder.footer(guild, 'Confirme ou cancele abaixo. Esta confirmação expira em 2 minutos.');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('punishment:confirm:confirm').setLabel('Confirmar').setStyle(ButtonStyle.Success).setEmoji(EMOJIS.circlecheck || '✅'),
            new ButtonBuilder().setCustomId('punishment:confirm:cancel').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji(EMOJIS.circlealert || '❌'),
        );

        const { components, flags } = builder.build();
        return { components: [...components, row], flags: [flags] };
    },

    async handleStrikeConfirmation(interaction, action) {
        const session = SessionManager.get(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending');
        if (!session) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Sessão expirada. Use /strike novamente.`, COLORS.ERROR, interaction.guild));
        }

        if (action === 'cancel') {
            SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending');
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Punição cancelada.`, COLORS.ERROR, interaction.guild));
        }
        
        if (action === 'confirm') {
            const guild = interaction.guild;
            const staff = interaction.user;
            const staffMember = interaction.member;

            // ── Punição severa (Nível 4/5) OU duração longa (>72h/permanente):
            // exige aprovação do cargo Supervisor, a menos que quem esteja
            // confirmando já SEJA o supervisor (fluxo normal nesse caso). Vale
            // pra qualquer tier — em servidores Free (sem níveis de severidade
            // relevantes) é a duração que decide sozinha. ────────────────────
            if (this.requiresSupervisorApproval(session, guild.id) && !(await this.memberHasSupervisorRole(guild, staffMember))) {
                SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending');
                return await this.requestSupervisorApproval(interaction, session);
            }

            const result = await this._executeStrike(guild, staff, session);
            SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending');

            if (!result.success) {
                return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} ${result.error}`, COLORS.ERROR, interaction.guild));
            }

            await interaction.editReply(this._simpleReply(this._buildStrikeSummaryLines(result, guild.id).join('\n'), COLORS.SUCCESS, interaction.guild));
        }
    },

    // ==================== APROVAÇÃO DE SUPERVISOR (PUNIÇÕES SEVERAS) ====================

    /**
     * Severidades Grave e Severa exigem aprovação do cargo Supervisor (ver
     * /config roles, aba Moderação) quando aplicadas por um Staff comum.
     * Servidores Free não têm nível/severidade (ver punishmentLevels.js,
     * bloqueado nesse tier) — `severity` vem null/undefined nesse caso.
     */
    isSevereSeverity(severity) {
        return ['grave', 'severa'].includes(String(severity || '').toLowerCase());
    },

    /**
     * Decide se uma punição precisa de aprovação de Supervisor.
     *
     * Plano Caçador COM nível selecionado: usa a flag configurada nesse
     * nível (ver /config punishments, botão Exigir/Dispensar Aprovação em
     * cada nível) — admin controla nível a nível, não é mais automático.
     *
     * Free/Rastreador (e Caçador sem nível, ex: /strike registro): regra
     * automática de sempre — severidade Grave/Severa OU duração >72h/
     * permanente. Free não tem nível de severidade, então na prática só a
     * duração importa lá.
     */
    requiresSupervisorApproval(session, guildId) {
        const PremiumSystem = require('../premium/premiumSystem');
        if (session.levelId && PremiumSystem.getGuildLimits(guildId).customPunishmentApprovalEnabled) {
            return !!session.levelRequiresApproval;
        }
        if (this.isSevereSeverity(session.levelSeverity)) return true;
        const durationStr = String(session.durationStr || '');
        const isPermanent = durationStr === '0' || durationStr.toLowerCase() === 'perm' || durationStr === '';
        if (isPermanent) return true;
        return this.parseDuration(durationStr) > 72 * 3600000;
    },

    async memberHasSupervisorRole(guild, member) {
        if (!member) return false;
        const ConfigSystem = require('../core/configSystem');
        return ConfigSystem.memberHasConfiguredRole(guild.id, member, 'supervisor_role');
    },

    /**
     * Envia o pedido de aprovação para o canal de log de punições, marcando
     * o cargo Supervisor, e avisa o staff que abriu o pedido. Os dados da
     * punição pendente ficam guardados no SessionManager sob uma chave
     * própria (não a do staff) — quem clicar Aprovar/Rejeitar é o
     * supervisor, um usuário diferente de quem pediu.
     */
    async requestSupervisorApproval(interaction, session) {
        const ConfigSystem = require('../core/configSystem');
        const guild = interaction.guild;
        const staff = interaction.user;

        let emojis = {};
        try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

        const supervisorRoleIds = ConfigSystem.getRoleIds(guild.id, 'supervisor_role');
        const logChannelId = ConfigSystem.getSetting(guild.id, 'log_punishments');

        if (supervisorRoleIds.length === 0 || !logChannelId) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} Esta punição é severa e precisa de aprovação de um Supervisor, mas o cargo Supervisor e/ou o canal de log de punições ainda não foram configurados (${EMOJIS.gavel || '⚖️'} veja /config roles e /config logs). Peça a um administrador para configurar antes de tentar novamente.`,
                COLORS.ERROR, guild,
            ));
        }

        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (!logChannel) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} O canal de log de punições configurado não foi encontrado. Peça a um administrador para reconfigurar em /config logs.`,
                COLORS.ERROR, guild,
            ));
        }

        const approvalId = db.generateUUID();
        SessionManager.set('approval', guild.id, 'strike_approval', approvalId, {
            ...session,
            requestedBy: staff.id,
            requestedByTag: staff.tag,
        }, 15 * 60 * 1000);

        const targetUser = await interaction.client.users.fetch(session.targetId).catch(() => null);
        const severityLabel = session.levelSeverity ? `${session.levelName} (${session.levelSeverity})` : 'Duração longa/permanente';

        const personalization = this._resolvePersonalization(guild.id);
        const approvalBuilder = new AdvancedContainerBuilder({ accentColor: personalization.accentColor ?? COLORS.DEFAULT });
        // targetUser pode vir null (fetch falhou — conta apagada, alvo só
        // identificado por AGID sem Discord vinculado alcançável, etc.):
        // um Section do Discord EXIGE um acessório (thumbnail OU botão),
        // não existe "section sem acessório" de verdade na API, então
        // passar `null` aqui derrubava o channel.send() inteiro com
        // "ExpectedValidationError > s.instance" (ButtonBuilder/
        // ThumbnailBuilder esperado, recebeu undefined) — sem nenhum aviso
        // pro staff, o pedido de aprovação simplesmente nunca saía.
        // Corrigido caindo no avatar padrão do Discord, mesmo fallback já
        // usado pro resto dos targetUser possivelmente-null neste arquivo
        // (ver linha ~458, buildStrikeConfirmPreview).
        approvalBuilder.section(
            [
                '# APROVAÇÃO NECESSÁRIA: PUNIÇÃO SEVERA',
                `${ConfigSystem.mentionRoles(guild.id, 'supervisor_role')} um Staff solicitou uma punição de nível **${severityLabel}**, que precisa de aprovação antes de ser aplicada.`,
            ].join('\n'),
            AdvancedContainerBuilder.thumbnail(targetUser?.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png'),
        );
        approvalBuilder.separator();
        approvalBuilder.text(`**${EMOJIS.user || '👤'} Solicitado por:** ${staff.toString()}`);
        approvalBuilder.text(`**${EMOJIS.user || '👤'} Alvo:** ${targetUser ? targetUser.toString() : `\`${session.targetId}\``}`);
        approvalBuilder.text(`${this.severityIconFor({ levelSeverity: session.levelSeverity })} **Nível:** ${severityLabel}`);
        if (PremiumSystem.getGuildLimits(guild.id).reputationEnabled) {
            approvalBuilder.text(`**${EMOJIS.doublearrowdown || '📉'} Pontos a perder:** -${session.pointsLost}`);
        }
        approvalBuilder.text(`**${EMOJIS.clockalert || '⏳'} Duração:** ${!session.durationStr || session.durationStr === '0' || session.durationStr?.toLowerCase() === 'perm' ? 'Permanente' : session.durationStr}`);
        approvalBuilder.separator();
        approvalBuilder.text(`**${EMOJIS.messagesquare || '📝'} Motivo:**\n\`\`\`text\n${session.reason}\n\`\`\``);
        if (session.notes) approvalBuilder.text(`**${EMOJIS.messagesquare || '📝'} Observações (internas):** ${session.notes}`);
        approvalBuilder.footer(guild, 'Apenas o cargo Supervisor pode aprovar ou rejeitar este pedido.');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`punishment:supervisor_approve:${approvalId}`).setLabel('Aprovar').setStyle(ButtonStyle.Success).setEmoji(emojis.circlecheck || '✅'),
            new ButtonBuilder().setCustomId(`punishment:supervisor_reject:${approvalId}`).setLabel('Rejeitar').setStyle(ButtonStyle.Danger).setEmoji(emojis.circlealert || '❌'),
        );

        const { components, flags } = approvalBuilder.build();
        await logChannel.send({ components: [...components, row], flags: [flags] });

        return await interaction.editReply(this._simpleReply(
            `${emojis.clockalert || '⏳'} Esta é uma punição **severa** (${severityLabel}). Como você não possui o cargo Supervisor, o pedido foi enviado para aprovação no canal de log de punições, marcando o cargo Supervisor. A punição só será aplicada depois que um Supervisor aprovar.`,
            COLORS.DEFAULT, guild,
        ));
    },

    /**
     * Clique de Aprovar/Rejeitar no pedido enviado a logs-punições.
     * @param {boolean} approved
     */
    async handleSupervisorApproval(interaction, approvalId, approved) {
        const guild = interaction.guild;

        if (!(await this.memberHasSupervisorRole(guild, interaction.member))) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Apenas o cargo Supervisor pode aprovar ou rejeitar punições severas.`, COLORS.ERROR, guild));
        }

        const session = SessionManager.get('approval', guild.id, 'strike_approval', approvalId);
        if (!session) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Este pedido de aprovação expirou ou já foi resolvido.`, COLORS.ERROR, guild));
        }
        SessionManager.delete('approval', guild.id, 'strike_approval', approvalId);

        const requester = await interaction.client.users.fetch(session.requestedBy).catch(() => null);

        if (!approved) {
            await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} Punição severa **rejeitada** por ${interaction.user}. O pedido de ${session.requestedByTag || session.requestedBy} não foi aplicado.`,
                COLORS.ERROR, guild,
            ));
            if (requester) {
                await requester.send(
                    `${EMOJIS.circlealert || '❌'} Seu pedido de punição severa contra \`${session.targetId}\` foi **rejeitado** por ${interaction.user.tag} em **${guild.name}**.`
                ).catch(() => {});
            }
            return;
        }

        // Aplica a punição com o staff original como responsável (moderator_id),
        // já que ele decidiu o caso — o supervisor só autorizou a execução.
        // approvedBy: pedido do dono, 2026-08-11 — "Punições aprovadas por
        // supervisores devem indicar no registro quem aprovou". Persistido
        // na própria punição (coluna approved_by), não só nesta resposta
        // efêmera.
        const originalStaff = requester || interaction.user;
        const result = await this._executeStrike(guild, originalStaff, session, { approvedById: interaction.user.id, approvedByTag: interaction.user.tag });

        if (!result.success) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} ${result.error}`, COLORS.ERROR, guild));
        }

        const summaryLines = this._buildStrikeSummaryLines(result, guild.id);
        summaryLines.unshift(`${EMOJIS.circlecheck || '✅'} **Aprovado por ${interaction.user.tag}**`);
        await interaction.editReply(this._simpleReply(summaryLines.join('\n'), COLORS.SUCCESS, guild));

        if (requester) {
            await requester.send(
                `${EMOJIS.circlecheck || '✅'} Seu pedido de punição severa contra ${result.targetUser?.tag || session.targetId} foi **aprovado** por ${interaction.user.tag} em **${guild.name}** e já foi aplicado (Strike #ID${result.strikeId}).`
            ).catch(() => {});
        }
    },

    /**
     * Aplica a ação em jogo (RCON) de um nível — SystemMessage/Kick/Ban/
     * ServerMute — extraído de dentro de _executeStrike (2026-08-14) pra
     * também ser chamado por /rcon-teste (comando de teste sem registro,
     * ver rcon-teste.js) SEM duplicar a montagem do comando, que precisa
     * ser EXATAMENTE a mesma da aplicação real (senão o teste não prova
     * nada sobre o comando de verdade). Sintaxe oficial de /ban do PoT
     * confirmada pelo dono, 2026-08-11:
     *   /ban <Jogador/AGID> <Duração> "<Motivo_Admin>" "<Motivo_Jogador>"
     * Aplicada também a ServerMute por analogia. Kick/SystemMessage não
     * têm duração nem motivo duplo na sintaxe oficial, mas ainda assim
     * entre aspas — evita quebrar o comando se o motivo tiver espaço.
     * Ban/ServerMute disparam ReloadBans/ReloadMutes em seguida (mexem em
     * listas persistentes do servidor — sem recarregar, o motivo só vale
     * a partir do próximo restart, visto em teste real).
     *
     * @param {object} params
     * @param {string} params.guildId
     * @param {string} params.jogoAct - 'SystemMessage'|'Kick'|'Ban'|'ServerMute'|'none'|null
     * @param {string|null} params.targetId - Discord ID, usado se alderonId não vier direto
     * @param {string|null} params.alderonId - AGID direto, tem prioridade sobre targetId
     * @param {string} params.durationStr
     * @param {string} params.reason - motivo que o JOGADOR vê
     * @param {string} params.levelName
     * @param {string} params.staffTag
     * @param {string|null} params.reportId
     * @param {string} params.actorMention - staff.toString(), pro log de RCON
     * @param {string} params.source - rótulo pro log de RCON (ex: '/strike', '/rcon-teste')
     * @returns {Promise<{ command: string|null, ingameActionResult: string|null }>}
     */
    async applyIngameAction({ guildId, jogoAct, targetId, alderonId, durationStr, reason, levelName, staffTag, reportId, actorMention, source }) {
        if (!jogoAct || jogoAct === 'none') return { command: null, ingameActionResult: null };
        if (!PremiumSystem.getGuildLimits(guildId).autoRcon) {
            return { command: null, ingameActionResult: 'Ação in-game requer o plano Rastreador.' };
        }

        const link = alderonId ? { alderon_id: alderonId } : getPlayerByDiscordId(targetId);
        if (!link) {
            return { command: null, ingameActionResult: 'Jogador não vinculado ao Path of Titans (/registrar) — ação in-game não executada.' };
        }

        try {
            const PoTConfigSystem = require('../pot/potConfigSystem');
            const durationLower = String(durationStr || '').toLowerCase();
            // Permanente no RCON do PoT é "0" (confirmado pelo dono) — "perm" não é
            // reconhecido pelo servidor, o comando ficava sem efeito nenhum (nem
            // erro, só silenciosamente ignorado).
            const durationToken = durationLower === '' || durationLower === '0' || durationLower === 'perm' ? '0' : durationStr;
            const playerReason = sanitizeForRcon(reason, 120);
            const adminReason = buildAdminReasonLabel({ levelName, staffTag, reportId });
            const rconCommands = {
                SystemMessage: `SystemMessage ${link.alderon_id} "${playerReason}"`,
                Kick: `kick ${link.alderon_id} "${playerReason}"`,
                Ban: `ban ${link.alderon_id} ${durationToken} "${adminReason}" "${playerReason}"`,
                ServerMute: `ServerMute ${link.alderon_id} ${durationToken} "${adminReason}" "${playerReason}"`,
            };
            const command = rconCommands[jogoAct];
            if (!command) {
                return { command: null, ingameActionResult: `Ação in-game "${jogoAct}" desconhecida.` };
            }

            const rconResult = await PoTConfigSystem.executeRconCommand(guildId, command, { actor: actorMention, source });
            let ingameActionResult = rconResult?.success
                ? 'Ação in-game executada.'
                : `Falha na ação in-game: ${rconResult?.error || 'erro desconhecido'}`;

            // ── Ban/ServerMute mexem em listas persistentes do servidor
            // (banlist/mutelist) — SEM recarregar, o jogador é banido/mutado
            // mas o servidor não relê o motivo até o próximo restart do
            // servidor. ──────────────────────────────────────────────────
            if (rconResult?.success && (jogoAct === 'Ban' || jogoAct === 'ServerMute')) {
                const reloadCommand = jogoAct === 'Ban' ? 'ReloadBans' : 'ReloadMutes';
                const reloadResult = await PoTConfigSystem.executeRconCommand(guildId, reloadCommand, { actor: actorMention, source }).catch((err) => ({ success: false, error: err.message }));
                if (!reloadResult?.success) {
                    ingameActionResult += ` ${EMOJIS.trianglealert || '⚠️'} ${reloadCommand} falhou (${reloadResult?.error || 'erro desconhecido'}) — o jogador pode não ver o motivo até o próximo restart do servidor.`;
                }
            }

            return { command, ingameActionResult };
        } catch (err) {
            return { command: null, ingameActionResult: `Falha na ação in-game: ${err.message}` };
        }
    },

    /**
     * Desfaz Ban/ServerMute (unban/ServerUnmute + reload) — extraído de
     * dentro de handleUnstrikeConfirmation (2026-08-14) pro botão
     * "Desfazer" de /rcon-teste reaproveitar a MESMA lógica: sem punição
     * registrada, não há como usar /unstrike pra desfazer um teste que
     * deu errado (ver rcon-teste.js) — este é o único outro caminho que
     * o bot expõe pra unban/ServerUnmute (ver docblock de /ingame-comandos,
     * que exclui esses comandos de propósito da família /ingame-* geral).
     *
     * @param {object} params
     * @param {string} params.guildId
     * @param {string} params.levelAction - 'Ban'|'ServerMute' (qualquer outro valor não faz nada)
     * @param {string} params.alderonId - já resolvido pelo chamador (cada um tem sua própria fonte, ver handleUnstrikeConfirmation)
     * @param {string} params.actorMention
     * @param {string} params.source
     * @returns {Promise<{ command: string|null, ingameUndoResult: string|null }>}
     */
    async undoIngameAction({ guildId, levelAction, alderonId, actorMention, source }) {
        if (levelAction !== 'Ban' && levelAction !== 'ServerMute') return { command: null, ingameUndoResult: null };
        if (!PremiumSystem.getGuildLimits(guildId).autoRcon) {
            return { command: null, ingameUndoResult: 'Ação in-game requer o plano Rastreador — não desfeita automaticamente.' };
        }
        if (!alderonId) {
            return { command: null, ingameUndoResult: 'Jogador não vinculado ao Path of Titans — ação in-game não desfeita.' };
        }

        try {
            const PoTConfigSystem = require('../pot/potConfigSystem');
            const isBan = levelAction === 'Ban';
            const undoCommand = isBan ? `unban ${alderonId}` : `ServerUnmute ${alderonId}`;
            const rconResult = await PoTConfigSystem.executeRconCommand(guildId, undoCommand, { actor: actorMention, source });
            let ingameUndoResult = rconResult?.success
                ? 'Ação in-game desfeita.'
                : `Falha ao desfazer ação in-game: ${rconResult?.error || 'erro desconhecido'}`;
            if (rconResult?.success) {
                const reloadCommand = isBan ? 'ReloadBans' : 'ReloadMutes';
                const reloadResult = await PoTConfigSystem.executeRconCommand(guildId, reloadCommand, { actor: actorMention, source }).catch((err) => ({ success: false, error: err.message }));
                if (!reloadResult?.success) {
                    ingameUndoResult += ` ${EMOJIS.trianglealert || '⚠️'} ${reloadCommand} falhou (${reloadResult?.error || 'erro desconhecido'}).`;
                }
            }
            return { command: undoCommand, ingameUndoResult };
        } catch (err) {
            return { command: null, ingameUndoResult: `Falha ao desfazer ação in-game: ${err.message}` };
        }
    },

    /**
     * Núcleo compartilhado da aplicação de um strike: grava a punição,
     * vincula ao report (se houver), aplica ação no Discord, aplica cargo
     * temporário, registra atividade/analytics, envia DM ao alvo e log ao
     * canal configurado. Usado tanto pela confirmação direta (staff comum
     * em punição leve/moderada, ou Supervisor em qualquer nível) quanto pela
     * aprovação de punição severa (ver requestSupervisorApproval).
     *
     * @param {import('discord.js').Guild} guild
     * @param {import('discord.js').User} staff - Creditado como moderator_id
     * @param {object} session - { targetId, reason, levelId, levelName, levelSeverity, levelAction, durationStr, reportId, jogoAct, pointsLost, alderonId, notes }
     * @param {{ approvedById?: string, approvedByTag?: string }} [approvalInfo] - preenchido só quando esta execução veio de uma aprovação de Supervisor (ver handleSupervisorApproval)
     * @returns {Promise<object>} resultado com { success, error } ou os dados usados no resumo
     */
    async _executeStrike(guild, staff, session, approvalInfo = null) {
        const ConfigSystem = require('../core/configSystem');
        const AnalyticsSystem = require('./analyticsSystem');

        let emojis = {};
        try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

        const { targetId, reason, levelId, levelName, levelSeverity, levelAction, durationStr, reportId, jogoAct, pointsLost, alderonId, targetPlayerName, noteText, notes } = session;

        // Alvo sem conta Discord conhecida (ver UNREGISTERED_TARGET_PREFIX) —
        // não tem User/Member real pra buscar, monta um "usuário" sintético só
        // pra exibição/log. Ação em jogo usa `alderonId` diretamente (abaixo),
        // nunca depende desse objeto; ações no Discord e DM ficam
        // indisponíveis (sem membro real pra aplicar/notificar) — já tratado
        // pelos `targetMember` checks existentes mais abaixo.
        const isUnregisteredTarget = this._isUnregisteredTargetId(targetId);
        let targetUser;
        if (isUnregisteredTarget) {
            const displayName = targetPlayerName || alderonId;
            targetUser = {
                id: targetId,
                username: displayName,
                tag: displayName,
                toString: () => `${displayName} \`${alderonId}\` (sem Discord vinculado)`,
                displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
            };
        } else {
            targetUser = await guild.client.users.fetch(targetId).catch(() => null);
            if (!targetUser) {
                return { success: false, error: 'Usuário não encontrado.' };
            }
        }

        const targetMember = isUnregisteredTarget ? null : await guild.members.fetch(targetId).catch(() => null);

        const currentRep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guild.id, targetId)?.points || 100;
        const newPoints = Math.max(0, currentRep - pointsLost);

        const durationLower = String(durationStr || '').toLowerCase();
        let durationMs = 0;
        if (durationLower !== '0' && durationLower !== 'perm' && durationLower !== '') {
            durationMs = this.parseDuration(durationStr);
        }

        const levelSnapshot = levelId ? { id: levelId, name: levelName, severity: levelSeverity, action: levelAction, durationStr } : null;
        const strikeId = this.applyPunishment(guild.id, targetId, staff.id, reason, levelSnapshot, reportId || null, pointsLost, alderonId || null, notes || null, approvalInfo?.approvedById || null);
        if (!strikeId) {
            return { success: false, error: 'Erro ao aplicar punição no banco de dados.' };
        }

        // ── Fecha o vínculo report ↔ punição: se o strike referenciou um
        // report (já validado no subcomando de /strike que chamou isto),
        // grava a punição aplicada de volta no próprio report para consulta
        // futura. Também resolve reportLink (pedido do dono, 2026-08-09:
        // "Punição criada só anota o ID do reporte informado, ele deve
        // informar o link que leva até a mensagem do report que esta no
        // painel de logs") — generateStrikeUnifiedContainer já sabia
        // renderizar reportId como link clicável (ver linha ~292), só
        // nunca recebia um reportLink de verdade daqui (sempre `null`).
        // Resolvido on-the-fly (canal de log ATUAL + log_message_id salvo
        // em reports na abertura, ver reportChatSystem.openReport/
        // openPunishmentReview) em vez de guardado junto à punição — mesmo
        // padrão do link de thread em createBaseContainer, que também
        // remonta a URL a partir do id salvo em vez de armazenar a URL
        // pronta. Fica null (sem virar link) se o report não tiver
        // log_message_id ainda ou se log_reports não estiver configurado —
        // reportId continua aparecendo como texto puro nesses casos. ──────
        let reportLink = null;
        if (reportId) {
            // Aceita #REP (novo, pedido do dono 2026-08-09) e #R (antigo) —
            // reportId aqui pode ter vindo de session.reportId, já sempre no
            // formato novo (ver strike/index.js validateReport), mas mantém
            // os dois por segurança/consistência com o resto do sistema.
            const linkedReportNumber = parseInt(String(reportId).replace(/^#?(REP|R)/i, ''));
            if (!isNaN(linkedReportNumber)) {
                db.prepare(`UPDATE reports SET punishment = ? WHERE guild_id = ? AND report_number = ?`)
                    .run(`Strike #ID${strikeId}${levelName ? ` (${levelName})` : ''}`, guild.id, linkedReportNumber);

                const reportRow = db.prepare(`SELECT log_message_id FROM reports WHERE guild_id = ? AND report_number = ?`)
                    .get(guild.id, linkedReportNumber);
                const reportLogChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
                if (reportRow?.log_message_id && reportLogChannelId) {
                    reportLink = `https://discord.com/channels/${guild.id}/${reportLogChannelId}/${reportRow.log_message_id}`;
                }
            }
        }

        const roleResult = await this.applyTemporaryRole(guild, targetMember, durationMs);

        // ── Ação in-game automática via RCON — a partir do Rastreador (ver
        // premiumSystem.js, GUILD_LIMITS.autoRcon). Montagem do comando/envio/
        // reload extraídos pra applyIngameAction (2026-08-14) — reaproveitado
        // por /rcon-teste, ver docblock do método. ──────────────────────────
        const { ingameActionResult } = await this.applyIngameAction({
            guildId: guild.id, jogoAct, targetId, alderonId, durationStr, reason,
            levelName, staffTag: staff.tag, reportId, actorMention: staff.toString(), source: '/strike',
        });

        db.logActivity(guild.id, staff.id, 'strike', targetId, {
            command: 'strike', punishmentId: strikeId, levelName, levelSeverity, pointsLost,
            oldPoints: currentRep, newPoints, reason, duration: durationStr, jogoAct,
            temporaryRoleApplied: roleResult.applied, ingameActionResult, approvedBy: approvalInfo?.approvedById || null,
        });

        await AnalyticsSystem.updateStaffAnalytics(guild.id, staff.id);

        const containerBuilder = await this.generateStrikeUnifiedContainer(
            guild.client, targetUser, staff, strikeId, levelName, levelSeverity, reason, reportId || null,
            pointsLost, newPoints, guild.name, reportLink, guild.id,
            jogoAct, ingameActionResult, approvalInfo?.approvedByTag || null
        );
        const { components, flags, files: filesPayload } = containerBuilder.build();

        let dmDelivered = false;
        if (targetMember) {
            try {
                await targetMember.send({ components, flags: [flags], files: filesPayload });
                dmDelivered = true;
            } catch (err) {
                dmDelivered = false;
            }
        }

        let logSent = false;
        const logChannelId = ConfigSystem.getSetting(guild.id, 'log_punishments');
        if (logChannelId) {
            try {
                const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                if (logChannel) {
                    await logChannel.send({ components, flags: [flags], files: filesPayload });
                    logSent = true;
                }
            } catch (err) {
                // Antes engolia o erro por completo (catch (err) {} vazio) —
                // logSent ficava false mas ninguém, nem o staff nem o
                // servidor de logs, sabia POR QUE (permissão faltando,
                // canal apagado, payload rejeitado etc.). Loga via
                // ErrorLogger (mesmo sink central de erro do resto do bot)
                // sem propagar — falha aqui não pode derrubar o strike em
                // si, que já foi aplicado com sucesso antes deste bloco.
                ErrorLogger.error('punishment', '_executeStrike:logChannel.send', err, { guildId: guild.id, logChannelId });
            }
        }

        // Observações internas (notes) NUNCA vão pro canal de "log_punishments"
        // (revertido — pedido do dono, 2026-08-13, MESMO dia da tentativa
        // anterior: "muitos servidores estão usando o canal de log de
        // forma publica para players", então qualquer coisa "interna"
        // postada ali de fato vaza pro público em boa parte dos
        // servidores reais, mesmo não indo pra DM). Em vez disso, manda
        // um card PRÓPRIO e compacto (nunca reaproveitando o container do
        // jogador) só pro canal 'log_staff' — configurado à parte em
        // /config logs, genuinamente staff-only por convenção deste bot
        // (mesmo canal já usado por analyticsSystem.js/guildMemberUpdate.js
        // pra conteúdo sensível de staff). Sem log_staff configurado, a
        // observação continua só no registro (banco/`/historico`/prévia de
        // confirmação) — nunca cai de volta no canal público por padrão.
        const notesLogSent = notes ? await this._sendStrikeNotesToStaffLog(guild, targetUser, staff, strikeId, notes) : null;

        const roleStatusMsg = roleResult.applied
            ? `${emojis.gavel || '⚠️'} Cargo de Strike aplicado temporariamente.`
            : (roleResult.error ? `${emojis.messagesquare || 'ℹ️'} Cargo de Strike não aplicado: ${roleResult.error}` : null);

        return {
            success: true, strikeId, targetUser, pointsLost, newPoints,
            dmDelivered, logSent, roleStatusMsg, ingameActionResult, isUnregisteredTarget, noteText,
            notesLogSent,
        };
    },

    /**
     * Manda um card COMPACTO e PRÓPRIO (nunca reaproveita o container do
     * jogador/log de punições) com as observações internas de um strike
     * pro canal 'log_staff' — ver comentário completo em _executeStrike
     * sobre por que essa nota não pode ir pro 'log_punishments' (muitos
     * servidores usam esse canal publicamente pros próprios jogadores).
     * @returns {boolean} true se entregue; false se não entregue (sem
     *   'log_staff' configurado, canal apagado, ou falha no envio) —
     *   NUNCA lança, falha aqui não pode derrubar o strike em si.
     */
    async _sendStrikeNotesToStaffLog(guild, targetUser, staff, strikeId, notes) {
        try {
            // ConfigSystem não é require top-level neste arquivo (só local,
            // por método — mesmo padrão do resto do arquivo, ver linhas
            // ~273/614/626/779/1268) — esquecer esse require aqui faz
            // ConfigSystem virar ReferenceError, engolido pelo catch abaixo
            // (retorna false silenciosamente, sem enviar nada nem avisar
            // por quê — bug real encontrado durante o teste desta função).
            const ConfigSystem = require('../core/configSystem');
            const staffLogChannelId = ConfigSystem.getSetting(guild.id, 'log_staff');
            if (!staffLogChannelId) return false;
            const staffLogChannel = await guild.channels.fetch(staffLogChannelId).catch(() => null);
            if (!staffLogChannel) return false;

            const personalization = this._resolvePersonalization(guild.id);
            const builder = new AdvancedContainerBuilder({ accentColor: personalization.accentColor ?? COLORS.DEFAULT });
            builder.text(`## ${EMOJIS.messagesquare || '📝'} Observações internas — Strike #ID${strikeId}`, 2);
            builder.text(`**Jogador:** ${targetUser}\n**Staff responsável:** ${staff}`);
            builder.separator();
            builder.text(notes);
            builder.footer({ id: guild.id, name: guild.name });
            await staffLogChannel.send(builder.build());
            return true;
        } catch (err) {
            ErrorLogger.error('punishment', '_executeStrike:staffLogChannel.send', err, { guildId: guild.id });
            return false;
        }
    },

    _buildStrikeSummaryLines(result, guildId) {
        let emojis = {};
        try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

        const dmStatusMsg = result.dmDelivered
            ? `${emojis.circlecheck || '✅'} O jogador foi notificado em sua DM.`
            : result.isUnregisteredTarget
                ? `${emojis.messagesquare || 'ℹ️'} Jogador sem conta Discord identificada — não recebeu DM.`
                : `${emojis.circlealert || '❌'} O jogador tem as DM bloqueadas e não recebeu a notificação do strike.`;

        const lines = [
            `${emojis.circlecheck || '✅'} **Strike #ID${result.strikeId} aplicado em ${result.targetUser.username}**`,
        ];
        if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
            lines.push(`${emojis.doublearrowdown || '📉'} ${result.pointsLost} pts perdidos`);
            lines.push(`${emojis.star || '⭐'} Reputação: ${result.newPoints}/100`);
        }
        if (result.noteText) lines.push(`${emojis.trianglealert || '⚠️'} ${result.noteText}`);
        lines.push(dmStatusMsg);
        if (result.roleStatusMsg) lines.push(result.roleStatusMsg);
        if (result.ingameActionResult) lines.push(`${emojis.game || '🎮'} ${result.ingameActionResult}`);
        if (!result.logSent) lines.push(`${emojis.trianglealert || '⚠️'} A mensagem de log não foi enviada ao canal (verifique a configuração em /config logs).`);
        // notesLogSent: null quando não havia observações (não é erro
        // nenhum, nada pra reportar); false só quando HAVIA observação mas
        // não foi possível entregar (log_staff ausente/apagado/sem
        // permissão) — staff precisa saber que a nota ficou só no registro.
        if (result.notesLogSent === false) {
            lines.push(`${emojis.trianglealert || '⚠️'} Observações internas não enviadas a nenhum canal (configure um canal de log de Staff em /config logs) — continuam salvas no registro e no /historico.`);
        } else if (result.notesLogSent === true) {
            lines.push(`${emojis.circlecheck || '✅'} Observações internas enviadas ao canal de log de Staff.`);
        }
        return lines;
    },

    async handleUnstrikeConfirmation(interaction, action) {
        const session = SessionManager.get(interaction.user.id, interaction.guildId, 'unstrike_pending', 'unstrike_pending');
        if (!session) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Sessão expirada. Use /unstrike novamente.`, COLORS.ERROR, interaction.guild));
        }

        if (action === 'cancel') {
            SessionManager.delete(interaction.user.id, interaction.guildId, 'unstrike_pending', 'unstrike_pending');
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Anulação cancelada.`, COLORS.ERROR, interaction.guild));
        }

        if (action === 'confirm') {
            const ConfigSystem = require('../core/configSystem');
            const AnalyticsSystem = require('./analyticsSystem');

            let emojis = {};
            try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

            const { punishmentId, reason } = session;
            const guild = interaction.guild;
            const guildId = interaction.guildId;
            const staff = interaction.user;

            // ── Busca por strike_number (o número mostrado como "Strike #N"),
            // não pela PK global `id` — ver mesmo comentário em unstrike.js. ────
            const punishment = db.prepare(`SELECT * FROM punishments WHERE strike_number = ? AND guild_id = ? AND status = 'active'`).get(punishmentId, guildId);
            if (!punishment) {
                SessionManager.delete(interaction.user.id, guildId, 'unstrike_pending', 'unstrike_pending');
                return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Punição não encontrada ou já anulada.`, COLORS.ERROR, interaction.guild));
            }

            const targetMember = await guild.members.fetch(punishment.user_id).catch(() => null);

            // ── Usa o valor REAL gravado na punição (points_deducted), não um
            // mapa fixo — garante que a devolução bate com o que foi de fato
            // descontado, mesmo se os pontos de severidade tiverem sido
            // reconfigurados depois em /config punishments. ────────────────────
            const pointsRestored = punishment.points_deducted || 0;
            const currentRep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, punishment.user_id)?.points || 100;
            const newPoints = Math.min(100, currentRep + pointsRestored);

            db.prepare(`UPDATE punishments SET status = 'revoked', revoked_by = ?, revoked_reason = ?, revoked_at = ?
                WHERE id = ? AND guild_id = ?`).run(staff.id, reason, Date.now(), punishment.id, guildId);
            // Free não deduziu pontos ao aplicar (ver applyPunishment), então
            // não há nada a restaurar aqui também.
            if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
                db.prepare(`UPDATE reputation SET points = MIN(100, points + ?) WHERE guild_id = ? AND user_id = ?`)
                    .run(pointsRestored, guildId, punishment.user_id);
            }

            const strikeRoleId = ConfigSystem.getSetting(guildId, 'strike_role');
            if (strikeRoleId && targetMember?.roles.cache.has(strikeRoleId)) {
                try {
                    await targetMember.roles.remove(strikeRoleId, `Punição #ID${punishmentId} anulada`);
                } catch (err) {}
            }
            if (targetMember?.communicationDisabledUntilTimestamp) {
                try {
                    await targetMember.timeout(null, `Punição #ID${punishmentId} anulada`);
                } catch (err) {}
            }

            // ── Desfaz a ação EM JOGO, se a punição original tinha uma
            // (Ban/ServerMute via RCON) — antes disso, /unstrike não mexia
            // em nada no jogo, então um jogador banido/mutado continuava
            // assim mesmo depois de anulado no Discord. Montagem do comando/
            // envio/reload extraídos pra undoIngameAction (2026-08-14) —
            // reaproveitado pelo botão "Desfazer" de /rcon-teste, ver
            // docblock do método. Falha de RCON aqui NÃO bloqueia o resto
            // do unstrike (o banco/Discord já são a fonte da verdade). ──────
            // Prioridade 1: o AGID gravado NA PRÓPRIA punição (coluna
            // alderon_id, ver ensureColumn em database/index.js) — o valor
            // EXATO usado na ação em jogo original, sempre presente em
            // punições aplicadas a partir desta revisão. Sem isso (punição
            // legada, coluna null), cai no melhor-esforço antigo: alvo sem
            // vínculo Discord (ver UNREGISTERED_TARGET_PREFIX) guarda o AGID
            // direto no user_id; alvo normal tenta o vínculo GLOBAL ATUAL —
            // que pode já não bater com o AGID realmente punido (causa raiz
            // original do bug "unstrike não remove ban/mute", pedido do
            // dono 2026-08-11), mas é o único dado que ainda existe pra
            // punições antigas.
            const undoAlderonId = punishment.alderon_id
                || (this._isUnregisteredTargetId(punishment.user_id)
                    ? punishment.user_id.slice(UNREGISTERED_TARGET_PREFIX.length)
                    : getPlayerByDiscordId(punishment.user_id)?.alderon_id);
            const { ingameUndoResult } = await this.undoIngameAction({
                guildId, levelAction: punishment.level_action, alderonId: undoAlderonId,
                actorMention: staff.toString(), source: '/unstrike',
            });

            db.logActivity(guildId, staff.id, 'unstrike', punishment.user_id, {
                command: 'unstrike', punishmentId, pointsRestored, oldPoints: currentRep, newPoints, ingameUndoResult
            });

            await AnalyticsSystem.updateStaffAnalytics(guildId, staff.id);

            const targetUser = await interaction.client.users.fetch(punishment.user_id).catch(() => null);
            const containerBuilder = await this.generateUnstrikeUnifiedContainer(
                interaction.client, targetUser, staff, punishmentId, reason, pointsRestored, newPoints, punishment.reason, guild.name, guildId
            );
            const { components, flags, files: filesPayload } = containerBuilder.build();

            let dmDelivered = false;
            if (targetUser) {
                try {
                    await targetUser.send({ components, flags: [flags], files: filesPayload });
                    dmDelivered = true;
                } catch (err) {
                    dmDelivered = false;
                }
            }

            let logSent = false;
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_punishments');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        await logChannel.send({ components, flags: [flags], files: filesPayload });
                        logSent = true;
                    }
                } catch (err) {}
            }

            const dmStatusMsg = dmDelivered
                ? `${emojis.circlecheck || '✅'} O jogador foi notificado em sua DM.`
                : `${emojis.circlealert || '❌'} O jogador tem as DM bloqueadas e não recebeu a notificação da anulação.`;

            const summaryLines = [
                `${emojis.circlecheck || '✅'} **Strike #ID${punishmentId} anulado!**`,
            ];
            if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
                summaryLines.push(`${emojis.doublearrowup || '📈'} +${pointsRestored} pts | ${emojis.star || '⭐'} Reputação: ${newPoints}/100`);
            }
            summaryLines.push(dmStatusMsg);
            if (ingameUndoResult) summaryLines.push(`${emojis.game || '🎮'} ${ingameUndoResult}`);
            if (!logSent) summaryLines.push(`${emojis.trianglealert || '⚠️'} A mensagem de log não foi enviada ao canal (verifique a configuração em /config logs).`);

            SessionManager.delete(interaction.user.id, interaction.guildId, 'unstrike_pending', 'unstrike_pending');
            await interaction.editReply(this._simpleReply(summaryLines.join('\n'), COLORS.SUCCESS, interaction.guild));
        }
    },

    /**
     * Botão "↩️ Desfazer" anexado à resposta de /rcon-teste (customId
     * `punishment:undo-rcon-test:<Ban|ServerMute>:<alderonId>`, ver
     * rcon-teste.js) — único jeito de reverter um ban/mute de TESTE, já
     * que ele não cria punição nenhuma pra /unstrike referenciar (ver
     * docblock de undoIngameAction). Reconfirma Administrador de verdade
     * no próprio clique — nunca confia em quem já viu o botão renderizado,
     * mesmo padrão de qualquer outro botão sensível deste bot.
     */
    async handleUndoRconTest(interaction, param) {
        const ConfigSystem = require('../core/configSystem');
        if (!ConfigSystem.memberIsGuildAdmin(interaction.guildId, interaction.member)) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Este botão é restrito a Administradores do servidor.`, COLORS.ERROR, interaction.guild));
        }

        const [levelAction, alderonId] = String(param || '').split(':');
        if (!levelAction || !alderonId) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Dados do botão inválidos.`, COLORS.ERROR, interaction.guild));
        }

        const { ingameUndoResult } = await this.undoIngameAction({
            guildId: interaction.guildId, levelAction, alderonId,
            actorMention: interaction.user.toString(), source: '/rcon-teste (desfazer)',
        });

        // Mesmo padrão de handleStrikeConfirmation/handleUnstrikeConfirmation
        // acima: SUBSTITUI a mensagem original inteira por um resumo de 1
        // linha via _simpleReply/editReply (a interação já chega aqui
        // deferida via deferUpdate() genérico em interactionCreate.js) — sem
        // precisar tocar em interaction.message.components pra "preservar"
        // o botão, que quebraria em Components V2 (o botão fica ANINHADO
        // dentro do Container, não é um ActionRow solto no topo — ver
        // containerBuilder.js build()).
        const color = ingameUndoResult === 'Ação in-game desfeita.' ? COLORS.SUCCESS : COLORS.ERROR;
        await interaction.editReply(this._simpleReply(`${EMOJIS.game || '🎮'} ${ingameUndoResult || 'Nada a desfazer.'}`, color, interaction.guild));
    },

    // ==================== MÉTODOS DE NEGÓCIO ====================

    /**
     * Atribui o cargo temporário de Strike (configurado via /config roles,
     * chave 'strike_role') ao membro punido, e registra a expiração na
     * tabela temporary_roles para remoção automática pelo worker (initWorker).
     * Recurso do plano Rastreador+ (ver PremiumSystem.GUILD_LIMITS.
     * temporaryRoleEnabled) — em Free não aplica, mas ainda avisa o motivo
     * (mesmo padrão de jogoAct, que também avisa "requer plano X"
     * em vez de falhar silenciosamente).
     *
     * Se durationMs <= 0 (punição permanente / "0" / "perm"), o cargo NÃO é
     * aplicado como temporário — a tabela temporary_roles existe apenas para
     * controlar remoções automáticas, então punição permanente não deveria
     * inserir um registro que nunca expira por design.
     *
     * @param {object} guild        - Guild do discord.js
     * @param {object} targetMember - GuildMember do discord.js (já buscado)
     * @param {number} durationMs   - Duração da punição em ms (0 = permanente)
     * @returns {Promise<{ applied: boolean, roleId: string|null, expiresAt: number|null, error: string|null }>}
     */
    async applyTemporaryRole(guild, targetMember, durationMs) {
        const ConfigSystem = require('../core/configSystem');

        if (!PremiumSystem.getGuildLimits(guild.id).temporaryRoleEnabled) {
            return { applied: false, roleId: null, expiresAt: null, error: 'Cargo temporário de Strike requer o plano Rastreador.' };
        }

        const strikeRoleId = ConfigSystem.getSetting(guild.id, 'strike_role');

        if (!strikeRoleId) {
            return { applied: false, roleId: null, expiresAt: null, error: 'Cargo de Strike não configurado (config-roles).' };
        }

        if (!targetMember) {
            return { applied: false, roleId: strikeRoleId, expiresAt: null, error: 'Membro não está no servidor.' };
        }

        if (!durationMs || durationMs <= 0) {
            // Punição permanente: não aplica cargo temporário (sem expiração definida).
            return { applied: false, roleId: strikeRoleId, expiresAt: null, error: null };
        }

        try {
            const role = await guild.roles.fetch(strikeRoleId).catch(() => null);
            if (!role) {
                return { applied: false, roleId: strikeRoleId, expiresAt: null, error: 'Cargo configurado não existe mais no servidor.' };
            }

            await targetMember.roles.add(strikeRoleId, 'Cargo temporário de Strike aplicado');

            const expiresAt = Date.now() + durationMs;
            db.prepare(`
                INSERT INTO temporary_roles (guild_id, user_id, role_id, expires_at)
                VALUES (?, ?, ?, ?)
            `).run(guild.id, targetMember.id, strikeRoleId, expiresAt);

            return { applied: true, roleId: strikeRoleId, expiresAt, error: null };
        } catch (error) {
            console.error('❌ Erro ao aplicar cargo temporário de Strike:', error);
            return { applied: false, roleId: strikeRoleId, expiresAt: null, error: error.message };
        }
    },

    parseDuration(durationStr) {
        if (!durationStr || ['0', 'perm'].includes(durationStr.toLowerCase())) return 0;
        const timeValue = parseInt(durationStr);
        const type = durationStr.slice(-1).toLowerCase();
        const multipliers = { 'm': 60000, 'h': 3600000, 'd': 86400000 };
        return (multipliers[type] || 3600000) * timeValue;
    },
    
    /**
     * @param {object|null} levelSnapshot - { id, name, severity, action, durationStr } ou null (Free,
     *   sem conceito de nível). Congelado no momento do strike — editar o nível depois não reescreve
     *   punições já aplicadas (ver punishment_levels em schema.js). `severity` (coluna numérica antiga)
     *   sempre grava 0 (sentinela) em linhas novas; o texto vive em level_severity.
     * @param {string|null} [alderonId] - Alderon ID de fato usado na ação em jogo (RCON) deste strike,
     *   se houver (ver docblock de ensureColumn('punishments','alderon_id') em database/index.js) —
     *   permite ao /unstrike desfazer a ação exata que foi aplicada, sem precisar re-adivinhar o AGID.
     */
    applyPunishment(guildId, targetId, moderatorId, reason, levelSnapshot, reportId, points, alderonId = null, notes = null, approvedBy = null) {
        try {
            const trans = db.transaction(() => {
                const maxStrike = db.prepare(`
                    SELECT MAX(strike_number) as max FROM punishments WHERE guild_id = ?
                `).get(guildId);
                const strikeNumber = (maxStrike?.max || 0) + 1;

                const uuid = require('../../database/index').generateUUID();

                db.prepare(`
                    INSERT INTO punishments (uuid, guild_id, strike_number, user_id, moderator_id, reason, severity, points_deducted, report_id, created_at, status, level_id, level_name, level_severity, level_action, duration_str, alderon_id, notes, approved_by)
                    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    uuid, guildId, strikeNumber, targetId, moderatorId, reason, points, reportId, Date.now(), 'active',
                    levelSnapshot?.id || null, levelSnapshot?.name || null, levelSnapshot?.severity || null,
                    levelSnapshot?.action || null, levelSnapshot?.durationStr || null, alderonId || null,
                    notes || null, approvedBy || null,
                );

                // Sistema de pontos de reputação é recurso Pegada+ — em
                // servidores Free a punição fica registrada, mas os pontos
                // não são calculados/salvos (decisão do dono).
                if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
                    db.prepare(`
                        INSERT INTO reputation (guild_id, user_id, points) VALUES (?, ?, 100)
                        ON CONFLICT(guild_id, user_id) DO UPDATE SET points = MAX(0, points - ?)
                    `).run(guildId, targetId, points);
                }

                return strikeNumber;
            });
            return trans();
        } catch (error) {
            console.error('❌ Erro ao aplicar punição:', error);
            return null;
        }
    },
    
    initWorker(client) {
        console.log('⚖️ [Worker] Sistema de Punições Ativo');
        global.client = client;
        
        setInterval(async () => {
            try {
                const now = Date.now();
                const expiredRoles = db.prepare(`SELECT * FROM temporary_roles WHERE expires_at <= ?`).all(now);
                for (const entry of expiredRoles) {
                    const guild = client.guilds.cache.get(entry.guild_id);
                    if (guild) {
                        try {
                            const member = await guild.members.fetch(entry.user_id);
                            await member.roles.remove(entry.role_id, "Strike Expirado");
                        } catch (err) {}
                    }
                    db.prepare(`DELETE FROM temporary_roles WHERE id = ?`).run(entry.id);
                }
            } catch (error) {
                console.error('❌ Erro no worker:', error);
            }
        }, 30000);
    }
};

module.exports = PunishmentSystem;