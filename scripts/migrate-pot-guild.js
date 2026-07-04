// scripts/migrate-pot-guild.js
//
// Copia a config de RCON (server_ip, rcon_port, rcon_password) do
// pot_server_config de um guild do Discord pra outro — usado quando a
// integração PoT foi configurada num guild errado (ex: servidor de teste em
// vez do Discord real da comunidade) e precisa mudar de guild sem digitar
// tudo de novo.
//
// NÃO copia webhooks (são específicos de canal — configure de novo com
// /potserver logs no guild novo) nem token (gerado automaticamente na
// primeira vez que /potserver setup ou /potserver status rodar no guild novo).
//
// Uso: node scripts/migrate-pot-guild.js <GUILD_ORIGEM> <GUILD_DESTINO> [nome_do_servidor]

const db = require('../src/database/index');

const oldGuildId = process.argv[2];
const newGuildId = process.argv[3];
const serverName = process.argv[4] || null;

if (!oldGuildId || !newGuildId) {
    console.log('Uso: node scripts/migrate-pot-guild.js <GUILD_ORIGEM> <GUILD_DESTINO> [nome_do_servidor]');
    process.exit(1);
}

const row = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(oldGuildId, 'pot_server_config');

if (!row) {
    console.log(`❌ Nenhuma config encontrada no guild de origem (${oldGuildId}).`);
    process.exit(1);
}

const config = JSON.parse(row.value);
if (serverName) config.server_name = serverName;
config.migrated_from = oldGuildId;
config.migrated_at = Date.now();

db.prepare(`
    INSERT INTO settings (guild_id, key, value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`).run(newGuildId, 'pot_server_config', JSON.stringify(config), Date.now());

console.log(`✅ Config migrada de ${oldGuildId} → ${newGuildId}`);
console.log(config);
console.log('\nPróximos passos:');
console.log('1. Rode /potserver status no guild novo pra confirmar RCON conectando.');
console.log('2. Rode /potserver logs no guild novo pra configurar os webhooks (não migrados — são por canal).');
console.log('3. Baixe o novo Game.ini pelo botão do painel e atualize no servidor de jogo.');
