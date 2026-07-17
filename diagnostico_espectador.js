// diagnostico_espectador.js — rodar na VPS (dentro de ~/DiscStaffBot): node diagnostico_espectador.js
//
// Levanta, a partir dos dados que o PRÓPRIO bot já recebeu via webhook, quais
// jogadores/staff tiveram eventos AdminSpectate (entrada em modo espectador)
// registrados corretamente e quais sessões abriram mas nunca fecharam
// (PlayerRespawn nunca chegou) — usado pra montar a lista de Alderon ID +
// nome que a Alderon pediu no diagnóstico do problema de webhook do modo
// espectador, e pra achar o horário exato de uma falha real (pra saber qual
// PathOfTitans.log recortar).
//
// HIPÓTESE PRINCIPAL testada na seção 1: gatewayServer.js só processa
// AdminSpectate se `data.PlayerAlderonId || data.AdminAlderonId` existir —
// se a Alderon mandar o ID em um TERCEIRO nome de campo (ainda não visto em
// produção), o evento é persistido em pot_logs (cru) mas o registro de
// analytics é pulado SILENCIOSAMENTE, sem warning nenhum. Ver comentário em
// gatewayServer.js linha ~412-428 e analyticsSystem.js linha ~156-172.
const db = require('./src/database/index');

const STALE_HOURS = 2; // sessão aberta há mais tempo que isso = suspeita de falha no PlayerRespawn
const KNOWN_ACTIONS = ['Entered Spectator Mode', 'Exited Spectator Mode', 'Enabled Nametags', 'Disabled Nametags'];

console.log('=== 1. EVENTOS AdminSpectate SEM PlayerAlderonId/AdminAlderonId (payload cru) ===');
console.log('(campo ausente = o evento chegou mas o registro de analytics foi pulado silenciosamente)\n');
const allSpectate = db.prepare(`
    SELECT id, guild_id, event_data, player_name, alderon_id, created_at
    FROM pot_logs WHERE event_type = 'AdminSpectate' ORDER BY created_at DESC
`).all();

let missingIdCount = 0;
let unknownActionCount = 0;
for (const row of allSpectate) {
    let parsed = {};
    try { parsed = JSON.parse(row.event_data || '{}'); } catch (err) {}
    const ts = new Date(row.created_at * 1000).toISOString(); // created_at é em SEGUNDOS
    const hasKnownIdField = !!(parsed.PlayerAlderonId || parsed.AdminAlderonId);
    const actionKnown = KNOWN_ACTIONS.includes(parsed.Action);

    if (!hasKnownIdField) {
        missingIdCount++;
        console.log(`❌ SEM ID RECONHECIDO | id=${row.id} guild=${row.guild_id} | ${ts} | Action="${parsed.Action}"`);
        console.log(`   payload completo: ${JSON.stringify(parsed)}`);
    } else if (!actionKnown) {
        unknownActionCount++;
        console.log(`⚠️  ACTION DESCONHECIDA (não é Entered/Exited Spectator Mode nem Enabled/Disabled Nametags) | id=${row.id} guild=${row.guild_id} | ${ts} | Action="${parsed.Action}"`);
        console.log(`   payload completo: ${JSON.stringify(parsed)}`);
    }
}
console.log(`\nTotal: ${allSpectate.length} eventos AdminSpectate persistidos | ${missingIdCount} sem ID reconhecido | ${unknownActionCount} com Action não mapeada`);
if (!allSpectate.length) console.log('Nenhum evento AdminSpectate persistido ainda — ou o webhook nunca chegou a bater em /pot/admin?evt=AdminSpectate, ou pot_logs está vazio por outro motivo.');

console.log('\n=== 2. EVENTOS AdminSpectate RECEBIDOS COM SUCESSO (por jogador) ===');
const seen = db.prepare(`
    SELECT alderon_id, player_name, guild_id, COUNT(*) as total,
           MIN(created_at) as primeiro, MAX(created_at) as ultimo
    FROM pot_logs
    WHERE event_type = 'AdminSpectate' AND alderon_id IS NOT NULL
    GROUP BY guild_id, alderon_id
    ORDER BY ultimo DESC
`).all();
if (!seen.length) {
    console.log('Nenhum evento AdminSpectate com alderon_id preenchido.');
} else {
    for (const row of seen) {
        console.log(`AGID=${row.alderon_id} | ${row.player_name} | guild=${row.guild_id} | ${row.total} evento(s) | primeiro=${new Date(row.primeiro * 1000).toISOString()} | ultimo=${new Date(row.ultimo * 1000).toISOString()}`);
    }
}

console.log(`\n=== 3. SESSÕES DE ESPECTADOR "PRESAS" (abertas há mais de ${STALE_HOURS}h, sem PlayerRespawn correspondente) ===`);
const staleCutoff = Date.now() - STALE_HOURS * 60 * 60 * 1000;
const stuck = db.prepare(`SELECT * FROM pot_spectator_sessions WHERE started_at < ?`).all(staleCutoff);
if (!stuck.length) {
    console.log('Nenhuma sessão presa encontrada.');
} else {
    for (const row of stuck) {
        const player = db.prepare(`SELECT player_name FROM pot_players WHERE guild_id = ? AND alderon_id = ?`).get(row.guild_id, row.alderon_id);
        const hoursAgo = Math.round((Date.now() - row.started_at) / 3600000);
        console.log(`AGID=${row.alderon_id} | ${player?.player_name || '(nome desconhecido)'} | guild=${row.guild_id} | aberta em ${new Date(row.started_at).toISOString()} (${hoursAgo}h atrás) — provável falha no evento de saída (PlayerRespawn nunca chegou)`);
    }
}

console.log('\n=== 4. TODOS OS JOGADORES/STAFF VINCULADOS (player_links) — cruze com quem NUNCA apareceu na seção 2 ===');
const linked = db.prepare(`SELECT user_id, alderon_id, player_name FROM player_links ORDER BY player_name`).all();
for (const row of linked) {
    console.log(`AGID=${row.alderon_id} | ${row.player_name} | discord=${row.user_id}`);
}

// ── Seção 5 ──────────────────────────────────────────────────────────────
// O evento cru pode chegar 100% certo (seção 1 zerada) e AINDA ASSIM nunca
// virar tempo/contagem em staff_analytics: recordAdminSpectateEvent só
// credita se (a) o servidor for tier Caçador (_isAnalyticsAllowed) e (b) o
// AlderonId estiver vinculado via /registrar E o membro tiver, DE VERDADE,
// um dos cargos de staff no Discord no momento do evento
// (_resolveTrackedStaffMember) — nenhuma das duas checagens loga nada se
// falhar. Esta seção cruza os eventos crus (que sabemos que chegaram) com o
// que de fato foi creditado, pra achar exatamente quem está "sumindo" nesse
// meio de caminho.
console.log('\n=== 5. EVENTOS CRUS x CRÉDITO EM staff_analytics (por jogador com eventos na seção 2) ===');
const guildIds = [...new Set(seen.map(r => r.guild_id))];
for (const guildId of guildIds) {
    const premium = db.prepare(`SELECT tier FROM guild_premium WHERE guild_id = ?`).get(guildId);
    console.log(`guild=${guildId} | tier Server Premium: ${premium?.tier || 'free (sem linha em guild_premium)'}`);
}
console.log('');

for (const row of seen) {
    const link = db.prepare(`SELECT user_id FROM player_links WHERE alderon_id = ?`).get(row.alderon_id);
    if (!link?.user_id) {
        console.log(`❌ AGID=${row.alderon_id} (${row.player_name}) | ${row.total} evento(s) cru(s) | NÃO REGISTRADO via /registrar (player_links vazio) — recordAdminSpectateEvent para na 1ª checagem, nunca credita nada.`);
        continue;
    }

    const totals = db.prepare(`
        SELECT COALESCE(SUM(spectator_seconds), 0) as seconds,
               COALESCE(SUM(nametag_toggles_spectating), 0) as toggleOn,
               COALESCE(SUM(nametag_toggles_not_spectating), 0) as toggleOff
        FROM staff_analytics WHERE guild_id = ? AND user_id = ?
    `).get(row.guild_id, link.user_id);

    const credited = totals.seconds > 0 || totals.toggleOn > 0 || totals.toggleOff > 0;
    const flag = credited ? '✅' : '❌ SEM CRÉDITO';
    console.log(`${flag} AGID=${row.alderon_id} (${row.player_name}) discord=${link.user_id} | ${row.total} evento(s) cru(s) | staff_analytics: ${totals.seconds}s espectador, ${totals.toggleOn} toggle-on, ${totals.toggleOff} toggle-off`);
}

process.exit(0);
