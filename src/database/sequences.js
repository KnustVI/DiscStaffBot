// /home/ubuntu/DiscStaffBot/src/database/sequences.js
const db = require('./index');

class SequenceManager {
    // Garantir que a tabela existe
    static ensureTable() {
        try {
            db.prepare(`
                CREATE TABLE IF NOT EXISTS sequences (
                    guild_id TEXT NOT NULL,
                    table_name TEXT NOT NULL,
                    next_value INTEGER DEFAULT 1,
                    PRIMARY KEY (guild_id, table_name)
                )
            `).run();
        } catch (err) {
            console.error('❌ Erro ao criar tabela sequences:', err.message);
        }
    }
    
    static getNextValue(guildId, tableName) {
        this.ensureTable();
        
        // Buscar próximo valor para este servidor e tabela
        let seq = db.prepare(`
            SELECT next_value FROM sequences 
            WHERE guild_id = ? AND table_name = ?
        `).get(guildId, tableName);
        
        if (!seq) {
            // Criar sequência para o servidor
            db.prepare(`
                INSERT INTO sequences (guild_id, table_name, next_value) 
                VALUES (?, ?, 1)
            `).run(guildId, tableName);
            return 1;
        }
        
        const nextValue = seq.next_value;
        
        // Atualizar próximo valor
        db.prepare(`
            UPDATE sequences 
            SET next_value = next_value + 1 
            WHERE guild_id = ? AND table_name = ?
        `).run(guildId, tableName);
        
        return nextValue;
    }
    
    static resetSequence(guildId, tableName) {
        this.ensureTable();
        
        db.prepare(`
            INSERT OR REPLACE INTO sequences (guild_id, table_name, next_value) 
            VALUES (?, ?, 1)
        `).run(guildId, tableName);
    }
    
    static resetAllSequences(guildId) {
        this.ensureTable();
        
        db.prepare(`DELETE FROM sequences WHERE guild_id = ?`).run(guildId);
    }
    
    static getSequenceValue(guildId, tableName) {
        this.ensureTable();
        
        let seq = db.prepare(`
            SELECT next_value FROM sequences 
            WHERE guild_id = ? AND table_name = ?
        `).get(guildId, tableName);
        
        return seq ? seq.next_value : 1;
    }
}

module.exports = SequenceManager;