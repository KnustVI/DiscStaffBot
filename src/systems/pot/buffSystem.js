// src/systems/pot/buffSystem.js
/**
 * Buffs configuráveis por servidor — preset nomeado de alterações de
 * atributo (RCON `setattr`), "parecido com os níveis de punição" (pedido do
 * dono): configurado uma vez em /config buffs, reaplicado depois num
 * jogador com um comando só (/ingame-buff aplicar), em vez de repetir
 * `/ingame-stats setattr` atributo por atributo toda vez.
 *
 * CRUD é módulo puro (sem discord.js) — usado por buffPanelSystem.js
 * (painel) e ingame-buff.js (comando de aplicação). `applyBuffToPlayer` é a
 * única parte que fala com RCON de verdade.
 */
const db = require('../../database/index');
const PoTConfigSystem = require('./potConfigSystem');

function getBuffs(guildId) {
    return db.prepare(`SELECT * FROM buffs WHERE guild_id = ? ORDER BY created_at ASC`).all(guildId);
}

function getBuff(guildId, buffId) {
    return db.prepare(`SELECT * FROM buffs WHERE guild_id = ? AND id = ?`).get(guildId, buffId);
}

function getBuffStats(buffId) {
    return db.prepare(`SELECT * FROM buff_stats WHERE buff_id = ? ORDER BY id ASC`).all(buffId);
}

function createBuff(guildId, name, createdBy) {
    const uuid = db.generateUUID();
    const now = Date.now();
    const result = db.prepare(`
        INSERT INTO buffs (uuid, guild_id, name, created_at, created_by)
        VALUES (?, ?, ?, ?, ?)
    `).run(uuid, guildId, name, now, createdBy);
    return getBuff(guildId, result.lastInsertRowid);
}

// Sem FK viva pra punição alguma — um buff pode ser apagado a qualquer
// momento, sem afetar nenhum registro histórico (nada referencia buff_id
// fora deste módulo; aplicar um buff só gera activity_logs com os dados já
// resolvidos, não uma referência ao buff em si).
function deleteBuff(guildId, buffId) {
    const buff = getBuff(guildId, buffId);
    if (!buff) return null;
    db.prepare(`DELETE FROM buff_stats WHERE buff_id = ?`).run(buffId);
    db.prepare(`DELETE FROM buffs WHERE guild_id = ? AND id = ?`).run(guildId, buffId);
    return buff;
}

// Adicionar o MESMO atributo de novo sobrescreve o valor (UNIQUE(buff_id,
// attribute) faz o ON CONFLICT funcionar), nunca duplica a linha.
function upsertBuffStat(buffId, attribute, value) {
    db.prepare(`
        INSERT INTO buff_stats (buff_id, attribute, value)
        VALUES (?, ?, ?)
        ON CONFLICT(buff_id, attribute) DO UPDATE SET value = excluded.value
    `).run(buffId, attribute, value);
}

function removeBuffStat(buffId, attribute) {
    db.prepare(`DELETE FROM buff_stats WHERE buff_id = ? AND attribute = ?`).run(buffId, attribute);
}

/**
 * Aplica TODOS os atributos de um buff num jogador, um `setattr` de cada
 * vez (sequencial, não em paralelo — mesmo cuidado de não afogar a conexão
 * RCON já usado em outros lugares do bot). Não checa se o jogador está
 * online — quem chama (ingame-buff.js) já faz essa checagem ANTES de
 * chegar aqui, pedido explícito do dono ("verifique se o jogador esta
 * online antes de aplicar").
 *
 * @returns {Promise<Array<{attribute: string, value: string, success: boolean, error?: string}>>}
 */
async function applyBuffToPlayer(guildId, buffId, targetAlderonId) {
    const stats = getBuffStats(buffId);
    const results = [];
    for (const stat of stats) {
        const command = `setattr ${targetAlderonId} ${stat.attribute} ${stat.value}`;
        const rconResult = await PoTConfigSystem.executeRconCommand(guildId, command).catch((err) => ({ success: false, error: err.message }));
        results.push({
            attribute: stat.attribute,
            value: stat.value,
            success: !!rconResult?.success,
            error: rconResult?.success ? null : (rconResult?.error || 'Erro desconhecido'),
        });
    }
    return results;
}

module.exports = {
    getBuffs,
    getBuff,
    getBuffStats,
    createBuff,
    deleteBuff,
    upsertBuffStat,
    removeBuffStat,
    applyBuffToPlayer,
};
