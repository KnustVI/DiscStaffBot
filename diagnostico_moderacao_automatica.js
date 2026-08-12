// diagnostico_moderacao_automatica.js — rodar na VPS: node diagnostico_moderacao_automatica.js [guildId]
// Mostra os últimos eventos ServerModerate crus (pot_logs) — payload
// COMPLETO como o servidor do Path of Titans mandou, sem filtrar campo
// nenhum — pra entender de verdade o que a moderação automática NATIVA do
// servidor (não o /strike do bot) andou fazendo. Sem guildId, mostra de
// todos os servidores configurados.
const db = require('./src/database/index');

const guildId = process.argv[2] || null;

const rows = guildId
    ? db.prepare(`
        SELECT id, guild_id, alderon_id, event_data, created_at FROM pot_logs
        WHERE event_type = 'ServerModerate' AND guild_id = ?
        ORDER BY created_at DESC LIMIT 20
    `).all(guildId)
    : db.prepare(`
        SELECT id, guild_id, alderon_id, event_data, created_at FROM pot_logs
        WHERE event_type = 'ServerModerate'
        ORDER BY created_at DESC LIMIT 20
    `).all();

console.log(`Últimos eventos ServerModerate${guildId ? ` (guild=${guildId})` : ' (todos os servidores)'}:\n`);

if (!rows.length) {
    console.log('Nenhum evento ServerModerate encontrado ainda — a moderação automática nativa do servidor nunca disparou (ou o webhook "Servidor" nunca foi configurado nesse servidor).');
} else {
    for (const r of rows) {
        let parsed = {};
        try { parsed = JSON.parse(r.event_data || '{}'); } catch (err) {}
        console.log(`── id=${r.id} | guild=${r.guild_id} | ${new Date(r.created_at * 1000).toISOString()} | AGID=${r.alderon_id || '?'}`);
        console.log(JSON.stringify(parsed, null, 2));
        console.log('');
    }
}

process.exit(0);
