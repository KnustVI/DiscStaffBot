// src/systems/pot/buffStatCatalog.js
/**
 * Lista fechada dos atributos de jogador aceitos pelo comando RCON `setattr`
 * do Path of Titans, organizados nas categorias definidas pelo dono — usada
 * pelo painel /config buffs (seleção por categoria, depois por atributo,
 * ver buffPanelSystem.js) e pra validar que um atributo salvo num buff é
 * conhecido. O site do jogo NÃO publica uma lista fechada (ver
 * rconCommandCatalog.js, campo `atributo` livre do /ingame-stats setattr) —
 * esta lista veio direto do dono, não de documentação externa.
 *
 * Módulo puro (sem discord.js nem banco) — só dados + helpers de busca.
 */
const STAT_CATEGORIES = [
    {
        key: 'vida', label: 'Vida',
        stats: ['Health', 'MaxHealth', 'HealthRecoveryRate', 'IncomingDamage', 'IncomingSurvivalDamage'],
    },
    {
        key: 'stamina', label: 'Stamina',
        stats: ['Stamina', 'MaxStamina', 'StaminaRecoveryRate'],
    },
    {
        key: 'peso_armadura', label: 'Peso e Armadura',
        stats: ['CombatWeight', 'Armor'],
    },
    {
        key: 'movimento', label: 'Movimento',
        stats: [
            'MovementSpeedMultiplier', 'SprintingSpeedMultiplier', 'TrottingSpeedMultiplier',
            'TurnRadiusMultiplier', 'TurnInPlaceRadiusMultiplier',
            'JumpForceMultiplier', 'AirControlMultiplier',
        ],
    },
    {
        key: 'comida', label: 'Comida (Corpo)',
        stats: ['BodyFoodAmount', 'CurrentBodyFoodAmount', 'BodyFoodAmountCorpseThreshold'],
    },
    {
        key: 'fome', label: 'Fome',
        stats: ['Hunger', 'MaxHunger', 'HungerDepletionRate', 'FoodConsumptionRate', 'HungerDamage'],
    },
    {
        key: 'sede', label: 'Sede',
        stats: ['Thirst', 'MaxThirst', 'ThirstDepletionRate', 'WaterConsumptionRate', 'ThirstDamage'],
    },
    {
        key: 'oxigenio', label: 'Oxigênio',
        stats: ['Oxygen', 'MaxOxygen', 'OxygenDepletionRate', 'OxygenRecoveryRate', 'OxygenDamage'],
    },
    {
        key: 'sangramento', label: 'Sangramento',
        stats: ['BleedingRate', 'BleedingHealRate', 'BleedAmount', 'IncomingBleedingRate'],
    },
    {
        key: 'veneno', label: 'Veneno',
        stats: [
            'PoisonRate', 'PoisonAmount', 'PoisonHealRate', 'IncomingPoisonRate',
            'VenomRate', 'VenomAmount', 'VenomHealRate', 'IncomingVenomRate',
        ],
    },
    {
        key: 'crescimento', label: 'Crescimento',
        stats: ['Growth', 'GrowthPerSecond', 'GrowthPerSecondMultiplier'],
    },
    {
        key: 'combate', label: 'Combate',
        stats: ['AttackDamage', 'BoneBreakChance', 'BoneBreakAmount', 'IncomingBoneBreakAmount'],
    },
    {
        key: 'ferimentos', label: 'Ferimentos',
        stats: ['FallDeathSpeed', 'FallingLegDamage', 'LegDamage', 'LegHealRate', 'LimpHealthThreshold'],
    },
];

function getCategory(categoryKey) {
    return STAT_CATEGORIES.find((c) => c.key === categoryKey) || null;
}

function isKnownAttribute(attribute) {
    return STAT_CATEGORIES.some((c) => c.stats.includes(attribute));
}

function findCategoryForAttribute(attribute) {
    return STAT_CATEGORIES.find((c) => c.stats.includes(attribute)) || null;
}

module.exports = {
    STAT_CATEGORIES,
    getCategory,
    isKnownAttribute,
    findCategoryForAttribute,
};
