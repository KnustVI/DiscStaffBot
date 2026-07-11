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
                'feedbacks',
                'sequences',
                'pot_servers',
                'pot_players',
                'pot_logs',
                'pot_tokens',
                'player_links',
                'player_premium',
                'guild_premium',
                'punishment_levels',
                'pot_spectator_sessions'
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

            // Colunas adicionadas depois da criação inicial das tabelas.
            // CREATE TABLE IF NOT EXISTS não adiciona colunas em bancos já
            // existentes, então precisamos de ALTER TABLE aqui (idempotente:
            // se a coluna já existe, o erro é ignorado).
            this.ensureColumn('reports', 'type', "TEXT NOT NULL DEFAULT 'report'");
            this.ensureColumn('reports', 'punishment_id', 'INTEGER');
            // Verificação em jogo (RCON) do cadastro manual de jogador — colunas
            // já preparadas, mas o envio do código pelo chat do jogo ainda não
            // está ativado (ver potPlayerRegistry.js). Ver /registrar.
            this.ensureColumn('pot_players', 'verification_code', 'TEXT');
            this.ensureColumn('pot_players', 'verified_ingame', 'INTEGER DEFAULT 0');
            // Espécie/growth do dinossauro atual — foram adicionadas ao
            // CREATE TABLE de pot_players numa revisão anterior, mas SEM um
            // ensureColumn correspondente: CREATE TABLE IF NOT EXISTS não
            // adiciona coluna em tabela já existente, então bancos de
            // produção criados antes dessa revisão nunca ganharam essas 2
            // colunas de verdade (erro real visto em produção: "no such
            // column: dinosaur_type"). Preenchidas via PlayerRespawn — ver
            // potPlayerRegistry.js.
            this.ensureColumn('pot_players', 'dinosaur_type', 'TEXT');
            this.ensureColumn('pot_players', 'dinosaur_growth', 'REAL DEFAULT 0');
            // Kills/deaths por servidor, contabilizados a partir do evento de
            // webhook PlayerKilled (KillerAlderonId/VictimAlderonId) — ver
            // potPlayerRegistry.recordKillEvent. Usados no card do /perfil
            // (agregados globalmente entre servidores).
            this.ensureColumn('pot_players', 'kills', 'INTEGER DEFAULT 0');
            this.ensureColumn('pot_players', 'deaths', 'INTEGER DEFAULT 0');
            // Distingue "online jogando um dinossauro" de "online na tela de
            // seleção de dinossauro" — dinosaur_type/growth (acima) NUNCA são
            // limpos (sempre guardam o ÚLTIMO dino jogado, mesmo offline), então
            // sozinhos não dão pra saber se o jogador já deu respawn NESTA sessão.
            // Zerado no PlayerLogin e no PlayerKilled (como vítima — volta pra
            // seleção), setado em 1 no PlayerRespawn. Ver potPlayerRegistry.js.
            this.ensureColumn('pot_players', 'dinosaur_active', 'INTEGER DEFAULT 0');
            // Banner de perfil personalizado (Player Premium Raptor) — ver /perfil-edit.
            // Guarda o ID da mensagem (não a URL — URLs de anexo do Discord
            // expiram em ~24h, a mensagem em si não).
            this.ensureColumn('player_links', 'banner_message_id', 'TEXT');
            // Foto de perfil escolhida num menu pré-definido (Player Premium
            // Compy) — guarda a CHAVE do imageManager (ex: "foto_perfil_05"),
            // não um arquivo próprio. Raptor continua com upload/banner do
            // Discord (banner_message_id, acima); Compy só escolhe entre as
            // fotos genéricas já existentes em assets/images. Ver /perfil-edit.
            this.ensureColumn('player_links', 'selected_photo_key', 'TEXT');
            // Verificação em jogo (RCON) do vínculo Discord<->Alderon ID —
            // global (a identidade é global, mesmo que a confirmação em si
            // dependa do RCON de um servidor específico). 1 quando o vínculo
            // veio confirmado pela própria Alderon (webhook com DiscordId) ou
            // quando o jogador confirmou o código enviado in-game via
            // /registrar. Ver potPlayerRegistry.js.
            this.ensureColumn('player_links', 'verified_ingame', 'INTEGER DEFAULT 0');
            // Snapshot do nível de punição customizado usado no momento do strike
            // (ver punishmentLevels.js) — congelado na hora de aplicar, pra editar
            // um nível depois não reescrever punições já aplicadas. A coluna
            // `severity` (INTEGER) antiga fica congelada nas linhas legadas;
            // linhas novas gravam 0 nela (sentinela) e usam level_severity (texto).
            this.ensureColumn('punishments', 'level_id', 'INTEGER');
            this.ensureColumn('punishments', 'level_name', 'TEXT');
            this.ensureColumn('punishments', 'level_severity', 'TEXT');
            this.ensureColumn('punishments', 'level_action', 'TEXT');
            this.ensureColumn('punishments', 'duration_str', 'TEXT');

            // Novas métricas de staff analytics (moderação/eventos/modo
            // espectador) — ver analyticsSystem.js. CREATE TABLE IF NOT
            // EXISTS não adiciona coluna em bancos já existentes, daí o
            // ensureColumn de cada uma aqui.
            this.ensureColumn('staff_analytics', 'reports_joined', 'INTEGER DEFAULT 0');
            this.ensureColumn('staff_analytics', 'report_messages_count', 'INTEGER DEFAULT 0');
            this.ensureColumn('staff_analytics', 'report_response_seconds_sum', 'INTEGER DEFAULT 0');
            this.ensureColumn('staff_analytics', 'report_response_count', 'INTEGER DEFAULT 0');
            this.ensureColumn('staff_analytics', 'events_created', 'INTEGER DEFAULT 0');
            this.ensureColumn('staff_analytics', 'nametag_toggles_spectating', 'INTEGER DEFAULT 0');
            this.ensureColumn('staff_analytics', 'nametag_toggles_not_spectating', 'INTEGER DEFAULT 0');
            this.ensureColumn('staff_analytics', 'spectator_seconds', 'INTEGER DEFAULT 0');

            // Renomeia os valores internos de tier de Server Premium já
            // gravados (pegada/fossil eram nomes de planejamento antigos —
            // ver PremiumSystem.GUILD_TIERS). Idempotente: depois da primeira
            // execução não sobra nenhuma linha 'pegada'/'fossil' pra migrar.
            this.migrateGuildPremiumTierNames();

            console.log('📋 Schema do banco de dados criado');

        } catch (error) {
            console.error('❌ Erro ao criar tabelas:', error);
            throw error;
        }
    }

    // Migra os valores antigos de guild_premium.tier ('pegada'/'fossil') pros
    // nomes atuais ('rastreador'/'cacador') — ver PremiumSystem.GUILD_TIERS.
    // Idempotente: chamar em toda inicialização é seguro.
    migrateGuildPremiumTierNames() {
        try {
            this.db.prepare(`UPDATE guild_premium SET tier = 'rastreador' WHERE tier = 'pegada'`).run();
            this.db.prepare(`UPDATE guild_premium SET tier = 'cacador' WHERE tier = 'fossil'`).run();
        } catch (err) {
            // Tabela ainda não existe na primeiríssima execução — ignorar.
        }
    }

    // Adiciona uma coluna a uma tabela existente se ela ainda não existir.
    // Idempotente: chamar em toda inicialização é seguro.
    ensureColumn(table, column, definition) {
        try {
            this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
            console.log(`   ✅ Coluna ${table}.${column} adicionada`);
        } catch (err) {
            // Coluna já existe (ou tabela ainda não existe) — ignorar.
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