// src/utils/userIdentity.js
/**
 * Bloco padrão de identificação de usuário, usado em TODO container que
 * "puxa" um usuário (strike, unstrike, repset, histórico, report-chat,
 * perfil/registrar...). Formato fixo:
 *
 *   ## <mention> | {PotLogo} {alderon_id}   (2ª metade só se registrado)
 *   {DiscLogo} username | {game} nome do personagem   (2ª metade só se registrado)
 *   {circlecheck} Conta linkada!   (só se registrado)
 *
 * Sempre combinado com um thumbnail do avatar via
 * AdvancedContainerBuilder.thumbnail(user.displayAvatarURL(...)) no section()
 * que recebe este texto.
 */
const PlayerRegistry = require('../systems/pot/potPlayerRegistry');

let EMOJIS = {};
try { EMOJIS = require('../database/emojis.js').EMOJIS || {}; } catch (err) {}

/**
 * @param {import('discord.js').User} discordUser
 * @returns {string}
 */
function buildIdentityBlock(discordUser) {
    const linked = discordUser?.id ? PlayerRegistry.getPlayerByDiscordId(discordUser.id) : null;

    let line1 = `## ${discordUser?.toString?.() || 'Desconhecido'}`;
    if (linked) line1 += ` | ${EMOJIS.PotLogo || '🦖'} \`${linked.alderon_id}\``;

    let line2 = `${EMOJIS.DiscLogo || '💬'} ${discordUser?.username || '?'}`;
    if (linked) line2 += ` | ${EMOJIS.game || '🎮'} ${linked.player_name}`;

    const lines = [line1, line2];
    if (linked) lines.push(`${EMOJIS.circlecheck || '✅'} Conta linkada!`);

    return lines.join('\n');
}

module.exports = { buildIdentityBlock };
