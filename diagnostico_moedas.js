// diagnostico_moedas.js — rodar na VPS (dentro de ~/DiscStaffBot):
//   node diagnostico_moedas.js <seu_discord_id, alderon_id ou nome do jogador>
//
// Pedido do dono, 2026-08-19: "só joguei em um servidor, tenho 4 horas
// registradas nele" — mas o saldo de Caçadas (Hunt, global) e Ossos
// (Bones, por servidor) não parecem bater entre si nem com o tempo total
// jogado. A explicação de "jogou em mais de 1 servidor" (Caçadas soma
// todos, Ossos é só daquele servidor) foi DESCARTADA pelo dono — precisa
// de dado real pra achar a causa.
//
// Junta, num SÓ snapshot (evita comparar números vistos em momentos
// diferentes, que sozinho já explicaria uma divergência aparente):
//   1. player_links — hunt_balance/xp/playtime_credit_seconds (carry
//      GLOBAL, soma sessões de QUALQUER servidor).
//   2. pot_players — total_playtime REAL por servidor (uma linha por
//      guild onde esse Alderon ID já foi visto), incluindo a sessão
//      ABERTA agora (se estiver online) somada à parte.
//   3. pot_player_bones — balance/playtime_credit_seconds (carry POR
//      SERVIDOR de Ossos) pra cada guild, comparado contra o
//      total_playtime REAL daquele mesmo servidor (ver item 2).
//
// Com os 3 lado a lado dá pra ver exatamente onde a conta para de bater:
// se total_playtime de UM servidor já é maior que o que o playtime_credit_
// seconds/balance daquele servidor sugere, o problema está em
// _creditGuildBones (ou em alguma sessão que fechou sem chamar
// _creditPlaytimeCurrency); se Ossos bate mas Caçadas não, o problema
// está do lado global (player_links) — ver potPlayerRegistry.js.
const db = require('./src/database/index');

const query = process.argv[2];
if (!query) {
    console.log('Uso: node diagnostico_moedas.js <discord_id, alderon_id ou nome do jogador>');
    process.exit(1);
}

let link = db.prepare(`SELECT * FROM player_links WHERE user_id = ? OR alderon_id = ?`).get(query, query);
if (!link) {
    const byName = db.prepare(`SELECT alderon_id FROM pot_players WHERE player_name = ? COLLATE NOCASE ORDER BY updated_at DESC LIMIT 1`).get(query);
    if (byName) link = db.prepare(`SELECT * FROM player_links WHERE alderon_id = ?`).get(byName.alderon_id);
}
if (!link) {
    console.log(`Nenhum vínculo (/registrar) encontrado pra "${query}". Tente o Discord ID, o Alderon ID (xxx-xxx-xxx) ou o nome exato do personagem em jogo.`);
    process.exit(1);
}

console.log('=== VÍNCULO (player_links) ===');
console.log(`discord=${link.user_id} | alderon_id=${link.alderon_id} | player_name=${link.player_name || '(sem nome salvo)'}`);
console.log(`Caçadas (hunt_balance): ${link.hunt_balance} | XP: ${link.xp} | sobra de segundos ainda não fechada (playtime_credit_seconds): ${link.playtime_credit_seconds}s`);

console.log('\n=== pot_players (uma linha por servidor onde este Alderon ID já foi visto) ===');
const players = db.prepare(`
    SELECT guild_id, player_name, total_playtime, is_online, session_started_at, updated_at
    FROM pot_players WHERE alderon_id = ?
`).all(link.alderon_id);

if (!players.length) {
    console.log('Nenhuma linha em pot_players pra este Alderon ID — nunca apareceu em nenhum webhook.');
}

let totalPlaytimeAllGuilds = 0;
for (const p of players) {
    const liveExtra = (p.is_online && p.session_started_at) ? Math.floor((Date.now() - p.session_started_at) / 1000) : 0;
    const effectiveSeconds = p.total_playtime + liveExtra;
    totalPlaytimeAllGuilds += effectiveSeconds;
    console.log(
        `guild=${p.guild_id} | ${p.player_name} | total_playtime (sessões já FECHADAS)=${p.total_playtime}s (${(p.total_playtime / 3600).toFixed(2)}h)` +
        (liveExtra ? ` | + ${liveExtra}s de sessão ABERTA agora, ainda NÃO creditada em moeda nenhuma` : '') +
        ` | online agora=${!!p.is_online} | atualizado ${new Date(p.updated_at * 1000).toISOString()}`
    );
}
console.log(`\nSoma de total_playtime de TODOS os servidores (+ sessão aberta, se houver): ${totalPlaytimeAllGuilds}s = ${(totalPlaytimeAllGuilds / 3600).toFixed(2)}h`);
console.log(`Caçadas esperadas por esse total, arredondado pra baixo (1 Caçada/hora fechada): ~${Math.floor(totalPlaytimeAllGuilds / 3600)} (a sessão aberta ainda não conta, só fecha no logout)`);
console.log(`Caçadas REAIS no saldo agora: ${link.hunt_balance}`);

console.log('\n=== pot_player_bones (Ossos, uma linha por servidor) ===');
// Pedido do dono, 2026-08-19 (3ª rodada): "ossos podem ser adquiridos por
// marks então no meu caso desconsidere" — o conversor Marks->Ossos
// (currencySystem.js convertMarksToBones) é OUTRA fonte legítima de Ossos
// fora da fórmula "tempo jogado × taxa", e NUNCA chama logActivity (achado
// junto com o de spendHunt na seção 236) — sem histórico persistente, só
// dá pra ver o total convertido HOJE (marks_converted_today/date, reseta
// todo dia). Por isso um SALDO MAIOR que o esperado não é sinal de bug
// por si só (pode ser conversão, de hoje ou de qualquer dia anterior) —
// só um saldo MENOR que o esperado continua sendo genuinamente suspeito
// (nada nesta lista credita Ossos além do tempo jogado).
const bones = db.prepare(`SELECT guild_id, balance, playtime_credit_seconds, marks_converted_today, marks_converted_date, updated_at FROM pot_player_bones WHERE user_id = ?`).all(link.user_id);
if (!bones.length) {
    console.log('Nenhuma linha em pot_player_bones pra este usuário — Ossos nunca foi creditado em NENHUM servidor ainda.');
} else {
    for (const b of bones) {
        const p = players.find(pp => pp.guild_id === b.guild_id);
        const playtimeThisGuild = p ? p.total_playtime : null;
        const expectedBones = playtimeThisGuild !== null ? Math.floor(playtimeThisGuild / 3600) * 5 : null;
        let match = '✅ bate';
        if (expectedBones !== null && expectedBones !== b.balance) {
            match = b.balance > expectedBones
                ? '⚠️ ACIMA do esperado (normal se converteu Marks->Ossos em algum momento, ver currencySystem.js — sem histórico persistente pra confirmar)'
                : '❌ ABAIXO do esperado (nada aqui credita Ossos além do tempo jogado — genuinamente suspeito, ver /moeda-admin "REMOVEU" acima antes de assumir bug)';
        }
        console.log(
            `guild=${b.guild_id} | Ossos=${b.balance} | sobra de segundos (carry, só deste servidor)=${b.playtime_credit_seconds}s | ` +
            `total_playtime FECHADO deste servidor=${playtimeThisGuild}s (${playtimeThisGuild !== null ? (playtimeThisGuild / 3600).toFixed(2) : '?'}h) | ` +
            `Ossos esperados (total_playtime/3600*5)=${expectedBones} | ${match}\n` +
            `  Marks convertidos HOJE: ${b.marks_converted_today || 0} (data: ${b.marks_converted_date || 'nunca'}) | atualizado ${new Date(b.updated_at * 1000).toISOString()}`
        );
    }
}

// ── Pedido do dono, 2026-08-19 (2ª rodada): novo teste real mostrou
// Caçadas ABAIXO do esperado (4 vs ~6) mas Ossos ACIMA (96 vs 30) — nas
// DUAS direções opostas, algo que um bug de subcrédito sozinho (seção
// 214) não explica, já que as duas moedas nascem da MESMA sessão dentro
// de _creditPlaytimeCurrency/_creditGuildBones. A fórmula do diagnóstico
// só sabe calcular "esperado" a partir de tempo jogado puro — não sabe
// nada sobre AJUSTES MANUAIS (/moeda-admin, testado nesta mesma sessão
// de desenvolvimento) nem GASTOS (Loja de Personalização, paga em
// Caçadas via spendHunt — nunca registrada em activity_logs, só dá pra
// ver pelo que está em image_inventory). Antes de assumir bug de novo,
// mostra essas 2 fontes conhecidas de divergência "normal" que a conta
// do PRÓPRIO DONO, sendo testada o dia inteiro, pode ter acumulado. ──
console.log('\n=== AJUSTES MANUAIS RECEBIDOS (/moeda-admin — activity_logs) ===');
const moedaAdminLogs = db.prepare(`
    SELECT guild_id, action, details, created_at FROM activity_logs
    WHERE action = 'moeda_admin_adjust' AND target_id = ?
    ORDER BY created_at ASC
`).all(link.user_id);
if (!moedaAdminLogs.length) {
    console.log('Nenhum ajuste manual via /moeda-admin registrado pra este usuário.');
} else {
    for (const row of moedaAdminLogs) {
        let d = {};
        try { d = JSON.parse(row.details || '{}'); } catch (e) {}
        console.log(`guild=${row.guild_id} | ${d.sub === 'remover' ? 'REMOVEU' : 'ADICIONOU'} ${d.quantidade} ${d.moeda} (${d.before} -> ${d.after}) | ${new Date(row.created_at * 1000).toISOString()}`);
    }
}

console.log('\n=== COMPRAS NA LOJA DE JOGO (gasta Ossos — activity_logs) ===');
const gameShopLogs = db.prepare(`
    SELECT guild_id, details, created_at FROM activity_logs
    WHERE action = 'game_shop_purchase' AND user_id = ?
    ORDER BY created_at ASC
`).all(link.user_id);
if (!gameShopLogs.length) {
    console.log('Nenhuma compra na Loja de Jogo registrada pra este usuário.');
} else {
    for (const row of gameShopLogs) {
        let d = {};
        try { d = JSON.parse(row.details || '{}'); } catch (e) {}
        console.log(`guild=${row.guild_id} | comprou "${d.itemName || d.itemId || '?'}" por ${d.price ?? '?'} Ossos | ${new Date(row.created_at * 1000).toISOString()}`);
    }
}

console.log('\n=== COMPRAS NA LOJA DE PERSONALIZAÇÃO (gasta Caçadas — image_inventory) ===');
// spendHunt (imageShopSystem.js) nunca chama logActivity — a única
// "prova" de que Caçadas foi gasto aqui é o item aparecer no inventário
// com source='purchase'. Sem preço salvo por linha (só o pool_id), então
// mostra o que foi comprado e quando, não quanto custou cada um.
const imagePurchases = db.prepare(`
    SELECT pool_type, pool_id, purchased_at FROM image_inventory
    WHERE user_id = ? AND source = 'purchase'
    ORDER BY purchased_at ASC
`).all(link.user_id);
if (!imagePurchases.length) {
    console.log('Nenhuma compra na Loja de Personalização registrada pra este usuário.');
} else {
    for (const row of imagePurchases) {
        console.log(`pool_type=${row.pool_type} | pool_id=${row.pool_id} | comprado em ${new Date(row.purchased_at * 1000).toISOString()}`);
    }
    console.log(`(${imagePurchases.length} compra(s) — confira o preço de cada uma em /dev/Loja pra saber quantas Caçadas isso consumiu no total)`);
}

console.log('\n=== HISTÓRICO DE SESSÕES (pot_logs — PlayerLogin/PlayerLogout/PlayerLeave) ===');
console.log('(só existe a partir de 2026-08-19 — eventos antigos não foram persistidos, ver PERSISTED_EVENTS em gatewayServer.js)\n');
const sessionEvents = db.prepare(`
    SELECT guild_id, event_type, event_data, created_at
    FROM pot_logs
    WHERE event_type IN ('PlayerLogin', 'PlayerLogout', 'PlayerLeave') AND alderon_id = ?
    ORDER BY created_at ASC
`).all(link.alderon_id);
if (!sessionEvents.length) {
    console.log('Nenhum evento registrado ainda pra este Alderon ID — ou é de antes da mudança, ou ainda não fez login/logout desde então.');
} else {
    for (const ev of sessionEvents) {
        console.log(`guild=${ev.guild_id} | ${ev.event_type} | ${new Date(ev.created_at * 1000).toISOString()}`);
    }
}

process.exit(0);
