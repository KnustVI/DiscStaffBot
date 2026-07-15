// src/systems/pot/buffStatCatalog.js
/**
 * Lista fechada dos atributos de jogador aceitos pelo comando RCON `setattr`
 * do Path of Titans, usada pelo painel /config buffs (select de atributo,
 * ver buffPanelSystem.js) e pra validar que um atributo salvo num buff é
 * conhecido.
 *
 * Lista definida pelo dono a partir de teste real no servidor: de uma lista
 * inicial bem maior (~59 atributos, ver histórico do PREMIUM.txt), reduzida
 * pros que realmente têm efeito via `setattr` — o resto foi removido do
 * catálogo de propósito (mantê-los deixaria o staff adicionar um atributo
 * que parece "aplicado com sucesso" pelo RCON mas não faz nada de verdade
 * no jogo, mesma armadilha silenciosa já vista com whisper/systemmessage
 * antes do alvo certo ser descoberto). Os 5 atributos "de teto" usam o
 * prefixo `Max` (MaxHealth/MaxStamina/MaxHunger/MaxThirst/MaxOxygen) —
 * correção do dono sobre a lista anterior, que usava os nomes sem prefixo.
 * Lista PLANA (sem categorias): mesmo com 17 itens, cabe tranquilamente num
 * único StringSelectMenu (limite do Discord é 25), então o passo
 * intermediário de categoria continua removido do painel.
 *
 * Módulo puro (sem discord.js nem banco) — só dados + helper de validação.
 */
const KNOWN_STATS = [
    'MaxHealth',
    'MaxStamina',
    'MaxHunger',
    'MaxThirst',
    'MaxOxygen',
    'BleedAmount',
    'PoisonAmount',
    'VenomAmount',
    'LegDamage',
    'Growth',
    'CombatWeight',
    'Armor',
    'MovementSpeedMultiplier',
    'SprintingSpeedMultiplier',
    'TrottingSpeedMultiplier',
    'HealthRecoveryRate',
    'StaminaRecoveryRate',
];

function isKnownAttribute(attribute) {
    return KNOWN_STATS.includes(attribute);
}

module.exports = {
    KNOWN_STATS,
    isKnownAttribute,
};
