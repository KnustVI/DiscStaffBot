// src/systems/pot/levelSystem.js
/**
 * Progressão de Nível infinita baseada em XP (pedido do dono, 2026-08-11).
 * XP total já é creditado em player_links.xp (1 hora jogada = 1 XP, ver
 * potPlayerRegistry.js _creditPlaytimeCurrency; XP de missões, quando
 * existir, soma no mesmo campo via addXp) — este arquivo só faz a MATEMÁTICA
 * pura de converter XP <-> Nível, sem nenhuma leitura/escrita de banco.
 *
 * Curva escolhida pelo dono: XP_Total = 10 × Nível^2.2 (progressão rápida
 * nos primeiros níveis, cada vez mais lenta depois — sem teto de nível).
 * Alternativas mais "MMO" foram sugeridas (15×Nível^2.3, 20×Nível^2.5,
 * deixam níveis acima de 50 ainda mais raros) mas NÃO aplicadas — o dono
 * pediu esta fórmula especificamente. Trocar de curva no futuro é só mudar
 * XP_COEFFICIENT/XP_EXPONENT abaixo, nada mais no sistema depende do valor
 * exato delas.
 */

const XP_COEFFICIENT = 10;
const XP_EXPONENT = 2.2;

/**
 * XP mínimo necessário para ALCANÇAR um nível (nível 0 = 0 XP, sem
 * necessidade de nenhum jogo). Math.ceil (não round/floor): a curva real é
 * contínua (XP_Total = 10×Nível^2.2 raramente cai num inteiro exato), então
 * o menor XP INTEIRO que já conta como "chegou nesse nível" é sempre o teto
 * do valor contínuo — ver getLevelForXp abaixo pra por que isso importa.
 * @param {number} level - inteiro >= 0
 * @returns {number}
 */
function getXpForLevel(level) {
    const lvl = Math.max(0, Math.floor(level) || 0);
    if (lvl === 0) return 0;
    return Math.ceil(XP_COEFFICIENT * Math.pow(lvl, XP_EXPONENT));
}

/**
 * Nível correspondente a um total de XP — fórmula inversa (Nível =
 * floor((XP/10)^(1/2.2))), com uma rede de segurança contra imprecisão de
 * ponto flutuante: Math.pow com expoente fracionário pode devolver algo
 * como 5.999999999998 quando o valor exato é 6 (mais provável ainda em XP
 * muito alto, onde o erro relativo do float cresce) — o ajuste abaixo
 * corrige isso conferindo o resultado contra a fórmula direta
 * (getXpForLevel), garantindo o nível certo em qualquer magnitude de XP.
 * @param {number} xpTotal
 * @returns {number}
 */
function getLevelForXp(xpTotal) {
    const xp = Math.max(0, Math.floor(xpTotal) || 0);
    if (xp === 0) return 0;

    let level = Math.floor(Math.pow(xp / XP_COEFFICIENT, 1 / XP_EXPONENT));
    if (!Number.isFinite(level) || level < 0) level = 0;

    // Corrige overshoot/undershoot do Math.pow — sempre 0 ou 1 iteração na
    // prática, nunca um laço longo (o nível certo é único e finito).
    while (level > 0 && getXpForLevel(level) > xp) level--;
    while (getXpForLevel(level + 1) <= xp) level++;

    return level;
}

/**
 * Pacote completo de progressão pra exibição (perfil Discord/site, loja) —
 * nível atual, XP dentro do nível atual, XP necessária pro próximo nível e
 * percentual de progresso, tudo calculado dinamicamente a partir do XP
 * total (nunca armazenado separadamente).
 * @param {number} xpTotal
 * @returns {{level:number, xpTotal:number, xpForCurrentLevel:number, xpForNextLevel:number, xpIntoLevel:number, xpNeededForNextLevel:number, xpRemainingForNextLevel:number, percent:number}}
 */
function getLevelProgress(xpTotal) {
    const xp = Math.max(0, Math.floor(xpTotal) || 0);
    const level = getLevelForXp(xp);
    const xpForCurrentLevel = getXpForLevel(level);
    const xpForNextLevel = getXpForLevel(level + 1);
    const xpNeededForNextLevel = xpForNextLevel - xpForCurrentLevel;
    const xpIntoLevel = xp - xpForCurrentLevel;
    const percent = xpNeededForNextLevel > 0
        ? Math.min(100, Math.max(0, (xpIntoLevel / xpNeededForNextLevel) * 100))
        : 100;

    return {
        level,
        xpTotal: xp,
        xpForCurrentLevel,
        xpForNextLevel,
        xpIntoLevel,
        xpNeededForNextLevel,
        xpRemainingForNextLevel: Math.max(0, xpForNextLevel - xp),
        percent,
    };
}

module.exports = {
    XP_COEFFICIENT,
    XP_EXPONENT,
    getXpForLevel,
    getLevelForXp,
    getLevelProgress,
};
