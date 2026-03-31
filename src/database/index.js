const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const SCHEMA = require('./schema');

class DatabaseManager {
    constructor(options = {}) {
        this.options = {
            dbPath: options.dbPath || path.join(__dirname, '../../database.sqlite'),
            verbose: options.verbose || false,
            enableWal: options.enableWal !== false,
            ...options
        };
        
        this.db = null;
        this.isConnected = false;
        this.transactions = [];
        
        this.init();
    }
    
    /**
     * Gera um UUID único
     */
    generateUUID() {
        return crypto.randomUUID();
    }
    
    /**
     * Inicializa a conexão com o banco de dados
     */
    init() {
        try {
            // Garantir que o diretório existe
            const dbDir = path.dirname(this.options.dbPath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }
            
            // Conectar ao banco
            this.db = new Database(this.options.dbPath, {
                verbose: this.options.verbose ? console.log : null
            });
            
            // Configurações de performance
            if (this.options.enableWal) {
                this.db.pragma('journal_mode = WAL');
            }
            this.db.pragma('synchronous = NORMAL');
            this.db.pragma('cache_size = 10000');
            this.db.pragma('temp_store = MEMORY');
            this.db.pragma('foreign_keys = ON'); // IMPORTANTE: manter integridade referencial
            
            this.isConnected = true;
            
            // Criar todas as tabelas
            this.createAllTables();
            
            console.log('✅ Banco de dados SQLite conectado com sucesso');
            
        } catch (error) {
            console.error('❌ Erro ao conectar ao banco de dados:', error);
            throw error;
        }
    }
    
            /**
     * Cria índices apenas para tabelas que existem
     */
    createIndexes() {
        const { INDEXES } = require('./schema');
        
        for (const indexSql of INDEXES) {
            try {
                // Extrair nome da tabela
                const match = indexSql.match(/ON\s+(\w+)/i);
                if (match) {
                    const tableName = match[1];
                    
                    // Verificar se a tabela existe
                    const tableCheck = this.db.prepare(`
                        SELECT name FROM sqlite_master 
                        WHERE type='table' AND name = ?
                    `).get(tableName);
                    
                    if (tableCheck) {
                        this.db.exec(indexSql);
                    }
                } else {
                    // Tentar criar mesmo assim
                    this.db.exec(indexSql);
                }
            } catch (err) {
                // Ignorar erros silenciosamente
                if (!err.message.includes('already exists')) {
                    // console.log(`   ⚠️ Índice ignorado: ${err.message}`);
                }
            }
        }
    }


        /**
     * Cria todas as tabelas do schema
     */
    createAllTables() {
        try {
            // 1. Primeiro, criar as tabelas principais em ordem de dependência
            const tablesInOrder = [
                'users',        // Base
                'guilds',       // Base
                'settings',     // Depende de guilds
                'reputation',   // Depende de users e guilds
                'punishments',  // Depende de users e guilds
                'tickets',      // Depende de users e guilds
                'ticket_messages', // Depende de tickets
                'staff_analytics', // Depende de users e guilds
                'activity_logs',   // Depende de users e guilds
                'temporary_roles', // Depende de users e guilds
                'feedbacks'        // Depende de users e guilds
            ];
            
            for (const table of tablesInOrder) {
                if (SCHEMA[table]) {
                    try {
                        this.db.exec(SCHEMA[table]);
                        console.log(`   ✅ Tabela ${table} criada/verificada`);
                    } catch (err) {
                        console.error(`   ❌ Erro ao criar tabela ${table}:`, err.message);
                    }
                }
            }
            
            // 2. Aguardar um momento para garantir que as tabelas foram criadas
            // (SQLite é síncrono, então não precisa de await, mas vamos verificar)
            
            // 3. Verificar se as tabelas existem antes de criar índices
            const { INDEXES } = require('./schema');
            
            console.log('   📊 Criando índices...');
            
            for (const indexSql of INDEXES) {
                try {
                    // Extrair o nome da tabela do índice para verificar se existe
                    const tableMatch = indexSql.match(/ON\s+(\w+)/i);
                    const tableName = tableMatch ? tableMatch[1] : null;
                    
                    if (tableName) {
                        // Verificar se a tabela existe
                        const tableExists = this.db.prepare(`
                            SELECT name FROM sqlite_master 
                            WHERE type='table' AND name=?
                        `).get(tableName);
                        
                        if (tableExists) {
                            this.db.exec(indexSql);
                            // console.log(`   ✅ Índice criado para ${tableName}`);
                        } else {
                            // console.log(`   ⏭️ Pulando índice para ${tableName} (tabela não existe ainda)`);
                        }
                    } else {
                        // Tentar criar mesmo assim
                        this.db.exec(indexSql);
                    }
                } catch (err) {
                    // Ignorar erros de índices (podem já existir)
                    if (!err.message.includes('already exists')) {
                        console.log(`   ⚠️ Índice ignorado: ${err.message.slice(0, 50)}...`);
                    }
                }
            }
            
            console.log('📋 Schema do banco de dados verificado/criado');
            
        } catch (error) {
            console.error('❌ Erro ao criar tabelas:', error);
            throw error;
        }
    }
    
    /**
     * Garante que um usuário existe na tabela de usuários
     */
    ensureUser(userId, username = null, discriminator = null, avatar = null) {
        const existing = this.prepare('SELECT user_id FROM users WHERE user_id = ?').get(userId);
        
        if (!existing) {
            this.prepare(`
                INSERT INTO users (user_id, username, discriminator, avatar, created_at, first_seen, last_seen)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                userId, 
                username || 'unknown', 
                discriminator || '0000', 
                avatar || null,
                Date.now(),
                Date.now(),
                Date.now()
            );
        } else if (username) {
            // Atualizar informações se necessário
            this.prepare(`
                UPDATE users SET 
                    username = COALESCE(?, username),
                    discriminator = COALESCE(?, discriminator),
                    avatar = COALESCE(?, avatar),
                    last_seen = ?
                WHERE user_id = ?
            `).run(username, discriminator, avatar, Date.now(), userId);
        } else {
            // Apenas atualizar last_seen
            this.prepare(`UPDATE users SET last_seen = ? WHERE user_id = ?`).run(Date.now(), userId);
        }
        
        return true;
    }
    
    /**
     * Garante que um servidor existe na tabela de guilds
     */
    ensureGuild(guildId, name = null, icon = null, ownerId = null) {
        const existing = this.prepare('SELECT guild_id FROM guilds WHERE guild_id = ?').get(guildId);
        
        if (!existing && name) {
            this.prepare(`
                INSERT INTO guilds (guild_id, name, icon, owner_id, joined_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(guildId, name, icon, ownerId, Date.now());
        } else if (name) {
            this.prepare(`
                UPDATE guilds SET 
                    name = COALESCE(?, name),
                    icon = COALESCE(?, icon),
                    owner_id = COALESCE(?, owner_id)
                WHERE guild_id = ?
            `).run(name, icon, ownerId, guildId);
        }
        
        return true;
    }
    
    /**
     * Registra uma atividade no log
     */
    logActivity(guildId, userId, action, targetId = null, details = null, ipAddress = null) {
        const uuid = this.generateUUID();
        
        this.prepare(`
            INSERT INTO activity_logs (uuid, guild_id, user_id, action, target_id, details, ip_address, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(uuid, guildId, userId, action, targetId, details ? JSON.stringify(details) : null, ipAddress, Date.now());
        
        return uuid;
    }
    
    // ==================== MÉTODOS PRINCIPAIS ====================
    
    prepare(sql) {
        if (!this.isConnected) {
            throw new Error('Banco de dados não está conectado');
        }
        return this.db.prepare(sql);
    }
    
    exec(sql) {
        if (!this.isConnected) {
            throw new Error('Banco de dados não está conectado');
        }
        return this.db.exec(sql);
    }
    
    transaction(fn) {
        if (!this.isConnected) {
            throw new Error('Banco de dados não está conectado');
        }
        return this.db.transaction(fn);
    }
    
    close() {
        if (this.db) {
            this.db.close();
            this.isConnected = false;
            console.log('🔌 Conexão com banco de dados fechada');
        }
    }
    
    // ==================== MÉTODOS DE UTILIDADE ====================
    
    getStats() {
        if (!this.isConnected) return null;
        
        try {
            const tables = ['users', 'guilds', 'punishments', 'tickets', 'staff_analytics'];
            const stats = {};
            
            for (const table of tables) {
                try {
                    const count = this.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
                    stats[table] = count.count;
                } catch (e) {
                    stats[table] = 0;
                }
            }
            
            const fileStats = fs.statSync(this.options.dbPath);
            
            return {
                tables: stats,
                fileSize: (fileStats.size / 1024 / 1024).toFixed(2) + ' MB',
                connected: this.isConnected,
                journalMode: this.prepare('PRAGMA journal_mode').get().journal_mode
            };
        } catch (error) {
            console.error('❌ Erro ao obter stats do DB:', error);
            return null;
        }
    }
    
    backup(backupPath = null) {
        try {
            const backupDir = backupPath || path.join(__dirname, '../../backups');
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFile = path.join(backupDir, `database_backup_${timestamp}.sqlite`);
            
            fs.copyFileSync(this.options.dbPath, backupFile);
            
            // Limpar backups antigos
            const backups = fs.readdirSync(backupDir)
                .filter(f => f.startsWith('database_backup_'))
                .sort()
                .reverse();
            
            for (let i = 10; i < backups.length; i++) {
                fs.unlinkSync(path.join(backupDir, backups[i]));
            }
            
            console.log(`💾 Backup criado: ${backupFile}`);
            return backupFile;
            
        } catch (error) {
            console.error('❌ Erro ao criar backup:', error);
            return null;
        }
    }
    
    generateUUID() {
        return crypto.randomUUID();
    }
}

// ==================== SINGLETON E EXPORTAÇÃO ====================

let instance = null;

function getInstance(options = {}) {
    if (!instance) {
        instance = new DatabaseManager(options);
    }
    return instance;
}

const defaultInstance = getInstance();

// Exportar para compatibilidade com código existente
module.exports = defaultInstance.db;
module.exports.default = defaultInstance;
module.exports.DatabaseManager = DatabaseManager;
module.exports.getInstance = getInstance;
module.exports.generateUUID = () => defaultInstance.generateUUID();
module.exports.ensureUser = (userId, username, discriminator, avatar) => 
    defaultInstance.ensureUser(userId, username, discriminator, avatar);
module.exports.ensureGuild = (guildId, name, icon, ownerId) => 
    defaultInstance.ensureGuild(guildId, name, icon, ownerId);
module.exports.logActivity = (guildId, userId, action, targetId, details, ip) => 
    defaultInstance.logActivity(guildId, userId, action, targetId, details, ip);