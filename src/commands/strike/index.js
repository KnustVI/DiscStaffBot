// src/commands/strike/index.js
/**
 * /strike — comando ÚNICO, sem subcomandos (unificado a pedido do dono:
 * antes eram 3 subcomandos, cada um com sua própria noção de "nível" — o
 * que causava a inconsistência de punições sem nível de verdade). Duas
 * identidades opcionais (`usuario` e/ou `agid`, pelo menos uma obrigatória),
 * `motivo` sempre obrigatório, e `nivel` — via autocomplete, ver
 * `autocomplete()` abaixo, porque os níveis são customizados por servidor
 * (ver punishmentLevels.js) e a API do Discord não permite `.addChoices()`
 * dinâmico — passa a ser SEMPRE obrigatório a partir do plano Rastreador.
 *
 * Free NÃO tem níveis (maxPunishmentLevels = 0, ver premiumSystem.js) — se
 * nível fosse obrigatório ali também, Free perderia a capacidade de punir
 * por completo. Por pedido explícito do dono ("mantenha o strike registro
 * para free tier"), este comando detecta o tier e usa DOIS caminhos
 * internos:
 *   - Free: registro simples (sem nível/RCON/ação automática), só
 *     `usuario` + `motivo` (+ `duracao` opcional) — mesmo comportamento do
 *     antigo `/strike registro`, sem quebrar o que já era documentado no
 *     Free (ver PREMIUM.txt, seção 1).
 *   - Rastreador+: nível sempre obrigatório, a duração/pontos/ação em jogo
 *     vêm SEMPRE do nível escolhido (nunca de `duracao`, que nesse tier é
 *     ignorada) — mescla o que antes eram `/strike ingame` (aceita AGID
 *     não vinculado, alvo sintético) e `/strike personalizado` (aceita
 *     usuario OU agid, resolve o vínculo que faltar), sem o modo manual
 *     livre de nível (removido — todo strike agora usa um nível).
 *
 * Regras de identificação (Rastreador+, pedido literal do dono):
 *   - Nem usuario nem agid informados → erro exigindo pelo menos um.
 *   - Só agid, sem conta Discord vinculada → segue como alvo sintético
 *     "só em jogo" (ver PunishmentSystem._unregisteredTargetId): registra
 *     a punição e aplica a ação em jogo do nível normalmente, IGNORANDO
 *     qualquer discord_act informado (não existe conta pra aplicar nela).
 *   - Só usuario, sem AGID vinculado → erro pedindo pra refazer o comando
 *     já com `agid`, orientando o jogador a rodar /registrar (a ação em
 *     jogo do nível PRECISA de um Alderon ID real pra funcionar).
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const PunishmentLevels = require('../../systems/moderation/punishmentLevels');
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
 * Alvo já identificado (Discord real ou sintético) + nível escolhido — monta
 * a sessão, checa hierarquia e mostra a MESMA prévia de confirmação de
 * sempre (PunishmentSystem.buildStrikeConfirmPreview). Duração/pontos/ação
 * em jogo vêm sempre do nível, nunca de um valor manual.
 */
async function proceedWithLevel(interaction, { targetId, alderonId, targetPlayerName, reason, level, discordAct, reportId, noteText }) {
    const { guild, user: staff, member: staffMember } = interaction;
    const guildId = guild.id;
    const PunishmentSystem = require('../../systems/moderation/punishmentSystem');

    db.ensureUser(staff.id, staff.username, staff.discriminator, staff.avatar);
    db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

    const isUnregistered = PunishmentSystem._isUnregisteredTargetId(targetId);
    if (!isUnregistered) {
        const targetUserObj = await interaction.client.users.fetch(targetId).catch(() => null);
        if (targetUserObj) db.ensureUser(targetUserObj.id, targetUserObj.username, targetUserObj.discriminator, targetUserObj.avatar);
    }
    const targetMember = isUnregistered ? null : await guild.members.fetch(targetId).catch(() => null);

    const isStaffHigher = targetMember &&
        targetMember.roles.highest.position >= staffMember.roles.highest.position &&
        staff.id !== guild.ownerId;
    if (isStaffHigher) {
        db.logActivity(guildId, staff.id, 'strike_denied', targetId, { command: 'strike', reason: 'Hierarquia insuficiente' });
        return await ResponseManager.error(interaction, 'Você não pode punir este membro.');
    }

    const session = {
        targetId,
        alderonId: alderonId || null,
        targetPlayerName: targetPlayerName || null,
        reason,
        reportId,
        levelId: level.id,
        levelName: level.name,
        levelSeverity: level.severity,
        levelAction: level.action || 'none',
        pointsLost: level.points,
        durationStr: level.duration_str || '',
        discordAct: discordAct || 'none',
        jogoAct: level.action || 'none',
        levelRequiresApproval: !!level.requires_supervisor_approval,
        noteText: noteText || null,
    };

    sessionManager.set(staff.id, guildId, 'strike_pending', 'strike_pending', session, 120000);
    const preview = await PunishmentSystem.buildStrikeConfirmPreview(session, guild, staffMember);
    return await interaction.editReply(preview);
}

/**
 * Caminho Rastreador+: resolve usuario/agid conforme as regras descritas no
 * topo do arquivo, e chama proceedWithLevel assim que (ou se) a identidade
 * ficar completa o bastante pra prosseguir.
 */
async function executeWithLevel(interaction, { targetUserOption, agidOption, reason, level, discordAct, reportId }) {
    const guildId = interaction.guildId;

    // Caso 1: usuario E agid informados — identidade já completa, nenhuma busca necessária.
    if (targetUserOption && agidOption) {
        return await proceedWithLevel(interaction, {
            targetId: targetUserOption.id, alderonId: agidOption, targetPlayerName: null,
            reason, level, discordAct, reportId,
        });
    }

    // Caso 2: só agid — busca vínculo Discord.
    if (agidOption) {
        const link = getPlayerByAlderonId(agidOption);
        if (link) {
            return await proceedWithLevel(interaction, {
                targetId: link.user_id, alderonId: agidOption, targetPlayerName: link.player_name || null,
                reason, level, discordAct, reportId,
            });
        }

        // Não encontrado: alvo sintético "só em jogo" — a própria prévia de
        // confirmação (JOGADOR sem Discord vinculado) já deixa isso claro
        // antes do staff confirmar; discord_act é ignorado (sem conta pra
        // aplicar), a ação em jogo do nível segue normalmente.
        const playerName = getPlayerNameByAlderonId(guildId, agidOption) || null;
        const PunishmentSystem = require('../../systems/moderation/punishmentSystem');
        return await proceedWithLevel(interaction, {
            targetId: PunishmentSystem._unregisteredTargetId(agidOption), alderonId: agidOption, targetPlayerName: playerName,
            reason, level, discordAct: 'none', reportId,
            noteText: `AGID \`${agidOption}\` não está vinculado a nenhuma conta Discord — a punição será registrada e a ação em jogo do nível (se houver) aplicada normalmente; nenhuma ação no Discord será executada.`,
        });
    }

    // Caso 3: só usuario — precisa de AGID pra ação em jogo do nível.
    const link = getPlayerByDiscordId(targetUserOption.id);
    if (!link) {
        return await ResponseManager.error(interaction,
            `${targetUserOption} não possui Alderon ID vinculado. Refaça o comando informando \`agid\`, e oriente o jogador a se registrar com **/registrar**.`);
    }
    return await proceedWithLevel(interaction, {
        targetId: targetUserOption.id, alderonId: link.alderon_id, targetPlayerName: null,
        reason, level, discordAct, reportId,
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('strike')
        .setDescription('⚖️ Aplica uma punição a um jogador.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(opt => opt.setName('usuario').setDescription('Membro infrator no Discord (informe este e/ou agid)').setRequired(false))
        .addStringOption(opt => opt.setName('agid').setDescription('Alderon ID do jogador (informe este e/ou usuario)').setRequired(false))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da punição').setRequired(true))
        .addStringOption(opt => opt.setName('nivel').setDescription('Nível de punição (obrigatório a partir do Rastreador — comece a digitar pra ver as opções)').setRequired(false).setAutocomplete(true))
        .addStringOption(opt => opt.setName('duracao').setDescription('Tempo (só Free — Rastreador+ usa a do nível). Ex: 10m, 1h, 3d, vazio=permanente').setRequired(false))
        .addStringOption(opt => opt.setName('discord_act').setDescription('Ação imediata no Discord (precisa do jogador ter Discord vinculado)')
            .addChoices(
                { name: 'Nenhuma', value: 'none' },
                { name: 'Mute (Timeout)', value: 'timeout' },
                { name: 'Expulsar (Kick)', value: 'kick' },
                { name: 'Banir (Ban)', value: 'ban' },
            ))
        .addStringOption(opt => opt.setName('report').setDescription('ID do Report (Opcional)').setRequired(false)),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== 'nivel') return interaction.respond([]).catch(() => {});

        const guildId = interaction.guildId;
        if (!guildId || !PremiumSystem.isGuildAtLeast(guildId, 'rastreador')) {
            return interaction.respond([]).catch(() => {});
        }

        const query = String(focused.value || '').toLowerCase();
        const levels = PunishmentLevels.getLevels(guildId)
            .filter((l) => l.name.toLowerCase().includes(query))
            .slice(0, 25);

        await interaction.respond(levels.map((l) => ({
            name: `${l.name} (${l.severity} · ${l.duration_str || 'Permanente'})`.slice(0, 100),
            value: String(l.id),
        }))).catch(() => {});
    },

    async execute(interaction, client) {
        const { guild, options } = interaction;
        const guildId = guild.id;

        const targetUserOption = options.getUser('usuario');
        const agidOption = options.getString('agid')?.trim() || null;
        const reason = options.getString('motivo');
        const nivelOption = options.getString('nivel') || null;
        const durationOption = options.getString('duracao') || null;
        const discordAct = options.getString('discord_act') || 'none';
        let reportId = options.getString('report') || null;

        try {
            if (!targetUserOption && !agidOption) {
                return await ResponseManager.error(interaction, 'Informe `usuario` e/ou `agid` pra identificar o jogador.');
            }

            if (reportId) {
                const result = validateReport(guildId, reportId);
                if (result.error) return await ResponseManager.error(interaction, result.error);
                reportId = result.reportId;
            }

            // ── Free: sem níveis disponíveis neste plano — mantém o registro
            // simples de sempre (sem RCON/nível/ação automática), só
            // usuario+motivo(+duração opcional). agid/nivel/discord_act não
            // se aplicam aqui (pedido explícito do dono). ──────────────────
            if (!PremiumSystem.isGuildAtLeast(guildId, 'rastreador')) {
                if (!targetUserOption) {
                    return await ResponseManager.error(interaction, 'No plano Free, informe `usuario` (Discord) — `agid` e níveis de punição exigem o plano Rastreador ou superior. Veja /premium.');
                }
                // registro.js lê `usuario`/`motivo`/`duracao`/`report` direto de
                // interaction.options — são os MESMOS nomes de opção deste
                // comando único agora (antes eram opções do subcomando
                // "registro"), então nenhuma mudança foi necessária nele.
                const registroHandler = require('./registro');
                return await registroHandler.execute(interaction, client);
            }

            // ── Rastreador+: nível sempre obrigatório. ──────────────────────
            const levels = PunishmentLevels.getLevels(guildId);
            if (levels.length === 0) {
                return await ResponseManager.error(interaction, 'Este servidor ainda não tem nenhum nível de punição configurado. Peça a um administrador para criar em /config punishments.');
            }
            if (!nivelOption) {
                return await ResponseManager.error(interaction, 'Informe o `nivel` de punição (obrigatório) — comece a digitar pra ver as opções.');
            }
            const level = PunishmentLevels.getLevel(guildId, nivelOption);
            if (!level) {
                return await ResponseManager.error(interaction, 'Este nível não existe (pode ter sido apagado) — selecione um da lista de autocomplete.');
            }

            await executeWithLevel(interaction, { targetUserOption, agidOption, reason, level, discordAct, reportId });
        } catch (error) {
            console.error('❌ Erro no /strike:', error);
            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao preparar aplicação de strike. A equipe foi notificada.');
        }
    },
};
