const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { SCHEMA, INDEXES } = require('./schema');

class DatabaseManager {
    constructor(options = {}) {
        this.options = {
            dbPath: options.dbPath || path.join(__dirname, '../../database.sqlite'),
            verbose: options.verbose || false,
            ...options
        };
        
        this.db = null;
        this.isConnected = false;
        
        this.init();
    }
    
    generateUUID() {
        return crypto.randomUUID();
    }
    
    init() {
        try {
            const dbDir = path.dirname(this.options.dbPath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }
            
            this.db = new Database(this.options.dbPath, {
                verbose: this.options.verbose ? console.log : null
            });
            
            // Configurações de performance
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('synchronous = NORMAL');
            this.db.pragma('cache_size = 10000');
            this.db.pragma('foreign_keys = ON');
            
            this.isConnected = true;
            
            // Criar todas as tabelas
            this.createAllTables();
            
            console.log('✅ Banco de dados SQLite conectado com sucesso');
            
        } catch (error) {
            console.error('❌ Erro ao conectar ao banco de dados:', error);
            throw error;
        }
    }
    
    createAllTables() {
        try {
            // Criar tabelas em ordem
            const tables = [
                'users',
                'guilds',
                'settings',
                'reputation',
                'punishments',
                'reports',
                'report_messages',
                'staff_analytics',
                'activity_logs',
                'temporary_roles',
                'feedbacks'
            ];
            
            for (const table of tables) {
                if (SCHEMA[table]) {
                    try {
                        this.db.exec(SCHEMA[table]);
                        console.log(`   ✅ Tabela ${table} criada`);
                    } catch (err) {
                        console.error(`   ❌ Erro ao criar tabela ${table}:`, err.message);
                    }
                }
            }
            
            // Criar índices
            console.log('   📊 Criando índices...');
            for (const indexSql of INDEXES) {
                try {
                    this.db.exec(indexSql);
                } catch (err) {
                    // Ignorar erros de índices
                }
            }
            
            console.log('📋 Schema do banco de dados criado');
            
        } catch (error) {
            console.error('❌ Erro ao criar tabelas:', error);
            throw error;
        }
    }
    
    // Verificar se uma tabela existe
    tableExists(tableName) {
        const result = this.db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name = ?
        `).get(tableName);
        return !!result;
    }
    
    // Garantir que um usuário existe
    ensureUser(userId, username = null, discriminator = null, avatar = null) {
        // Verificar se a tabela existe
        if (!this.tableExists('users')) {
            console.warn('⚠️ Tabela users não existe, criando...');
            this.createAllTables();
        }
        
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
            this.prepare(`
                UPDATE users SET 
                    username = COALESCE(?, username),
                    discriminator = COALESCE(?, discriminator),
                    avatar = COALESCE(?, avatar),
                    last_seen = ?
                WHERE user_id = ?
            `).run(username, discriminator, avatar, Date.now(), userId);
        } else {
            this.prepare(`UPDATE users SET last_seen = ? WHERE user_id = ?`).run(Date.now(), userId);
        }
        
        return true;
    }
    
    // Garantir que um servidor existe
    ensureGuild(guildId, name = null, icon = null, ownerId = null) {
        if (!this.tableExists('guilds')) {
            this.createAllTables();
        }
        
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
    
    // Registrar atividade
    logActivity(guildId, userId, action, targetId = null, details = null, ipAddress = null) {
        if (!this.tableExists('activity_logs')) {
            this.createAllTables();
        }
        
        const uuid = this.generateUUID();
        
        try {
            this.prepare(`
                INSERT INTO activity_logs (uuid, guild_id, user_id, action, target_id, details, ip_address, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(uuid, guildId, userId, action, targetId, details ? JSON.stringify(details) : null, ipAddress, Date.now());
        } catch (err) {
            console.error('❌ Erro ao registrar atividade:', err.message);
        }
        
        return uuid;
    }
    
    // Métodos principais
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
    
    pragma(sql) {
        if (!this.isConnected) {
            throw new Error('Banco de dados não está conectado');
        }
        return this.db.pragma(sql);
    }
    
    close() {
        if (this.db) {
            this.db.close();
            this.isConnected = false;
        }
    }
    
    getStats() {
        if (!this.isConnected) return null;
        
        try {
            const tables = ['users', 'guilds', 'punishments', 'reports'];
            const stats = {};
            
            for (const table of tables) {
                if (this.tableExists(table)) {
                    const count = this.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
                    stats[table] = count.count;
                } else {
                    stats[table] = 0;
                }
            }
            
            const fileStats = fs.statSync(this.options.dbPath);
            
            return {
                tables: stats,
                fileSize: (fileStats.size / 1024 / 1024).toFixed(2) + ' MB',
                connected: this.isConnected
            };
        } catch (error) {
            return null;
        }
    }
}

// Singleton
let instance = null;

function getInstance(options = {}) {
    if (!instance) {
        instance = new DatabaseManager(options);
    }
    return instance;
}

const defaultInstance = getInstance();

// Exportar para compatibilidade
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
module.exports.getStats = () => defaultInstance.getStats();