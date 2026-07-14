// src/systems/pot/buffStatCatalog.js
/**
 * Lista fechada dos atributos de jogador aceitos pelo comando RCON `setattr`
 * do Path of Titans, usada pelo painel /config buffs (select de atributo,
 * ver buffPanelSystem.js) e pra validar que um atributo salvo num buff é
 * conhecido.
 *
 * Lista CONFIRMADA pelo dono via teste real no servidor: de uma lista
 * inicial bem maior (~59 atributos, ver histórico do PREMIUM.txt), só
 * estes 10 realmente têm efeito via `setattr` — o resto foi removido do
 * catálogo de propósito (mantê-los deixaria o staff adicionar um atributo
 * que parece "aplicado com sucesso" pelo RCON mas não faz nada de verdade
 * no jogo, mesma armadilha silenciosa já vista com whisper/systemmessage
 * antes do alvo certo ser descoberto). Lista PLANA (sem categorias): com
 * só 10 itens, cabem tranquilamente num único StringSelectMenu (limite do
 * Discord é 25), então o passo intermediário de categoria foi removido do
 * painel também.
 *
 * Módulo puro (sem discord.js nem banco) — só dados + helper de validação.
 */
const KNOWN_STATS = [
    'Health',
    'Stamina',
    'Hunger',
    'Thirst',
    'Oxygen',
    'BleedAmount',
    'PoisonAmount',
    'VenomAmount',
    'LegDamage',
    'Growth',
];

function isKnownAttribute(attribute) {
    return KNOWN_STATS.includes(attribute);
}

module.exports = {
    KNOWN_STATS,
    isKnownAttribute,
};
