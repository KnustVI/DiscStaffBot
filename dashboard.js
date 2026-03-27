const express = require('express');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const session = require('express-session');
const path = require('path');
const db = require('./database/database'); // Usando o seu banco better-sqlite3 do bot

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
        const guild = client.guilds.cache.get(req.params.guildID);
        if (!guild) return res.redirect('/');

        // Verifica se o user é admin no servidor
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.redirect('/');

        res.render('home', {
            guild: guild,
            user: req.user,
            bot: client
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

        res.render('manage', {
            bot: client,
            user: req.user,
            guild: guild,
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