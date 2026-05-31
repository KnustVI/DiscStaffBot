// /home/ubuntu/DiscStaffBot/src/database/sequences.js
const db = require('./index');

class SequenceManager {
    static getNextValue(guildId, tableName) {
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
        db.prepare(`
            INSERT OR REPLACE INTO sequences (guild_id, table_name, next_value) 
            VALUES (?, ?, 1)
        `).run(guildId, tableName);
    }
    
    static resetAllSequences(guildId) {
        db.prepare(`DELETE FROM sequences WHERE guild_id = ?`).run(guildId);
        // As sequências serão recriadas quando necessário
    }
}

module.exports = SequenceManager;