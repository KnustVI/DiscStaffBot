const Database = require('better-sqlite3');

// Cria ou abre o banco
const db = new Database('database.sqlite');


/* =========================================
   CONFIGURAÇÕES DO SERVIDOR
   Armazena configurações como canais e cargos
========================================= */

db.prepare(`
CREATE TABLE IF NOT EXISTS settings (
    guild_id TEXT,
    key TEXT,
    value TEXT,
    PRIMARY KEY (guild_id, key)
)
`).run();


/* =========================================
   CONTROLE DE USUÁRIOS
   Armazena reincidência de punições
========================================= */

db.prepare(`
CREATE TABLE IF NOT EXISTS users (
     user_id TEXT PRIMARY KEY,
     reputation INTEGER DEFAULT 100,
     penalties INTEGER DEFAULT 0,
     last_infraction INTEGER
)
`).run();


/* =========================================
   HISTÓRICO DE PENALIDADES
   Registro simples de punições aplicadas
========================================= */

db.prepare(`
CREATE TABLE IF NOT EXISTS penalties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    staff_id TEXT,
    reason TEXT,
    date INTEGER
)
`).run();


/* =========================================
   SISTEMA COMPLETO DE PUNIÇÕES
   Estrutura preparada para moderação avançada
========================================= */

db.prepare(`
CREATE TABLE IF NOT EXISTS punishments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    user_id TEXT,
    moderator_id TEXT,
    reason TEXT,
    severity INTEGER,
    created_at TEXT
)
`).run();


module.exports = db;
