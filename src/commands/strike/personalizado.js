// src/commands/strike/personalizado.js — /strike personalizado
// Restrito ao cargo Supervisor (ver /config roles) E ao plano Caçador
// (Rastreador e Free ficam de fora — diferente de /strike ingame, que é
// Rastreador+) — modo manual completo, SEM níveis (só motivo + duração,
// ambos obrigatórios). Aceita usuario OU agid (não precisa dos dois) — o
// que faltar é buscado no vínculo global (/registrar) antes de decidir o
// que fazer, igual ao padrão já usado nos
// comandos /rcon-*/ingame-* (ver rconCommandCatalog.js TARGET_OPTIONS).
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const { getPlayerByAlderonId, getPlayerByDiscordId, getPlayerNameByAlderonId } = require('../../systems/pot/potPlayerRegistry');

let emojis = {};
try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

function validateReport(guildId, reportId) {
    const match = reportId.trim().match(/^#?R?(\d+)$/i);
    if (!match) return { error: 'ID de Report inválido. Use o formato #R5 (ou apenas 5).' };
    const reportNumber = parseInt(match[1]);
    const reportExists = db.prepare(`SELECT 1 FROM reports WHERE guild_id = ? AND report_number = ?`).get(guildId, reportNumber);
    if (!reportExists) return { error: `Report #R${reportNumber} não encontrado neste servidor.` };
    return { reportId: `#R${reportNumber}` };
}

/**
 * Já sabemos tudo que precisamos (alvo identificado + ação, se houver) —
 * checa hierarquia, monta a sessão e mostra a prévia de confirmação normal
 * (mesma usada por registro/ingame). Compartilhado pelos 3 caminhos que
 * chegam "prontos": usuario+agid juntos, ou qualquer um dos dois sozinho
 * quando já veio com discord_act/jogo_act preenchido.
 */
async function proceedToConfirm(interaction, data) {
    const { guild, user: staff, member: staffMember } = interaction;
    const guildId = guild.id;
    const PunishmentSystem = require('../../systems/moderation/punishmentSystem');

    db.ensureUser(staff.id, staff.username, staff.discriminator, staff.avatar);
    db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

    const isUnregistered = PunishmentSystem._isUnregisteredTargetId(data.targetId);
    let targetMember = null;
    if (!isUnregistered) {
        const targetUserObj = await interaction.client.users.fetch(data.targetId).catch(() => null);
        if (targetUserObj) db.ensureUser(targetUserObj.id, targetUserObj.username, targetUserObj.discriminator, targetUserObj.avatar);
        targetMember = await guild.members.fetch(data.targetId).catch(() => null);
    }

    // Hierarquia só faz sentido pra alvo com membro real no servidor — sem
    // vínculo Discord, não há cargo nenhum pra comparar, então segue.
    const isStaffHigher = targetMember &&
        targetMember.roles.highest.position >= staffMember.roles.highest.position &&
        staff.id !== guild.ownerId;
    if (isStaffHigher) {
        db.logActivity(guildId, staff.id, 'strike_denied', data.targetId, { command: 'strike_personalizado', reason: 'Hierarquia insuficiente' });
        return await ResponseManager.error(interaction, 'Você não pode punir este membro.');
    }

    // Sem níveis neste subcomando — sem pontos de reputação a deduzir (é
    // "registro + ação manual", não um nível com pontuação configurada).
    const session = {
        targetId: data.targetId,
        alderonId: data.alderonId || null,
        targetPlayerName: data.targetPlayerName || null,
        reason: data.reason,
        reportId: data.reportId,
        durationStr: data.durationStr,
        discordAct: data.discordAct || 'none',
        jogoAct: data.jogoAct || 'none',
        pointsLost: 0,
        levelId: null,
        levelName: null,
        levelSeverity: null,
        // Sem nível associado, não há de onde tirar pontos a descontar — avisa
        // o staff explicitamente (pedido do dono), já que /strike
        // personalizado tem cara de "ação completa" e a ausência de dedução
        // passaria despercebida sem esse aviso.
        reputationNote: 'Este subcomando não usa níveis de punição, nenhuma dedução de reputação é aplicada aqui... Se necessário use /repset.',
    };

    sessionManager.set(staff.id, guildId, 'strike_pending', 'strike_pending', session, 120000);
    const preview = await PunishmentSystem.buildStrikeConfirmPreview(session, guild, staffMember);
    return await interaction.editReply(preview);
}

/**
 * Só usuario OU só agid foi informado (não os dois), e nenhuma ação
 * (discord_act/jogo_act) foi pedida junto — mostra o que foi encontrado ao
 * buscar a outra metade do vínculo, e pergunta se o staff quer aplicar
 * ação. "Não" vai direto pro registro (proceedToConfirm sem ação); "Sim"
 * pede pro staff refazer o comando já com discord_act/jogo_act
 * preenchidos (ver PunishmentSystem.handlePersonalizadoIdentify).
 */
async function showIdentifyPanel(interaction, { targetId, alderonId, targetPlayerName, discordMention, summaryLine, reason, durationStr, reportId }) {
    sessionManager.set(interaction.user.id, interaction.guildId, 'strike_personalizado_identify', 'strike_personalizado_identify', {
        targetId, alderonId, targetPlayerName, reason, durationStr, reportId, discordMention,
    }, 120000);

    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
    builder.title(`${emojis.trianglealert || '⚠️'} Identificação do jogador`, 1);
    builder.text(summaryLine);
    builder.text(`**${emojis.messagesquare || '📝'} Motivo:** ${reason}`);
    builder.text('Deseja aplicar alguma ação (Discord e/ou jogo) nesta punição?');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('punishment:personalizado_identify:yes').setLabel('Sim, aplicar ação').setStyle(ButtonStyle.Primary).setEmoji(emojis.raio || '⚡'),
        new ButtonBuilder().setCustomId('punishment:personalizado_identify:no').setLabel('Não, apenas registrar').setStyle(ButtonStyle.Secondary).setEmoji(emojis.messagesquare || '📝'),
    );

    const { components, flags } = builder.build();
    await interaction.editReply({ components: [...components, row], flags: [flags] });
}

module.exports = {
    async execute(interaction, client) {
        const { guild, options, user: staff, member: staffMember } = interaction;
        const guildId = guild.id;

        const PunishmentSystem = require('../../systems/moderation/punishmentSystem');

        if (!(await PunishmentSystem.memberHasSupervisorRole(guild, staffMember))) {
            return await ResponseManager.error(interaction, 'Este subcomando é restrito ao cargo Supervisor (ver /config roles).');
        }

        // Exclusivo Caçador (Rastreador e Free ficam de fora) — diferente de
        // /strike ingame, que é Rastreador+.
        if (!PremiumSystem.isGuildAtLeast(guildId, 'cacador')) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guildId));
        }

        const targetUserOption = options.getUser('usuario');
        const agidOption = options.getString('agid')?.trim() || null;
        const reason = options.getString('motivo');
        const durationStr = options.getString('duracao');
        const discordAct = options.getString('discord_act') || 'none';
        const jogoActOption = options.getString('jogo_act') || null;
        const jogoAct = (jogoActOption && jogoActOption !== 'none') ? jogoActOption : 'none';
        let reportId = options.getString('report') || null;

        try {
            if (!targetUserOption && !agidOption) {
                return await ResponseManager.error(interaction, 'Informe `usuario` ou `agid` pra identificar o jogador.');
            }

            if (reportId) {
                const result = validateReport(guildId, reportId);
                if (result.error) return await ResponseManager.error(interaction, result.error);
                reportId = result.reportId;
            }

            // ── Caso 1: usuario E agid informados — identidade já completa,
            // vai direto pra confirmação (nenhuma busca necessária). ──────────
            if (targetUserOption && agidOption) {
                return await proceedToConfirm(interaction, {
                    targetId: targetUserOption.id, alderonId: agidOption,
                    reason, durationStr, discordAct, jogoAct, reportId,
                });
            }

            // ── Caso 2: só agid — busca se existe conta Discord vinculada. ──
            if (agidOption) {
                const link = getPlayerByAlderonId(agidOption);
                const resolvedUserId = link?.user_id || null;
                const playerName = link?.player_name || getPlayerNameByAlderonId(guildId, agidOption) || null;

                if (discordAct === 'none' && jogoAct === 'none') {
                    const summaryLine = resolvedUserId
                        ? `${emojis.circlecheck || '✅'} AGID \`${agidOption}\` está vinculado a <@${resolvedUserId}>.`
                        : `${emojis.circlealert || '❌'} AGID \`${agidOption}\` não está vinculado a nenhuma conta Discord.${playerName ? ` Nome visto em jogo: **${playerName}**.` : ''}`;
                    return await showIdentifyPanel(interaction, {
                        targetId: resolvedUserId || PunishmentSystem._unregisteredTargetId(agidOption),
                        alderonId: agidOption, targetPlayerName: resolvedUserId ? null : playerName,
                        discordMention: resolvedUserId ? `<@${resolvedUserId}>` : null,
                        summaryLine, reason, durationStr, reportId,
                    });
                }

                return await proceedToConfirm(interaction, {
                    targetId: resolvedUserId || PunishmentSystem._unregisteredTargetId(agidOption),
                    alderonId: agidOption, targetPlayerName: resolvedUserId ? null : playerName,
                    reason, durationStr, discordAct, jogoAct, reportId,
                });
            }

            // ── Caso 3: só usuario — busca se existe Alderon ID vinculado. ──
            const link = getPlayerByDiscordId(targetUserOption.id);
            const resolvedAgid = link?.alderon_id || null;

            if (discordAct === 'none' && jogoAct === 'none') {
                const summaryLine = resolvedAgid
                    ? `${emojis.circlecheck || '✅'} ${targetUserOption} está vinculado ao AGID \`${resolvedAgid}\`.`
                    : `${emojis.circlealert || '❌'} ${targetUserOption} não tem Alderon ID vinculado (sem /registrar).`;
                return await showIdentifyPanel(interaction, {
                    targetId: targetUserOption.id, alderonId: resolvedAgid, targetPlayerName: null,
                    discordMention: targetUserOption.toString(),
                    summaryLine, reason, durationStr, reportId,
                });
            }

            return await proceedToConfirm(interaction, {
                targetId: targetUserOption.id, alderonId: resolvedAgid,
                reason, durationStr, discordAct, jogoAct, reportId,
            });
        } catch (error) {
            console.error('❌ Erro no /strike personalizado:', error);
            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao preparar aplicação de strike. A equipe foi notificada.');
        }
    },
};
