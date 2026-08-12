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
 *     `usuario` + `motivo` — mesmo comportamento do antigo
 *     `/strike registro`, sem quebrar o que já era documentado no Free
 *     (ver PREMIUM.txt, seção 1). SEMPRE permanente (ver duração abaixo).
 *   - Rastreador+: nível sempre obrigatório, a duração/pontos/ação em jogo
 *     vêm SEMPRE do nível escolhido — mescla o que antes eram
 *     `/strike ingame` (aceita AGID não vinculado, alvo sintético) e
 *     `/strike personalizado` (aceita usuario OU agid, resolve o vínculo
 *     que faltar), sem o modo manual livre de nível (removido — todo
 *     strike agora usa um nível).
 *
 * Duração (pedido do dono, 2026-08-07: "Remover parâmetro pedido de
 * duração do comando /strike, vamos sempre usar a duração configurada em
 * NÍVEL") — a opção `duracao` foi REMOVIDA do comando inteiro, não só do
 * caminho Rastreador+ (que já ignorava esse valor mesmo antes, sempre
 * usando a duração do nível escolhido). Efeito colateral aceito no Free
 * (não tem nível pra puxar duração nenhuma): todo strike registrado nesse
 * tier agora é SEMPRE permanente — antes dava pra informar um valor
 * manual tipo "10m"/"1h"/"3d", ver registro.js.
 *
 * Regras de identificação (Rastreador+, pedido literal do dono):
 *   - Nem usuario nem agid informados → erro exigindo pelo menos um.
 *   - Só agid, sem conta Discord vinculada → segue como alvo sintético
 *     "só em jogo" (ver PunishmentSystem._unregisteredTargetId): registra
 *     a punição e aplica a ação em jogo do nível normalmente.
 *   - Só usuario, sem AGID vinculado → erro pedindo pra refazer o comando
 *     já com `agid`, orientando o jogador a rodar /registrar (a ação em
 *     jogo do nível PRECISA de um Alderon ID real pra funcionar).
 *
 * Ação no Discord REMOVIDA (pedido do dono, 2026-08-11: "Vamos remover o
 * discord act e deixar o bot apenas para a interação com o jogo mesmo") —
 * a opção `discord_act` (timeout/kick/ban NATIVO do Discord, vinda da
 * seção 75 do PREMIUM.txt) foi removida por completo do schema e de todo
 * o fluxo (ver punishmentSystem.js). O bot não aplica mais NENHUMA ação
 * automática no Discord via /strike — só a ação em jogo (RCON) do nível
 * escolhido. `applyTemporaryRole` (cargo de Strike configurável em
 * /config roles) continua existindo — é uma feature própria, não fazia
 * parte de `discord_act`.
 *
 * Motivo × Observações (pedido do dono, 2026-08-11): `motivo` (sempre
 * obrigatório) é o texto que o JOGADOR vê em jogo — vai pro RCON como o
 * "Motivo_Jogador" da sintaxe oficial de /ban do PoT (ver
 * punishmentSystem._executeStrike pro motivo completo da sintaxe de dois
 * motivos entre aspas). `observacoes` (opcional, novo) é uma nota INTERNA
 * da staff — nunca sai pro RCON nem é mostrada ao jogador, só fica salva
 * no registro da punição (coluna `notes`).
 */
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const PunishmentLevels = require('../../systems/moderation/punishmentLevels');
const { getPlayerByAlderonId, getPlayerByDiscordId, getPlayerNameByAlderonId } = require('../../systems/pot/potPlayerRegistry');

let emojis = {};
try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

function validateReport(guildId, reportId) {
    // Aceita o prefixo NOVO (#REP, pedido do dono 2026-08-09: "Mudaremos o
    // nome da identificação de reportes... #r(numero) para #REP(NUMERO)")
    // e o ANTIGO (#R) — mantém compatibilidade com quem ainda digita do
    // jeito antigo, sem quebrar nada.
    const match = reportId.trim().match(/^#?(REP|R)?(\d+)$/i);
    if (!match) return { error: 'ID de Report inválido. Use o formato #REP5 (ou apenas 5).' };
    const reportNumber = parseInt(match[2]);
    const reportExists = db.prepare(`SELECT 1 FROM reports WHERE guild_id = ? AND report_number = ?`).get(guildId, reportNumber);
    if (!reportExists) return { error: `Report #REP${reportNumber} não encontrado neste servidor.` };
    return { reportId: `#REP${reportNumber}` };
}

/**
 * Alvo já identificado (Discord real ou sintético) + nível escolhido — monta
 * a sessão, checa hierarquia e mostra a MESMA prévia de confirmação de
 * sempre (PunishmentSystem.buildStrikeConfirmPreview). Duração/pontos/ação
 * em jogo vêm sempre do nível, nunca de um valor manual.
 */
async function proceedWithLevel(interaction, { targetId, alderonId, targetPlayerName, reason, level, reportId, noteText, notes }) {
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
        jogoAct: level.action || 'none',
        levelRequiresApproval: !!level.requires_supervisor_approval,
        noteText: noteText || null,
        notes: notes || null,
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
async function executeWithLevel(interaction, { targetUserOption, agidOption, reason, level, reportId, notes }) {
    const guildId = interaction.guildId;

    // Caso 1: usuario E agid informados — identidade já completa, nenhuma busca necessária.
    if (targetUserOption && agidOption) {
        return await proceedWithLevel(interaction, {
            targetId: targetUserOption.id, alderonId: agidOption, targetPlayerName: null,
            reason, level, reportId, notes,
        });
    }

    // Caso 2: só agid — busca vínculo Discord.
    if (agidOption) {
        const link = getPlayerByAlderonId(agidOption);
        if (link) {
            return await proceedWithLevel(interaction, {
                targetId: link.user_id, alderonId: agidOption, targetPlayerName: link.player_name || null,
                reason, level, reportId, notes,
            });
        }

        // Não encontrado: alvo sintético "só em jogo" — a própria prévia de
        // confirmação (JOGADOR sem Discord vinculado) já deixa isso claro
        // antes do staff confirmar; a ação em jogo do nível segue normalmente
        // (o bot não tenta mais nenhuma ação no Discord, ver docblock do topo).
        const playerName = getPlayerNameByAlderonId(guildId, agidOption) || null;
        const PunishmentSystem = require('../../systems/moderation/punishmentSystem');
        return await proceedWithLevel(interaction, {
            targetId: PunishmentSystem._unregisteredTargetId(agidOption), alderonId: agidOption, targetPlayerName: playerName,
            reason, level, reportId, notes,
            noteText: `AGID \`${agidOption}\` não está vinculado a nenhuma conta Discord — a punição será registrada e a ação em jogo do nível (se houver) aplicada normalmente.`,
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
        reason, level, reportId, notes,
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('strike')
        .setDescription('⚖️ Aplica uma punição a um jogador.')
        // null (não ModerateMembers): pedido do dono, 2026-08-07 — "Alguns
        // cargos configurados não conseguem aplicar o strike e outros sim".
        // ModerateMembers como default fazia o DISCORD bloquear a interação
        // ANTES dela sequer chegar no bot, pra qualquer cargo configurado em
        // /config roles que não tivesse TAMBÉM essa permissão nativa — sem
        // relação nenhuma com quem o bot considera staff, e sem log nenhum
        // do nosso lado (o bot nunca recebe o evento). Servidor que já tinha
        // sobrescrito isso manualmente por Integrações continua igual; quem
        // nunca mexeu lá passa a funcionar pra qualquer cargo Moderador/
        // Supervisor configurado, sem precisar de setup adicional fora do
        // bot. A checagem real (cargo configurado OU Administrador) já
        // acontece dentro de execute(), então nada fica sem proteção.
        .setDefaultMemberPermissions(null)
        // Discord exige que opções obrigatórias venham ANTES das opcionais
        // na lista (rejeitado com erro 50035/APPLICATION_COMMAND_OPTIONS_
        // REQUIRED_INVALID se não seguir essa ordem — usuario/agid vinham
        // antes de motivo, o deploy inteiro falhava e o servidor ficava com
        // a definição antiga do comando, sem nenhum aviso visível pro
        // staff). `motivo` é a ÚNICA opção realmente obrigatória no schema
        // do Discord (usuario/agid são opcionais no schema mesmo sendo "pelo
        // menos um dos dois" na prática — isso é validado em código, não dá
        // pra expressar "um OU outro" na API do Discord).
        // Motivo: pedido do dono, 2026-08-11 — este texto é o que o JOGADOR
        // vê em jogo (banner de ban/mute), não uma anotação interna da
        // staff (isso é `observacoes`, abaixo). setMaxLength(120): trava de
        // segurança no próprio Discord (recusa o envio antes de chegar no
        // bot) — texto maior que isso estoura a UI do menu principal do PoT
        // e é cortado (limite sugerido pelo dono: 100-120 caracteres). Uma
        // sanitização adicional roda em punishmentSystem.js antes de ir pro
        // RCON (aspas/quebra de linha quebram o comando no console do PoT).
        // Descrição da OPÇÃO (não o texto em si) tem que caber em 100
        // caracteres — limite real do Discord pra descrição de qualquer
        // option; passar disso faz o SlashCommandBuilder falhar já no
        // deploy.js com "Invalid string length" (bug real encontrado
        // 2026-08-11: a validação do discord.js não dá um erro claro de
        // "descrição longa demais", só estoura numa string gigante — sem
        // relação nenhuma com maxLength do VALOR do campo, que é outro
        // limite, esse sim de 120). Todas as descrições abaixo foram
        // contadas e ficam ≤100.
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo — texto que o JOGADOR vê em jogo (banido/silenciado). Seja claro e direto.').setRequired(true).setMaxLength(120))
        .addUserOption(opt => opt.setName('usuario').setDescription('Membro infrator no Discord (informe este e/ou agid)').setRequired(false))
        .addStringOption(opt => opt.setName('agid').setDescription('Alderon ID do jogador (informe este e/ou usuario)').setRequired(false))
        .addStringOption(opt => opt.setName('nivel').setDescription('Nível de punição (obrigatório a partir do Rastreador — comece a digitar pra ver as opções)').setRequired(false).setAutocomplete(true))
        .addStringOption(opt => opt.setName('report').setDescription('ID do Report a vincular (opcional) — digite só o número (ex: 5) ou #REP5.').setRequired(false))
        // Observações: pedido do dono, 2026-08-11 — nota INTERNA da staff,
        // nunca enviada ao RCON/jogo nem mostrada ao jogador, só gravada no
        // registro da punição (coluna `notes`, já existia sem uso).
        .addStringOption(opt => opt.setName('observacoes').setDescription('Nota interna da staff (opcional) — NÃO vai pro jogo nem aparece pro jogador, só fica no registro.').setRequired(false).setMaxLength(500)),

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
        const { guild, options, member } = interaction;
        const guildId = guild.id;

        const targetUserOption = options.getUser('usuario');
        const agidOption = options.getString('agid')?.trim() || null;
        const reason = options.getString('motivo');
        const nivelOption = options.getString('nivel') || null;
        const notes = options.getString('observacoes')?.trim() || null;
        let reportId = options.getString('report') || null;

        try {
            // ── Checagem REAL de permissão (pedido do dono, 2026-08-07): o
            // default do Discord acima (ModerateMembers) é só um PONTO DE
            // PARTIDA sugerido — qualquer servidor pode reatribuir essa
            // permissão nativa livremente pelas próprias Integrações, sem
            // relação nenhuma com quem o bot considera staff. Punição só
            // pode ser aplicada por quem tem o cargo Moderador OU Supervisor
            // configurado em /config roles (Supervisor conta como Moderador,
            // ver ConfigSystem.memberHasModOrSupervisorRole), ou por um
            // Administrador de verdade do servidor — mesmo padrão já usado
            // pelos comandos /ingame-*. ──────────────────────────────────
            const ConfigSystem = require('../../systems/core/configSystem');
            if (!ConfigSystem.memberHasModOrSupervisorRole(guildId, member) && !ConfigSystem.memberIsGuildAdmin(guildId, member)) {
                return await ResponseManager.error(interaction, 'Este comando é restrito à equipe do servidor (cargo Moderador ou Supervisor, ver /config roles) ou a Administradores.');
            }

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
            // usuario+motivo(+observacoes), sempre permanente (ver duração
            // no docblock do topo). agid/nivel não se aplicam aqui (pedido
            // explícito do dono). ────────────────────────────────────────
            if (!PremiumSystem.isGuildAtLeast(guildId, 'rastreador')) {
                if (!targetUserOption) {
                    return await ResponseManager.error(interaction, 'No plano Free, informe `usuario` (Discord) — `agid` e níveis de punição exigem o plano Rastreador ou superior. Veja /premium.');
                }
                // registro.js lê `usuario`/`motivo`/`report` direto de
                // interaction.options — mesmos nomes de opção deste comando
                // único, então nenhuma mudança foi necessária nele além de
                // `duracao` sempre vir ausente agora (opção removida do
                // schema — ver docblock do topo).
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
            // getLevelByIdOrName (não getLevel sozinha) — pedido do dono,
            // 2026-08-07: "o comando não identifica o nível". O Discord não
            // obriga o valor de uma opção de texto com autocomplete a ser
            // uma das sugestões — um staff que digita o NOME do nível (ex:
            // "Grave") em vez de clicar na sugestão manda esse texto como
            // valor, não o ID esperado. Ver docblock de getLevelByIdOrName
            // em punishmentLevels.js pro raciocínio completo.
            const level = PunishmentLevels.getLevelByIdOrName(guildId, nivelOption);
            if (!level) {
                return await ResponseManager.error(interaction, 'Este nível não existe (pode ter sido apagado ou o nome não bate exatamente) — selecione um da lista de autocomplete.');
            }

            await executeWithLevel(interaction, { targetUserOption, agidOption, reason, level, reportId, notes });
        } catch (error) {
            console.error('❌ Erro no /strike:', error);
            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao preparar aplicação de strike. A equipe foi notificada.');
        }
    },
};
