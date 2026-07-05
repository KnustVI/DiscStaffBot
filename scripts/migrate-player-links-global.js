// scripts/migrate-player-links-global.js
//
// Migra os vínculos Discord<->Alderon ID existentes em pot_players (que era
// guild-scoped, então o mesmo Discord podia ter Alderon IDs diferentes em
// servidores diferentes) para player_links (global, um vínculo por usuário).
//
// Regra de deduplicação: se o mesmo discord_id aparecer com Alderon IDs
// diferentes em guilds diferentes, vence o registro com o updated_at mais
// recente. Se dois discord_ids diferentes reivindicarem o mesmo Alderon ID
// (não deveria acontecer, mas os dados antigos não garantiam isso), o
// primeiro processado (mais recente) vence e o outro é reportado no console
// para revisão manual — não interrompe a migração dos demais.
//
// Rodar UMA VEZ em produção, logo após o deploy que introduziu player_links,
// antes de qualquer /registrar novo.
//
// Uso: node scripts/migrate-player-links-global.js

const db = require('../src/database/index');

(() => {
    const rows = db.prepare(`
        SELECT discord_id, alderon_id, player_name, updated_at
        FROM pot_players
        WHERE discord_id IS NOT NULL AND alderon_id IS NOT NULL
        ORDER BY updated_at DESC
    `).all();

    console.log(`Encontradas ${rows.length} linhas de pot_players com vínculo Discord.`);

    const seenByDiscord = new Map();
    const seenByAlderon = new Map();
    let inserted = 0;
    let skippedDiscordDup = 0;
    let skippedAlderonConflict = 0;

    const insert = db.prepare(`
        INSERT INTO player_links (user_id, alderon_id, player_name, registered_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO NOTHING
    `);

    for (const row of rows) {
        if (seenByDiscord.has(row.discord_id)) {
            skippedDiscordDup++;
            continue;
        }

        if (seenByAlderon.has(row.alderon_id) && seenByAlderon.get(row.alderon_id) !== row.discord_id) {
            console.warn(`⚠️ Conflito: Alderon ID ${row.alderon_id} já vinculado a ${seenByAlderon.get(row.alderon_id)}, ignorando duplicata de ${row.discord_id}. Revisar manualmente se necessário.`);
            skippedAlderonConflict++;
            continue;
        }

        seenByDiscord.set(row.discord_id, true);
        seenByAlderon.set(row.alderon_id, row.discord_id);

        const now = Date.now();
        insert.run(row.discord_id, row.alderon_id, row.player_name, now, row.updated_at || Math.floor(now / 1000));
        inserted++;
    }

    console.log(`✅ Migração concluída: ${inserted} vínculos criados em player_links.`);
    console.log(`   ${skippedDiscordDup} ignorados (discord_id já visto com Alderon ID mais recente).`);
    console.log(`   ${skippedAlderonConflict} conflitos de Alderon ID entre contas diferentes (revisar manualmente).`);
})();
