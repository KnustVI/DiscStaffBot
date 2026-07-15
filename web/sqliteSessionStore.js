// web/sqliteSessionStore.js
/**
 * Session store do express-session (dashboard web) usando a MESMA conexão
 * better-sqlite3 já usada pelo resto do bot (ver src/database/index.js),
 * em vez do MemoryStore padrão (que o próprio express-session avisa não
 * ser adequado pra produção: vaza memória e todo mundo é deslogado a cada
 * restart do bot).
 *
 * Não usa nenhum pacote de terceiros de propósito: o óbvio pra isso
 * (better-sqlite3-session-store) foi arquivado/sem manutenção desde 2025,
 * e a alternativa mais popular (connect-sqlite3) depende do driver
 * `sqlite3` clássico — instalaria um SEGUNDO driver nativo de SQLite só
 * pra isso, quando o better-sqlite3 já resolve. A interface implementada
 * (get/set/destroy/touch) é o contrato padrão de `session.Store` do
 * próprio express-session.
 */
const session = require('express-session');
const db = require('../src/database');

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // mesmo padrão de dashboard.js (24h)

class SqliteSessionStore extends session.Store {
    constructor(options = {}) {
        super(options);
        const clearExpiredIntervalMs = options.clearExpiredIntervalMs ?? 15 * 60 * 1000;
        if (clearExpiredIntervalMs > 0) {
            this._interval = setInterval(() => this._clearExpired(), clearExpiredIntervalMs);
            this._interval.unref?.(); // não deve manter o processo vivo sozinho
        }
    }

    _expiresAt(sessionData) {
        const maxAge = sessionData?.cookie?.maxAge;
        return Date.now() + (typeof maxAge === 'number' ? maxAge : DEFAULT_MAX_AGE_MS);
    }

    _clearExpired() {
        try {
            db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
        } catch (err) {
            console.error('❌ [SqliteSessionStore] Erro ao limpar sessões expiradas:', err.message);
        }
    }

    get(sid, callback) {
        try {
            const row = db.prepare('SELECT session, expires FROM sessions WHERE sid = ?').get(sid);
            if (!row || row.expires < Date.now()) {
                return callback(null, null);
            }
            callback(null, JSON.parse(row.session));
        } catch (err) {
            callback(err);
        }
    }

    set(sid, sessionData, callback) {
        try {
            db.prepare(`
                INSERT INTO sessions (sid, session, expires)
                VALUES (?, ?, ?)
                ON CONFLICT(sid) DO UPDATE SET session = excluded.session, expires = excluded.expires
            `).run(sid, JSON.stringify(sessionData), this._expiresAt(sessionData));
            callback?.(null);
        } catch (err) {
            callback?.(err);
        }
    }

    destroy(sid, callback) {
        try {
            db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
            callback?.(null);
        } catch (err) {
            callback?.(err);
        }
    }

    touch(sid, sessionData, callback) {
        try {
            db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(this._expiresAt(sessionData), sid);
            callback?.(null);
        } catch (err) {
            callback?.(err);
        }
    }
}

module.exports = SqliteSessionStore;
