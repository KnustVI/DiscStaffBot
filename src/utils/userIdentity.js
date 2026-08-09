// src/utils/userIdentity.js
/**
 * Bloco padrão de identificação de usuário, usado em TODO container que
 * "puxa" um usuário (strike, unstrike, repset, histórico, report-chat,
 * perfil/registrar...). Formato fixo:
 *
 *   ## <mention> | {PotLogo} {alderon_id}   (2ª metade só se registrado)
 *   {DiscLogo} username | {game} nome do personagem   (2ª metade só se registrado)
 *
 * Sem vínculo registrado, só a 1ª linha aparece (com o "Desconhecido"/mention
 * cru) — cabe ao chamador acrescentar seu próprio aviso de "não linkado" se
 * fizer sentido no contexto (ver _appendProfileCard em
 * playerRegistrationSystem.js). Quando HÁ vínculo, nenhuma linha extra
 * confirma isso — a própria presença do Alderon ID/nome do jogo já deixa
 * claro que a conta está linkada.
 *
 * Normalmente combinado com um thumbnail do avatar via
 * AdvancedContainerBuilder.thumbnail(user.displayAvatarURL(...)) no section()
 * que recebe este texto — exceto no modo `compact` (abaixo), pensado
 * exatamente para quando o chamador NÃO usa thumbnail nenhuma.
 */
const PlayerRegistry = require('../systems/pot/potPlayerRegistry');

let EMOJIS = {};
try { EMOJIS = require('../database/emojis.js').EMOJIS || {}; } catch (err) {}

/**
 * @param {import('discord.js').User} discordUser
 * @param {object} [options]
 * @param {boolean} [options.compact=false] - Pedido do dono, 2026-08-09
 *   ("No nome do usuários pode deixar eles menores"), usado só pelo painel
 *   de log da staff no ReportChat (ver reportChatSystem.createBaseContainer,
 *   audience 'staff') — troca a 1ª linha de heading (`## mention`) pro
 *   estilo "subtext" do Discord (`-# `, mesmo usado nos footers deste bot),
 *   bem menor e mais discreto. A 2ª linha (username/AGID) já era texto
 *   normal, sem heading, então não muda.
 * @returns {string}
 */
function buildIdentityBlock(discordUser, options = {}) {
    const linked = discordUser?.id ? PlayerRegistry.getPlayerByDiscordId(discordUser.id) : null;
    const headingPrefix = options.compact ? '-#' : '##';

    let line1 = `${headingPrefix} ${discordUser?.toString?.() || 'Desconhecido'}`;
    if (linked) line1 += ` | ${EMOJIS.PotLogo || '🦖'} \`${linked.alderon_id}\``;

    let line2 = `${EMOJIS.DiscLogo || '💬'} ${discordUser?.username || '?'}`;
    if (linked) line2 += ` | ${EMOJIS.game || '🎮'} ${linked.player_name}`;

    return [line1, line2].join('\n');
}

module.exports = { buildIdentityBlock };
