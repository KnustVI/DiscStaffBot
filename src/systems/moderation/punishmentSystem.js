// /home/ubuntu/DiscStaffBot/src/systems/moderation/punishmentSystem.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
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
        let accentColor = COLORS.DEFAULT;
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
                builder.text(`${severityIcon} Strike #${strikeNum}${p.level_name ? ` (${p.level_name})` : ''} | ${date}`);
                builder.text(`┃ Moderador: <@${p.moderator_id}>`);
                if (p.report_id) builder.text(`┃ Report: \`${p.report_id}\``);
                if (p.status === 'revoked') builder.text(`┃ Status: ${EMOJIS.circlecheck || '✅'} Anulado`);
                builder.separator();
            }
        } else {
            builder.text(`\`\`\`\nNenhuma punição registrada.\n\`\`\``);
        }
        
        builder.footer(guildName);

        return builder;
    },

    generateStrikeUnifiedContainer(target, moderator, strikeNumber, levelName, levelSeverity, reason, reportId, pointsLost, newPoints, discordAct, discordActionResult, guildName, reportLink, guildId, jogoAct, ingameActionResult) {
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });
        builder.banner('title_strike');

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
        builder.text(`## ${EMOJIS.ban || '❌'} STRIKE | ***#${strikeNumber}***`, 1);
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

        const actions = this.getPunishmentActions(jogoAct, ingameActionResult, discordAct, discordActionResult);
        if (actions && actions !== `- ${EMOJIS.messagesquare || '📝'} **Apenas Registro:** Nenhuma ação automática aplicada`) {
            builder.separator();
            builder.text(`**${EMOJIS.trianglealert || '⚠️'} Ações Aplicadas:**`);
            for (const action of actions.split('\n')) {
                if (action.trim()) builder.text(action);
            }
        }

        builder.footer(guildName);

        return builder;
    },
    
    generateUnstrikeUnifiedContainer(target, moderator, strikeNumber, reason, pointsRestored, newPoints, originalReason, guildName, guildId) {
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });
        builder.banner('title_strike_removido');

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
        builder.text(`## ${EMOJIS.circlecheck || '✅'} STRIKE ANULADO | ***#${strikeNumber}***`, 1);
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
        builder.footer(guildName);
        
        return builder;
    },
    
    /**
     * Monta o texto de "Ações Aplicadas" a partir do que foi REALMENTE
     * executado (jogoAct/discordAct + os resultados de fato retornados por
     * _executeStrike) — antes esse texto era inferido só a partir da
     * severidade numérica, de forma cosmética e desconectada da ação real
     * escolhida (bug corrigido nesta revisão).
     */
    getPunishmentActions(jogoAct, ingameActionResult, discordAct, discordActionResult) {
        const actions = [];

        if (jogoAct && jogoAct !== 'none') {
            const icon = EMOJIS.game || '🎮';
            if (ingameActionResult && !ingameActionResult.toLowerCase().startsWith('falha')) {
                actions.push(`- ${icon} **Ação em jogo (${jogoAct}):** ${ingameActionResult}`);
            } else if (ingameActionResult) {
                actions.push(`- ${EMOJIS.circlealert || '❌'} **Ação em jogo (${jogoAct}):** ${ingameActionResult}`);
            }
        }

        if (discordAct && discordAct !== 'none') {
            const actIcons = { timeout: EMOJIS.micoff || '🔇', kick: EMOJIS.userx || '👢', ban: EMOJIS.ban || '🚫' };
            const actNames = { timeout: 'Timeout (Silenciamento)', kick: 'Expulsão do Servidor', ban: 'Banimento do Servidor' };
            const icon = actIcons[discordAct] || EMOJIS.raio || '⚡';
            const name = actNames[discordAct] || discordAct;

            if (discordActionResult && !discordActionResult.includes('Erro')) {
                actions.push(`- ${icon} **${name}:** ${discordActionResult}`);
            } else if (discordActionResult && discordActionResult.includes('Erro')) {
                actions.push(`- ${EMOJIS.circlealert || '❌'} **${name}:** ${discordActionResult}`);
            } else {
                actions.push(`- ${icon} **${name}:** Aplicado com sucesso`);
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
    _simpleReply(text, color = COLORS.ERROR, guildName = null) {
        return new AdvancedContainerBuilder({ accentColor: color }).text(text).footer(guildName).build();
    },

    async handleComponent(interaction, action, param) {
        try {
            const [subAction, targetId, page] = param ? param.split(':') : [];
            switch (action) {
                case 'confirm':
                    await this.handleStrikeConfirmation(interaction, subAction);
                    break;
                case 'level_select':
                    await this.handleLevelSelect(interaction, subAction);
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
                case 'personalizado_identify':
                    await this.handlePersonalizadoIdentify(interaction, subAction);
                    break;
                default:
                    await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Ação "${action}" não reconhecida.`, COLORS.ERROR, interaction.guild?.name));
            }
        } catch (error) {
            console.error('❌ Erro no handleComponent:', error);
            await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Ocorreu um erro.`, COLORS.ERROR, interaction.guild?.name));
        }
    },

    /**
     * Mostra o select-menu com os níveis de punição do servidor — usado por
     * ingame.js/personalizado.js (não por registro.js, que é registro puro sem
     * nível) depois de já terem staged os dados básicos (SessionManager,
     * chave 'strike_staging'). A escolha do nível é processada por
     * handleLevelSelect (customId `punishment:level_select:<subcommand>`).
     */
    async showLevelSelector(interaction, subcommand) {
        const guildId = interaction.guildId;
        const levels = PunishmentLevels.getLevels(guildId);
        if (levels.length === 0) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} Este servidor ainda não tem nenhum nível de punição configurado. Peça a um administrador para criar em /config punishments.`,
                COLORS.ERROR, interaction.guild?.name,
            ));
        }

        const menu = new StringSelectMenuBuilder()
            .setCustomId(`punishment:level_select:${subcommand}`)
            .setPlaceholder('Selecione o nível de punição')
            .addOptions(levels.map((level) => new StringSelectMenuOptionBuilder()
                .setLabel(level.name)
                .setDescription(`${level.severity} | -${level.points} pts | ${level.duration_str || 'Permanente'}`)
                .setValue(String(level.id))));

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        builder.title(`${EMOJIS.gavel || '⚖️'} Escolha o nível de punição`, 1);
        builder.text('Selecione abaixo qual nível de punição customizado deste servidor será aplicado.');
        builder.selectMenu(menu);
        builder.footer(interaction.guild.name, 'Esta seleção expira em 2 minutos.');

        const { components, flags } = builder.build();
        await interaction.editReply({ components, flags: [flags] });
    },

    /**
     * Select-menu de nível (usado por /strike ingame/discord/personalizado) —
     * o staff já staged os dados básicos (alvo, motivo, overrides) em
     * SessionManager sob 'strike_staging' antes de mostrar este menu; ao
     * escolher um nível, mescla os dois e mostra a MESMA prévia de
     * confirmação usada em qualquer fluxo (buildStrikeConfirmPreview).
     */
    async handleLevelSelect(interaction, subcommand) {
        const guild = interaction.guild;
        const staff = interaction.user;

        const staging = SessionManager.get(staff.id, guild.id, 'strike_staging', 'strike_staging');
        if (!staging) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Sessão expirada. Use /strike novamente.`, COLORS.ERROR, guild?.name));
        }

        const levelId = interaction.values?.[0];
        const level = PunishmentLevels.getLevel(guild.id, levelId);
        if (!level) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Este nível não existe mais.`, COLORS.ERROR, guild?.name));
        }

        const session = this._mergeLevelIntoSession(staging, level);
        SessionManager.delete(staff.id, guild.id, 'strike_staging', 'strike_staging');
        SessionManager.set(staff.id, guild.id, 'strike_pending', 'strike_pending', session, 120000);

        const preview = await this.buildStrikeConfirmPreview(session, guild, interaction.member);
        await interaction.editReply(preview);
    },

    /**
     * Combina o nível escolhido com os dados staged pelo subcomando de
     * /strike — overrides manuais (duração/ação no jogo, só em
     * /strike personalizado) sempre têm prioridade sobre o valor do nível.
     */
    _mergeLevelIntoSession(staging, level) {
        return {
            targetId: staging.targetId,
            // Todo subcomando (registro/ingame/personalizado) já pede motivo
            // digitado — fallback pro nome do nível só por segurança, nunca
            // deveria disparar na prática (o motivo vira <banreason>/
            // <userbanreason> no RCON, mostrado ao próprio jogador punido).
            reason: staging.reason || `Punição aplicada: ${level.name}`,
            reportId: staging.reportId || null,
            levelId: level.id,
            levelName: level.name,
            levelSeverity: level.severity,
            levelAction: staging.jogoActOverride || level.action || 'none',
            pointsLost: level.points,
            durationStr: staging.durationOverride || level.duration_str || '',
            discordAct: staging.discordAct || 'none',
            jogoAct: staging.jogoActOverride || level.action || 'none',
            alderonId: staging.alderonId || null,
            // Nome de exibição pra alvo sem conta Discord vinculada (ver
            // PunishmentSystem._unregisteredTargetId) — ignorado se o alvo
            // tiver Discord real, que já tem nome próprio.
            targetPlayerName: staging.targetPlayerName || null,
            // Só é consultado no plano Caçador (ver requiresSupervisorApproval)
            // — Free/Rastreador ignoram e usam a regra automática de sempre.
            levelRequiresApproval: !!level.requires_supervisor_approval,
        };
    },

    /**
     * Monta o container + botões de confirmação de um /strike (qualquer um
     * dos 3 subcomandos) — extraído do que antes era montado inline dentro
     * do antigo comando único /strike, agora reaproveitado por
     * registro.js/ingame.js/personalizado.js e por handleLevelSelect.
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

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
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
        builder.text(`**${EMOJIS.raio || '⚡'} Ação no Discord:** ${session.discordAct === 'none' || !session.discordAct ? 'Nenhuma' : session.discordAct}`);
        if (session.discordAct && session.discordAct !== 'none' && !PremiumSystem.getGuildLimits(guildId).discordActionsEnabled) {
            builder.text(`${EMOJIS.trianglealert || '⚠️'} Ações automáticas no Discord (timeout/kick/ban) exigem o plano Rastreador ou superior — a ação escolhida não será aplicada, só o registro da punição.`);
        }
        builder.text(`**${EMOJIS.game || '🎮'} Ação In-Game:** ${session.jogoAct === 'none' || !session.jogoAct ? 'Nenhuma' : session.jogoAct}`);
        if (session.jogoAct && session.jogoAct !== 'none' && !PremiumSystem.getGuildLimits(guildId).autoRcon) {
            builder.text(`${EMOJIS.trianglealert || '⚠️'} Ação em jogo (RCON) exige o plano Rastreador — a ação escolhida não será aplicada, só o registro da punição.`);
        }

        if (this.requiresSupervisorApproval(session, guild.id) && !(await this.memberHasSupervisorRole(guild, staffMember))) {
            builder.separator();
            builder.text(
                `${EMOJIS.shieldban || '🛡️'} **Requer aprovação de Supervisor**\n` +
                `Esta punição tem severidade Grave/Severa e/ou duração longa (>72h ou permanente). Como você não possui o cargo Supervisor (/config roles), ao confirmar o pedido será enviado para o canal de log de punições, marcando o cargo Supervisor — a punição só será aplicada depois de aprovada.`
            );
        }

        builder.footer(guild.name, 'Confirme ou cancele abaixo. Esta confirmação expira em 2 minutos.');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('punishment:confirm:confirm').setLabel('Confirmar').setStyle(ButtonStyle.Success).setEmoji(EMOJIS.circlecheck || '✅'),
            new ButtonBuilder().setCustomId('punishment:confirm:cancel').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji(EMOJIS.circlealert || '❌'),
        );

        const { components, flags } = builder.build();
        return { components: [...components, row], flags: [flags] };
    },

    /**
     * Clique em "Sim"/"Não" no painel de identificação de /strike
     * personalizado (ver src/commands/strike/personalizado.js
     * showIdentifyPanel) — mostrado quando só usuario OU só agid foi
     * informado, sem discord_act/jogo_act.
     *
     * "não" → registra sem nenhuma ação, usando o que foi encontrado na
     * busca (mesmo padrão de /strike registro, mas com o alvo já
     * identificado por AGID/Discord).
     * "sim" → não dá pra injetar opções numa interação já em andamento
     * (discord_act/jogo_act são opções do SLASH COMMAND, fixas na hora de
     * digitar) — só informa o que foi encontrado e pede pro staff refazer
     * o comando já com as ações desejadas.
     */
    async handlePersonalizadoIdentify(interaction, decision) {
        const session = SessionManager.get(interaction.user.id, interaction.guildId, 'strike_personalizado_identify', 'strike_personalizado_identify');
        if (!session) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Sessão expirada. Use /strike personalizado novamente.`, COLORS.ERROR, interaction.guild?.name));
        }
        SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_personalizado_identify', 'strike_personalizado_identify');

        if (decision === 'no') {
            const guild = interaction.guild;
            const staff = interaction.user;

            const isUnregisteredTarget = this._isUnregisteredTargetId(session.targetId);
            let targetMember = null;
            if (!isUnregisteredTarget) {
                targetMember = await guild.members.fetch(session.targetId).catch(() => null);
            }
            const isStaffHigher = targetMember &&
                targetMember.roles.highest.position >= interaction.member.roles.highest.position &&
                staff.id !== guild.ownerId;
            if (isStaffHigher) {
                db.logActivity(guild.id, staff.id, 'strike_denied', session.targetId, { command: 'strike_personalizado', reason: 'Hierarquia insuficiente' });
                return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Você não pode punir este membro.`, COLORS.ERROR, guild.name));
            }

            const finalSession = {
                targetId: session.targetId,
                alderonId: session.alderonId || null,
                targetPlayerName: session.targetPlayerName || null,
                reason: session.reason,
                reportId: session.reportId,
                durationStr: session.durationStr,
                discordAct: 'none',
                jogoAct: 'none',
                pointsLost: 0,
                levelId: null, levelName: null, levelSeverity: null,
            };

            SessionManager.set(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending', finalSession, 120000);
            const preview = await this.buildStrikeConfirmPreview(finalSession, guild, interaction.member);
            return await interaction.editReply(preview);
        }

        if (decision === 'yes') {
            const identity = session.discordMention
                ? `${session.discordMention}${session.alderonId ? ` \`${session.alderonId}\`` : ''}`
                : `${session.targetPlayerName || 'jogador'}${session.alderonId ? ` \`${session.alderonId}\`` : ''}`;
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlecheck || '✅'} Identificado: ${identity}. Rode **/strike personalizado** de novo com os mesmos dados, agora preenchendo \`discord_act\` e/ou \`jogo_act\` com a ação desejada.`,
                COLORS.DEFAULT, interaction.guild?.name,
            ));
        }

        return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Ação não reconhecida.`, COLORS.ERROR, interaction.guild?.name));
    },

    async handleStrikeConfirmation(interaction, action) {
        const session = SessionManager.get(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending');
        if (!session) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Sessão expirada. Use /strike novamente.`, COLORS.ERROR, interaction.guild?.name));
        }

        if (action === 'cancel') {
            SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending', 'strike_pending');
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Punição cancelada.`, COLORS.ERROR, interaction.guild?.name));
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
                return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} ${result.error}`, COLORS.ERROR, interaction.guild?.name));
            }

            await interaction.editReply(this._simpleReply(this._buildStrikeSummaryLines(result, guild.id).join('\n'), COLORS.SUCCESS, interaction.guild?.name));
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
                COLORS.ERROR, guild.name,
            ));
        }

        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (!logChannel) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} O canal de log de punições configurado não foi encontrado. Peça a um administrador para reconfigurar em /config logs.`,
                COLORS.ERROR, guild.name,
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

        const approvalBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        approvalBuilder.section(
            [
                '# APROVAÇÃO NECESSÁRIA: PUNIÇÃO SEVERA',
                `${ConfigSystem.mentionRoles(guild.id, 'supervisor_role')} um Staff solicitou uma punição de nível **${severityLabel}**, que precisa de aprovação antes de ser aplicada.`,
            ].join('\n'),
            targetUser ? AdvancedContainerBuilder.thumbnail(targetUser.displayAvatarURL({ size: 128 })) : null,
        );
        approvalBuilder.separator();
        approvalBuilder.text(`**${EMOJIS.user || '👤'} Solicitado por:** ${staff.toString()}`);
        approvalBuilder.text(`**${EMOJIS.user || '👤'} Alvo:** ${targetUser ? targetUser.toString() : `\`${session.targetId}\``}`);
        approvalBuilder.text(`${this.severityIconFor({ levelSeverity: session.levelSeverity })} **Nível:** ${severityLabel}`);
        if (PremiumSystem.getGuildLimits(guild.id).reputationEnabled) {
            approvalBuilder.text(`**${EMOJIS.doublearrowdown || '📉'} Pontos a perder:** -${session.pointsLost}`);
        }
        approvalBuilder.text(`**${EMOJIS.raio || '⚡'} Ação no Discord:** ${session.discordAct === 'none' || !session.discordAct ? 'Nenhuma' : session.discordAct}`);
        approvalBuilder.text(`**${EMOJIS.clockalert || '⏳'} Duração:** ${!session.durationStr || session.durationStr === '0' || session.durationStr?.toLowerCase() === 'perm' ? 'Permanente' : session.durationStr}`);
        approvalBuilder.separator();
        approvalBuilder.text(`**${EMOJIS.messagesquare || '📝'} Motivo:**\n\`\`\`text\n${session.reason}\n\`\`\``);
        approvalBuilder.footer(guild.name, 'Apenas o cargo Supervisor pode aprovar ou rejeitar este pedido.');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`punishment:supervisor_approve:${approvalId}`).setLabel('Aprovar').setStyle(ButtonStyle.Success).setEmoji(emojis.circlecheck || '✅'),
            new ButtonBuilder().setCustomId(`punishment:supervisor_reject:${approvalId}`).setLabel('Rejeitar').setStyle(ButtonStyle.Danger).setEmoji(emojis.circlealert || '❌'),
        );

        const { components, flags } = approvalBuilder.build();
        await logChannel.send({ components: [...components, row], flags: [flags] });

        return await interaction.editReply(this._simpleReply(
            `${emojis.clockalert || '⏳'} Esta é uma punição **severa** (${severityLabel}). Como você não possui o cargo Supervisor, o pedido foi enviado para aprovação no canal de log de punições, marcando o cargo Supervisor. A punição só será aplicada depois que um Supervisor aprovar.`,
            COLORS.DEFAULT, guild.name,
        ));
    },

    /**
     * Clique de Aprovar/Rejeitar no pedido enviado a logs-punições.
     * @param {boolean} approved
     */
    async handleSupervisorApproval(interaction, approvalId, approved) {
        const guild = interaction.guild;

        if (!(await this.memberHasSupervisorRole(guild, interaction.member))) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Apenas o cargo Supervisor pode aprovar ou rejeitar punições severas.`, COLORS.ERROR, guild?.name));
        }

        const session = SessionManager.get('approval', guild.id, 'strike_approval', approvalId);
        if (!session) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Este pedido de aprovação expirou ou já foi resolvido.`, COLORS.ERROR, guild?.name));
        }
        SessionManager.delete('approval', guild.id, 'strike_approval', approvalId);

        const requester = await interaction.client.users.fetch(session.requestedBy).catch(() => null);

        if (!approved) {
            await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} Punição severa **rejeitada** por ${interaction.user}. O pedido de ${session.requestedByTag || session.requestedBy} não foi aplicado.`,
                COLORS.ERROR, guild.name,
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
        const originalStaff = requester || interaction.user;
        const result = await this._executeStrike(guild, originalStaff, session);

        if (!result.success) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} ${result.error}`, COLORS.ERROR, guild.name));
        }

        const summaryLines = this._buildStrikeSummaryLines(result, guild.id);
        summaryLines.unshift(`${EMOJIS.circlecheck || '✅'} **Aprovado por ${interaction.user.tag}**`);
        await interaction.editReply(this._simpleReply(summaryLines.join('\n'), COLORS.SUCCESS, guild.name));

        if (requester) {
            await requester.send(
                `${EMOJIS.circlecheck || '✅'} Seu pedido de punição severa contra ${result.targetUser?.tag || session.targetId} foi **aprovado** por ${interaction.user.tag} em **${guild.name}** e já foi aplicado (Strike #${result.strikeId}).`
            ).catch(() => {});
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
     * @param {object} session - { targetId, reason, levelId, levelName, levelSeverity, levelAction, durationStr, reportId, discordAct, jogoAct, pointsLost, alderonId }
     * @returns {Promise<object>} resultado com { success, error } ou os dados usados no resumo
     */
    async _executeStrike(guild, staff, session) {
        const ConfigSystem = require('../core/configSystem');
        const AnalyticsSystem = require('./analyticsSystem');

        let emojis = {};
        try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

        const { targetId, reason, levelId, levelName, levelSeverity, levelAction, durationStr, reportId, discordAct, jogoAct, pointsLost, alderonId, targetPlayerName } = session;

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
        const strikeId = this.applyPunishment(guild.id, targetId, staff.id, reason, levelSnapshot, reportId || null, pointsLost);
        if (!strikeId) {
            return { success: false, error: 'Erro ao aplicar punição no banco de dados.' };
        }

        // ── Fecha o vínculo report ↔ punição: se o strike referenciou um
        // report (já validado no subcomando de /strike que chamou isto),
        // grava a punição aplicada de volta no próprio report para consulta
        // futura. ──────────────────────────────────────────────────────────
        if (reportId) {
            const linkedReportNumber = parseInt(String(reportId).replace(/^#?R/i, ''));
            if (!isNaN(linkedReportNumber)) {
                db.prepare(`UPDATE reports SET punishment = ? WHERE guild_id = ? AND report_number = ?`)
                    .run(`Strike #${strikeId}${levelName ? ` (${levelName})` : ''}`, guild.id, linkedReportNumber);
            }
        }

        // ── Ações automáticas no Discord (timeout/kick/ban) via strike só
        // a partir do plano Rastreador — repetida aqui (defesa em
        // profundidade) já que este método também é chamado direto pela
        // aprovação de Supervisor. ──────────────────────────────────────
        let discordActionResult = null;
        if (discordAct && discordAct !== 'none' && !PremiumSystem.getGuildLimits(guild.id).discordActionsEnabled) {
            discordActionResult = `${EMOJIS.trianglealert || '⚠️'} Ação no Discord requer o plano Rastreador ou superior.`;
        } else if (discordAct && discordAct !== 'none' && targetMember) {
            try {
                switch (discordAct) {
                    case 'timeout':
                        await targetMember.timeout(durationMs > 0 ? durationMs : 60000, reason);
                        discordActionResult = `Timeout de ${durationStr || '1 minuto'} aplicado`;
                        break;
                    case 'kick':
                        await targetMember.kick(reason);
                        discordActionResult = 'Expulsão aplicada';
                        break;
                    case 'ban':
                        await targetMember.ban({ reason });
                        discordActionResult = 'Banimento aplicado';
                        break;
                }
            } catch (err) {
                discordActionResult = `${EMOJIS.circlealert || '❌'} Erro: ${err.message}`;
            }
        } else if (discordAct && discordAct !== 'none' && !targetMember) {
            // Sem membro (alvo sem conta Discord vinculada, ou vinculada mas
            // fora deste servidor) — sem isso, getPunishmentActions cairia no
            // fallback "Aplicado com sucesso" mesmo sem nada ter rodado.
            discordActionResult = `${EMOJIS.circlealert || '❌'} Não aplicada: jogador sem conta Discord vinculada ou fora deste servidor.`;
        }

        const roleResult = await this.applyTemporaryRole(guild, targetMember, durationMs);

        // ── Ação in-game automática via RCON — a partir do Rastreador (ver
        // premiumSystem.js, GUILD_LIMITS.autoRcon). Sintaxe real dos comandos
        // do Path of Titans (docs oficiais: chat-commands/source-rcon) — o
        // formato exato do campo de duração/tempo NÃO está confirmado pelas
        // docs, precisa ser validado contra um servidor real antes de
        // confiar 100% em produção. ──────────────────────────────────────────
        let ingameActionResult = null;
        if (jogoAct && jogoAct !== 'none') {
            if (!PremiumSystem.getGuildLimits(guild.id).autoRcon) {
                ingameActionResult = 'Ação in-game requer o plano Rastreador.';
            } else {
                const link = alderonId ? { alderon_id: alderonId } : getPlayerByDiscordId(targetId);
                if (!link) {
                    ingameActionResult = 'Jogador não vinculado ao Path of Titans (/registrar) — ação in-game não executada.';
                } else {
                    try {
                        const PoTConfigSystem = require('../pot/potConfigSystem');
                        // Permanente no RCON do PoT é "0" (confirmado pelo dono) — "perm" não é
                        // reconhecido pelo servidor, o comando ficava sem efeito nenhum (nem
                        // erro, só silenciosamente ignorado).
                        const durationToken = durationLower === '' || durationLower === '0' || durationLower === 'perm' ? '0' : durationStr;
                        const rconCommands = {
                            SystemMessage: `SystemMessage ${link.alderon_id} ${reason}`,
                            Kick: `kick ${link.alderon_id} ${reason}`,
                            Ban: `ban ${link.alderon_id} ${durationToken} ${reason} ${reason}`,
                            ServerMute: `ServerMute ${link.alderon_id} ${durationToken} ${reason} ${reason}`,
                        };
                        const command = rconCommands[jogoAct];
                        if (!command) {
                            ingameActionResult = `Ação in-game "${jogoAct}" desconhecida.`;
                        } else {
                            const rconResult = await PoTConfigSystem.executeRconCommand(guild.id, command);
                            ingameActionResult = rconResult?.success
                                ? 'Ação in-game executada.'
                                : `Falha na ação in-game: ${rconResult?.error || 'erro desconhecido'}`;

                            // ── Ban/ServerMute mexem em listas persistentes do
                            // servidor (banlist/mutelist) — SEM recarregar, o
                            // jogador é banido/mutado mas o servidor não relê o
                            // motivo até o próximo restart (visto em teste real:
                            // ban aplicado sem esse reload não mostrou o motivo
                            // pro jogador). Por isso agora é AGUARDADO (antes era
                            // fire-and-forget silencioso) e a falha é reportada
                            // ao staff em vez de sumir — a ação principal já foi
                            // aplicada de qualquer forma, o reload só garante que
                            // o motivo/efeito completo realmente valha na hora. ──
                            if (rconResult?.success && (jogoAct === 'Ban' || jogoAct === 'ServerMute')) {
                                const reloadCommand = jogoAct === 'Ban' ? 'ReloadBans' : 'ReloadMutes';
                                const reloadResult = await PoTConfigSystem.executeRconCommand(guild.id, reloadCommand).catch((err) => ({ success: false, error: err.message }));
                                if (!reloadResult?.success) {
                                    ingameActionResult += ` ${EMOJIS.trianglealert || '⚠️'} ${reloadCommand} falhou (${reloadResult?.error || 'erro desconhecido'}) — o jogador pode não ver o motivo até o próximo restart do servidor.`;
                                }
                            }
                        }
                    } catch (err) {
                        ingameActionResult = `Falha na ação in-game: ${err.message}`;
                    }
                }
            }
        }

        db.logActivity(guild.id, staff.id, 'strike', targetId, {
            command: 'strike', punishmentId: strikeId, levelName, levelSeverity, pointsLost,
            oldPoints: currentRep, newPoints, reason, duration: durationStr, discordAct, jogoAct,
            temporaryRoleApplied: roleResult.applied, ingameActionResult
        });

        await AnalyticsSystem.updateStaffAnalytics(guild.id, staff.id);

        const containerBuilder = this.generateStrikeUnifiedContainer(
            targetUser, staff, strikeId, levelName, levelSeverity, reason, reportId || null,
            pointsLost, newPoints, discordAct, discordActionResult, guild.name, null, guild.id,
            jogoAct, ingameActionResult
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
            } catch (err) {}
        }

        const roleStatusMsg = roleResult.applied
            ? `${emojis.gavel || '⚠️'} Cargo de Strike aplicado temporariamente.`
            : (roleResult.error ? `${emojis.messagesquare || 'ℹ️'} Cargo de Strike não aplicado: ${roleResult.error}` : null);

        return {
            success: true, strikeId, targetUser, pointsLost, newPoints,
            dmDelivered, logSent, roleStatusMsg, ingameActionResult, isUnregisteredTarget,
        };
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
            `${emojis.circlecheck || '✅'} **Strike #${result.strikeId} aplicado em ${result.targetUser.username}**`,
        ];
        if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
            lines.push(`${emojis.doublearrowdown || '📉'} ${result.pointsLost} pts perdidos`);
            lines.push(`${emojis.star || '⭐'} Reputação: ${result.newPoints}/100`);
        }
        lines.push(dmStatusMsg);
        if (result.roleStatusMsg) lines.push(result.roleStatusMsg);
        if (result.ingameActionResult) lines.push(`${emojis.game || '🎮'} ${result.ingameActionResult}`);
        if (!result.logSent) lines.push(`${emojis.trianglealert || '⚠️'} A mensagem de log não foi enviada ao canal (verifique a configuração em /config logs).`);
        return lines;
    },

    async handleUnstrikeConfirmation(interaction, action) {
        const session = SessionManager.get(interaction.user.id, interaction.guildId, 'unstrike_pending', 'unstrike_pending');
        if (!session) {
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Sessão expirada. Use /unstrike novamente.`, COLORS.ERROR, interaction.guild?.name));
        }

        if (action === 'cancel') {
            SessionManager.delete(interaction.user.id, interaction.guildId, 'unstrike_pending', 'unstrike_pending');
            return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Anulação cancelada.`, COLORS.ERROR, interaction.guild?.name));
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
                return await interaction.editReply(this._simpleReply(`${EMOJIS.circlealert || '❌'} Punição não encontrada ou já anulada.`, COLORS.ERROR, interaction.guild?.name));
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
                    await targetMember.roles.remove(strikeRoleId, `Punição #${punishmentId} anulada`);
                } catch (err) {}
            }
            if (targetMember?.communicationDisabledUntilTimestamp) {
                try {
                    await targetMember.timeout(null, `Punição #${punishmentId} anulada`);
                } catch (err) {}
            }

            // ── Desfaz a ação EM JOGO, se a punição original tinha uma
            // (Ban/ServerMute via RCON) — antes disso, /unstrike não mexia
            // em nada no jogo, então um jogador banido/mutado continuava
            // assim mesmo depois de anulado no Discord. Mesmo gate (autoRcon,
            // Rastreador+) que já libera a aplicação original em
            // _executeStrike — quem pôde aplicar também consegue desfazer.
            // Falha de RCON aqui NÃO bloqueia o resto do unstrike (o banco/
            // Discord já são a fonte da verdade da punição). ─────────────────
            let ingameUndoResult = null;
            if (punishment.level_action === 'Ban' || punishment.level_action === 'ServerMute') {
                if (!PremiumSystem.getGuildLimits(guildId).autoRcon) {
                    ingameUndoResult = 'Ação in-game requer o plano Rastreador — não desfeita automaticamente.';
                } else {
                    // Alvo sem vínculo Discord (ver _executeStrike/convenção
                    // UNREGISTERED_TARGET_PREFIX) guarda o AGID direto no
                    // user_id — usa ele sem tentar resolver por Discord, que
                    // nunca vai bater.
                    const alderonId = this._isUnregisteredTargetId(punishment.user_id)
                        ? punishment.user_id.slice(UNREGISTERED_TARGET_PREFIX.length)
                        : getPlayerByDiscordId(punishment.user_id)?.alderon_id;
                    if (!alderonId) {
                        ingameUndoResult = 'Jogador não vinculado ao Path of Titans — ação in-game não desfeita.';
                    } else {
                        try {
                            const PoTConfigSystem = require('../pot/potConfigSystem');
                            const isBan = punishment.level_action === 'Ban';
                            const undoCommand = isBan ? `unban ${alderonId}` : `ServerUnmute ${alderonId}`;
                            const rconResult = await PoTConfigSystem.executeRconCommand(guildId, undoCommand);
                            ingameUndoResult = rconResult?.success
                                ? 'Ação in-game desfeita.'
                                : `Falha ao desfazer ação in-game: ${rconResult?.error || 'erro desconhecido'}`;
                            if (rconResult?.success) {
                                const reloadCommand = isBan ? 'ReloadBans' : 'ReloadMutes';
                                const reloadResult = await PoTConfigSystem.executeRconCommand(guildId, reloadCommand).catch((err) => ({ success: false, error: err.message }));
                                if (!reloadResult?.success) {
                                    ingameUndoResult += ` ${emojis.trianglealert || '⚠️'} ${reloadCommand} falhou (${reloadResult?.error || 'erro desconhecido'}).`;
                                }
                            }
                        } catch (err) {
                            ingameUndoResult = `Falha ao desfazer ação in-game: ${err.message}`;
                        }
                    }
                }
            }

            db.logActivity(guildId, staff.id, 'unstrike', punishment.user_id, {
                command: 'unstrike', punishmentId, pointsRestored, oldPoints: currentRep, newPoints, ingameUndoResult
            });

            await AnalyticsSystem.updateStaffAnalytics(guildId, staff.id);

            const targetUser = await interaction.client.users.fetch(punishment.user_id).catch(() => null);
            const containerBuilder = this.generateUnstrikeUnifiedContainer(
                targetUser, staff, punishmentId, reason, pointsRestored, newPoints, punishment.reason, guild.name, guildId
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
                `${emojis.circlecheck || '✅'} **Strike #${punishmentId} anulado!**`,
            ];
            if (PremiumSystem.getGuildLimits(guildId).reputationEnabled) {
                summaryLines.push(`${emojis.doublearrowup || '📈'} +${pointsRestored} pts | ${emojis.star || '⭐'} Reputação: ${newPoints}/100`);
            }
            summaryLines.push(dmStatusMsg);
            if (ingameUndoResult) summaryLines.push(`${emojis.game || '🎮'} ${ingameUndoResult}`);
            if (!logSent) summaryLines.push(`${emojis.trianglealert || '⚠️'} A mensagem de log não foi enviada ao canal (verifique a configuração em /config logs).`);

            SessionManager.delete(interaction.user.id, interaction.guildId, 'unstrike_pending', 'unstrike_pending');
            await interaction.editReply(this._simpleReply(summaryLines.join('\n'), COLORS.SUCCESS, interaction.guild?.name));
        }
    },

    // ==================== MÉTODOS DE NEGÓCIO ====================

    /**
     * Atribui o cargo temporário de Strike (configurado via /config roles,
     * chave 'strike_role') ao membro punido, e registra a expiração na
     * tabela temporary_roles para remoção automática pelo worker (initWorker).
     * Recurso do plano Rastreador+ (ver PremiumSystem.GUILD_LIMITS.
     * temporaryRoleEnabled) — em Free não aplica, mas ainda avisa o motivo
     * (mesmo padrão de discordAct/jogoAct, que também avisam "requer plano X"
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
     */
    applyPunishment(guildId, targetId, moderatorId, reason, levelSnapshot, reportId, points) {
        try {
            const trans = db.transaction(() => {
                const maxStrike = db.prepare(`
                    SELECT MAX(strike_number) as max FROM punishments WHERE guild_id = ?
                `).get(guildId);
                const strikeNumber = (maxStrike?.max || 0) + 1;

                const uuid = require('../../database/index').generateUUID();

                db.prepare(`
                    INSERT INTO punishments (uuid, guild_id, strike_number, user_id, moderator_id, reason, severity, points_deducted, report_id, created_at, status, level_id, level_name, level_severity, level_action, duration_str)
                    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    uuid, guildId, strikeNumber, targetId, moderatorId, reason, points, reportId, Date.now(), 'active',
                    levelSnapshot?.id || null, levelSnapshot?.name || null, levelSnapshot?.severity || null,
                    levelSnapshot?.action || null, levelSnapshot?.durationStr || null,
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