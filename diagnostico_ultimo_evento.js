// diagnostico_ultimo_evento.js — rodar na VPS: node diagnostico_ultimo_evento.js [alderonId]
// Mostra os últimos eventos AdminSpectate crus (pot_logs) de um Alderon ID —
// default KnustVI (500-735-822) — pra confirmar se um teste ao vivo de
// "entrar no modo espectador" realmente chegou no webhook ou não.
const db = require('./src/database/index');

const alderonId = process.argv[2] || '500-735-822';

const rows = db.prepare(`
    SELECT id, event_data, created_at FROM pot_logs
    WHERE event_type = 'AdminSpectate' AND alderon_id = ?
    ORDER BY created_at DESC LIMIT 10
`).all(alderonId);

console.log(`Últimos eventos AdminSpectate de AGID=${alderonId}:\n`);
if (!rows.length) {
    console.log('Nenhum evento encontrado — nunca chegou nada pra esse Alderon ID.');
} else {
    for (const r of rows) {
        let parsed = {};
        try { parsed = JSON.parse(r.event_data || '{}'); } catch (err) {}
        console.log(`id=${r.id} | ${new Date(r.created_at * 1000).toISOString()} | Action="${parsed.Action}"`);
    }
}

process.exit(0);
