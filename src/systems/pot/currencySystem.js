// src/systems/pot/currencySystem.js
/**
 * Conversão Ossos (Bones) <-> Marks — a Loja de Jogo (ver PREMIUM.txt
 * seção 122, pedido do dono 2026-08-07: "adicione um sistema de
 * conversor de moedas"). Ossos são moeda do BOT, saldo POR SERVIDOR desde
 * 2026-08-15 (pot_player_bones, ver potPlayerRegistry.js) — cada
 * conversão ganha/gasta Ossos só no `guildId` informado, nunca num pool
 * global; o teto diário do conversor (DAILY_MARKS_TO_BONES_LIMIT) também
 * é por servidor pelo mesmo motivo. Marks é moeda DO PRÓPRIO JOGO — o bot
 * nunca guarda um "saldo" dela, só manda RCON pro servidor de jogo
 * creditar/remover.
 *
 * Taxa: 1 Osso = 100 Marks, nos dois sentidos (pedido do dono).
 *
 * Jogador precisa estar ONLINE no servidor de jogo pras duas direções
 * (confirmado pelo dono 2026-08-07: "addmarks só funciona se o jogador
 * estiver online" e "o jogador tem q ta online para usar o conversor")
 * — checado via PlayerRegistry.getOnlinePotPlayer em _resolveTarget,
 * usando o mesmo pot_players.is_online já mantido pelos webhooks
 * PlayerLogin/PlayerLogout.
 *
 * Assimetria entre as 2 direções: Ossos→Marks é uma conversão SEGURA de
 * verdade (o bot controla o próprio saldo de Ossos, debita ANTES de
 * mandar o RCON, e devolve se o RCON falhar). Marks→Ossos tem uma
 * segurança mais fraca — não existe comando RCON catalogado pra
 * CONSULTAR o saldo atual de Marks do jogador (rconCommandCatalog.js só
 * tem setmarks/addmarks/removemarks, nenhum "getmarks"), então o bot
 * confia no valor informado pelo jogador antes de disparar `removemarks`.
 * O dono confirmou (2026-08-07) que o PRÓPRIO JOGO valida isso do lado
 * dele: "se o jogador não tiver a quantidade o comando não aplica" —
 * ou seja, um saldo insuficiente não credita Marks nenhum no jogador, só
 * que o RCON ainda responde com `success: true` (a conexão/comando em si
 * funcionou, só não teve efeito). Por isso `convertMarksToBones` repassa
 * `rconResult.response` (texto cru que o jogo devolveu) no resultado pro
 * jogador/staff conferir com os próprios olhos, em vez de tratar
 * `success: true` como confirmação de que os Marks foram mesmo
 * removidos — o texto exato de uma rejeição por saldo insuficiente ainda
 * não foi confirmado contra um servidor real, então não há parsing/regex
 * em cima dessa resposta, só exibição transparente. Risco residual
 * aceito pelo dono (a Alderon permite comércio de itens dentro do jogo
 * desde que a aquisição nunca envolva dinheiro real — Marks só é ganho
 * jogando, nunca comprado, então o pior caso aqui é um jogador tentando
 * "roubar" Ossos do bot com um valor de Marks que não tem, não uma
 * brecha de conformidade com a Alderon).
 *
 * Teto diário (pedido do dono, 2026-08-10) só na direção Marks→Ossos —
 * DAILY_MARKS_TO_BONES_LIMIT, ver convertMarksToBones e
 * potPlayerRegistry.js getMarksConvertedToday/addMarksConvertedToday.
 */
const PlayerRegistry = require('./potPlayerRegistry');
const PremiumSystem = require('../premium/premiumSystem');

const MARKS_PER_BONE = 100;

// Teto diário SÓ pra Marks->Ossos (pedido do dono, 2026-08-10: "possivel
// converter apenas 100000 marks por dia") — Ossos->Marks continua sem
// limite, é a direção "segura" (ver docblock acima). Reseta sozinho a
// cada dia novo, ver potPlayerRegistry.js getMarksConvertedToday.
const DAILY_MARKS_TO_BONES_LIMIT = 100000;

/**
 * Ambas as direções exigem: (1) jogador vinculado (/registrar — sem
 * Alderon ID não tem quem o RCON mire), (2) servidor no plano Caçador
 * (mesmo gate já usado por QUALQUER comando RCON manual, ver
 * GUILD_LIMITS.genericRconEnabled/executeRconSubcommand em
 * rconCommandCatalog.js) — a Loja de Jogo não abre uma porta nova de
 * RCON, só reaproveita a mesma já existente — e (3) jogador ONLINE
 * naquele servidor agora (ver aviso no topo do arquivo).
 *
 * @returns {{alderonId: string} | {error: string}}
 */
function _resolveTarget(discordId, guildId) {
    const link = PlayerRegistry.getPlayerByDiscordId(discordId);
    if (!link) {
        return { error: 'Você precisa vincular sua conta com /registrar antes de converter.' };
    }
    if (!PremiumSystem.getGuildLimits(guildId).genericRconEnabled) {
        return { error: 'Este servidor não está no plano Caçador — a Loja de Jogo depende do mesmo RCON liberado só nesse tier.' };
    }
    if (!PlayerRegistry.getOnlinePotPlayer(guildId, link.alderon_id)) {
        return { error: 'Você precisa estar online no servidor de jogo pra usar o conversor.' };
    }
    return { alderonId: link.alderon_id };
}

// Antes chamava potIntegration.executeCommand(...) direto, pulando
// PoTConfigSystem.executeRconCommand — único desvio do ponto único de RCON
// do bot (corrigido a pedido do dono, 2026-08-09: "canal que vai receber
// todas as logs relacionadas a comandos de rcon", ver
// potConfigSystem.executeRconCommand/_logRconExecution). `client` não é
// mais usado aqui (executeRconCommand resolve via global.client
// internamente, mesmo padrão de todo o resto do bot) — mantido como
// parâmetro só pra não quebrar as 2 chamadas existentes abaixo.
async function _executeRcon(client, guildId, command, context) {
    const PoTConfigSystem = require('./potConfigSystem');
    return await PoTConfigSystem.executeRconCommand(guildId, command, context);
}

/**
 * Converte Ossos (saldo do bot) em Marks (creditados no jogo via RCON
 * `addmarks`). Debita o saldo de Ossos ANTES de chamar o RCON — se o
 * RCON falhar (servidor offline, RCON não configurado, etc.), devolve o
 * saldo imediatamente, nunca deixa o jogador perder Ossos por uma falha
 * fora do controle dele.
 *
 * @param {import('discord.js').Client} client
 * @param {string} discordId
 * @param {string} guildId - servidor de jogo onde os Marks serão creditados
 * @param {number} bonesAmount - inteiro positivo
 * @returns {Promise<{ok: true, marksCredited: number, rconResponse: string} | {ok: false, error: string}>}
 */
async function convertBonesToMarks(client, discordId, guildId, bonesAmount) {
    if (!Number.isInteger(bonesAmount) || bonesAmount <= 0) {
        return { ok: false, error: 'Quantidade de Ossos inválida.' };
    }
    const target = _resolveTarget(discordId, guildId);
    if (target.error) return { ok: false, error: target.error };

    if (!PlayerRegistry.spendBones(discordId, guildId, bonesAmount)) {
        return { ok: false, error: 'Saldo de Ossos insuficiente.' };
    }

    const marksAmount = bonesAmount * MARKS_PER_BONE;
    const rconResult = await _executeRcon(client, guildId, `addmarks ${target.alderonId} ${marksAmount}`, { actor: `<@${discordId}>`, source: 'Loja de Jogo (Ossos→Marks)' });

    if (!rconResult.success) {
        PlayerRegistry.addBones(discordId, guildId, bonesAmount);
        return { ok: false, error: `Não foi possível creditar os Marks no jogo (${rconResult.error || 'erro desconhecido'}). Seus Ossos foram devolvidos.` };
    }

    return { ok: true, marksCredited: marksAmount, rconResponse: rconResult.response || '' };
}

/**
 * Converte Marks (in-game) em Ossos (saldo do bot) — ver aviso de
 * assimetria/confiança no topo do arquivo. Credita Ossos SE o RCON
 * `removemarks` responder sucesso no nível de transporte (comando
 * chegou e rodou) — mas isso NÃO garante que o jogo de fato tinha
 * saldo suficiente e removeu os Marks (o dono confirmou que o jogo
 * rejeita silenciosamente removeções sem saldo, sem virar um
 * `success: false` pro RCON). Por isso o texto cru devolvido pelo jogo
 * (`rconResult.response`) vai junto no resultado, pra dar transparência
 * real em vez de uma falsa certeza.
 *
 * @param {import('discord.js').Client} client
 * @param {string} discordId
 * @param {string} guildId
 * @param {number} marksAmount - qualquer inteiro >= MARKS_PER_BONE (não
 *   precisa mais ser múltiplo exato — pedido do dono, 2026-08-18: "remover
 *   o múltiplo do conversor que só permite converter de 100 em 100". O
 *   valor é arredondado PARA BAIXO até o múltiplo de MARKS_PER_BONE mais
 *   próximo antes de qualquer coisa (Ossos são inteiros, não dá pra
 *   creditar uma fração) — só essa parte arredondada é removida via RCON
 *   e conta pro teto diário; a sobra que não fechou 1 Osso simplesmente
 *   não é tocada, fica com o jogador pra próxima conversão.
 * @returns {Promise<{ok: true, bonesCredited: number, marksUsed: number, rconResponse: string} | {ok: false, error: string}>}
 */
async function convertMarksToBones(client, discordId, guildId, marksAmount) {
    if (!Number.isInteger(marksAmount) || marksAmount < MARKS_PER_BONE) {
        return { ok: false, error: `A quantidade mínima é ${MARKS_PER_BONE} Marks (1 Osso).` };
    }
    const bonesAmount = Math.floor(marksAmount / MARKS_PER_BONE);
    const marksUsed = bonesAmount * MARKS_PER_BONE;

    const target = _resolveTarget(discordId, guildId);
    if (target.error) return { ok: false, error: target.error };

    // Teto diário — checado ANTES do RCON (pedido do dono: nada de
    // remover Marks no jogo pra depois recusar creditar Ossos). POR
    // SERVIDOR desde 2026-08-15 (Ossos deixou de ser saldo global) — cada
    // servidor tem seu próprio teto de DAILY_MARKS_TO_BONES_LIMIT. Conta
    // contra marksUsed (o que de fato é removido), não o valor bruto
    // digitado — a sobra não convertida nunca sai do jogador, não faz
    // sentido contar pro teto.
    const convertedToday = PlayerRegistry.getMarksConvertedToday(discordId, guildId);
    if (convertedToday + marksUsed > DAILY_MARKS_TO_BONES_LIMIT) {
        const remaining = Math.max(0, DAILY_MARKS_TO_BONES_LIMIT - convertedToday);
        return {
            ok: false,
            error: remaining > 0
                ? `Limite diário do conversor: ${DAILY_MARKS_TO_BONES_LIMIT.toLocaleString('pt-BR')} Marks. Você já converteu ${convertedToday.toLocaleString('pt-BR')} hoje — ainda pode converter até ${remaining.toLocaleString('pt-BR')} Marks. Tente de novo amanhã pra converter mais.`
                : `Você já atingiu o limite diário do conversor (${DAILY_MARKS_TO_BONES_LIMIT.toLocaleString('pt-BR')} Marks). Tente de novo amanhã.`,
        };
    }

    const rconResult = await _executeRcon(client, guildId, `removemarks ${target.alderonId} ${marksUsed}`, { actor: `<@${discordId}>`, source: 'Loja de Jogo (Marks→Ossos)' });
    if (!rconResult.success) {
        return { ok: false, error: `Não foi possível remover os Marks no jogo (${rconResult.error || 'erro desconhecido'}).` };
    }

    PlayerRegistry.addBones(discordId, guildId, bonesAmount);
    PlayerRegistry.addMarksConvertedToday(discordId, guildId, marksUsed);
    return { ok: true, bonesCredited: bonesAmount, marksUsed, rconResponse: rconResult.response || '' };
}

module.exports = { MARKS_PER_BONE, DAILY_MARKS_TO_BONES_LIMIT, convertBonesToMarks, convertMarksToBones };
