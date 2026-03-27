const express = require('express');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const session = require('express-session');
const path = require('path');
const db = require('./database/database');

const Database = require('better-sqlite3');
const db = new Database('database.db')

// IMPORTANTE: Rode isso ANTES das rotas (app.get)
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, 
        reputation INTEGER DEFAULT 100, 
        level INTEGER DEFAULT 1
    )
`).run();

// ... resto do código (rotas, etc)

const app = express();

function loadDashboard(client) {
    // 1. Configuração do Passport
    passport.serializeUser((user, done) => done(null, user));
    passport.deserializeUser((obj, done) => done(null, obj));

    passport.use(new Strategy({
        clientID: process.env.DASHBOARD_CLIENT_ID,
        clientSecret: process.env.DASHBOARD_CLIENT_SECRET,
        callbackURL: process.env.DASHBOARD_CALLBACK_URL,
        scope: ['identify', 'guilds']
    }, (accessToken, refreshToken, profile, done) => {
        process.nextTick(() => done(null, profile));
    }));

    // 2. Middlewares
    app.use(session({
        secret: process.env.SESSION_SECRET || 'titans_pass_secret',
        resave: false,
        saveUninitialized: false
    }));

    app.use(passport.initialize());
    app.use(passport.session());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.use(express.static(path.join(__dirname, 'public')));

    // Helper: Middleware para proteger rotas
    const checkAuth = (req, res, next) => {
        if (req.isAuthenticated()) return next();
        res.redirect('/login');
    };

    // ==========================
    // ROTAS PRINCIPAIS
    // ==========================

    // INDEX (LOGIN)
    app.get('/', (req, res) => {
        let userGuilds = [];
        if (req.user && req.user.guilds) {
            userGuilds = req.user.guilds.filter(g => 
                (parseInt(g.permissions) & 0x8) === 0x8 // Filtra quem é Admin
            ).map(g => {
                const botIn = client.guilds.cache.has(g.id);
                return { ...g, botIn };
            });
        }

        res.render('index', { 
            user: req.user,
            bot: client,
            isAdmin: userGuilds.length > 0,
            guilds: userGuilds
        });
    });

    // HOME (GRÁFICOS)
            app.get('/home/:guildID', checkAuth, async (req, res) => {
            const guildID = req.params.guildID;
            const guild = client.guilds.cache.get(guildID);
            if (!guild) return res.redirect('/');

            // 1. Verifica se o user é admin
            const member = await guild.members.fetch(req.user.id).catch(() => null);
            if (!member || !member.permissions.has('Administrator')) return res.redirect('/');

            // 2. Busca a Reputação (tabela 'reputation')
            // Nota: Seu banco usa 'points' em vez de 'reputation'
            let repData = db.prepare("SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?")
                            .get(guildID, req.user.id);
            
            // 3. Busca o total de punições (tabela 'punishments')
            const punCount = db.prepare("SELECT COUNT(*) as total FROM punishments WHERE guild_id = ? AND user_id = ?")
                            .get(guildID, req.user.id);

            // Valores padrão caso não existam no banco
            const points = repData ? repData.points : 100;
            const totalPunishments = punCount ? punCount.total : 0;
            
            // O seu banco não parece ter uma coluna 'level' global, 
            // então vamos usar o total de punições ou um valor estático por enquanto
            const level = Math.floor(totalPunishments / 5) + 1; 

            res.render('home', {
                guild: guild,
                user: req.user,
                bot: client,
                nickname: member.displayName,
                role: member.roles.highest.name,
                reputation: points,
                level: level,
                totalPunishments: totalPunishments
            });
        });

    // MANAGE (CONFIGURAÇÕES - EXATAMENTE COMO A FOTO)
    app.get('/manage/:guildID', checkAuth, async (req, res) => {
        const guildID = req.params.guildID;
        const guild = client.guilds.cache.get(guildID);
        
        if (!guild) return res.redirect('/');

        // Busca configurações no seu SQLite (Tabela settings que você já tem)
        const rows = db.prepare("SELECT key, value FROM settings WHERE guild_id = ?").all(guildID);
        const config = {};
        rows.forEach(row => { config[row.key] = row.value; });
        
        const highestRole = member ? member.roles.highest.name : "Sem Cargo";
        const nickname = member ? member.displayName : req.user.username;
        // 2. Buscar Reputation e Level no seu Banco de Dados (Tabela users)
        // Ajuste o nome das colunas conforme sua tabela
        const userData = db.prepare("SELECT reputation, level FROM users WHERE id = ?").get(req.user.id);

        res.render('home', {
            guild: guild,
            user: req.user,
            bot: client,
            nickname: nickname,
            role: highestRole,
            reputation: reputation,
            level: level,
            config: config // Passa os valores salvos para os inputs
        });
    });

    // SALVAR CONFIGURAÇÕES (POST)
    app.post('/manage/:guildID/save', checkAuth, async (req, res) => {
        const { guildID } = req.params;
        const settingsData = req.body;

        // Upsert no seu SQLite (better-sqlite3 style)
        const upsert = db.prepare(`
            INSERT INTO settings (guild_id, key, value) 
            VALUES (?, ?, ?) 
            ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
        `);

        const transaction = db.transaction((data) => {
            for (const [key, value] of Object.entries(data)) {
                upsert.run(guildID, key, value);
            }
        });

        transaction(settingsData);
        res.redirect(`/manage/${guildID}?success=true`);
    });

    // AUTH ROUTES
    app.get('/login', passport.authenticate('discord'));
    app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
    app.get('/logout', (req, res) => {
        req.logout(() => res.redirect('/'));
    });

    app.listen(process.env.DASHBOARD_PORT || 3000, () => {
        console.log(`✅ Dashboard Online!`);
    });
}

module.exports = loadDashboard;