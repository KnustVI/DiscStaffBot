const express = require('express');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const session = require('express-session');
const path = require('path');
const db = require('./database/database'); // Certifique-se que este arquivo exporta o 'better-sqlite3' instanciado

const app = express();

function loadDashboard(client) {

    // --- CONFIGURAÇÕES DO EXPRESS ---
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, 'public')));
    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'ejs');
    
    // --- CONFIGURAÇÃO DO PASSPORT ---
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

    // --- MIDDLEWARES ---
    app.use(session({
        secret: process.env.SESSION_SECRET || 'titans_pass_secret',
        resave: false,
        saveUninitialized: false
    }));

    app.use(passport.initialize());
    app.use(passport.session());

    // Middleware de Proteção
    const checkAuth = (req, res, next) => {
        if (req.isAuthenticated()) return next();
        res.redirect('/login');
    };

    // --- ROTAS DE AUTENTICAÇÃO (Faltavam estas!) ---
    app.get('/login', passport.authenticate('discord'));
    app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
        res.redirect('/');
    });
    app.get('/logout', (req, res) => {
        req.logout(() => res.redirect('/'));
    });

    // --- ROTAS PRINCIPAIS ---

    // INDEX (Seleção de Servidores)
    app.get('/', (req, res) => {
        let userGuilds = [];
        if (req.user && req.user.guilds) {
            userGuilds = req.user.guilds.filter(g => 
                (parseInt(g.permissions) & 0x8) === 0x8
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

    // MANAGE (Apenas uma rota agora)
    app.get('/manage/:guildID', checkAuth, async (req, res) => {
        console.log(`--> Acessando Manage: ${req.params.guildID}`);
        try {
            const { guildID } = req.params;
            const guild = client.guilds.cache.get(guildID);
            
            if (!guild) return res.redirect('/');

            const member = await guild.members.fetch(req.user.id).catch(() => null);
            if (!member) return res.redirect('/');

            // Busca Configurações
            const rows = db.prepare("SELECT key, value FROM settings WHERE guild_id = ?").all(guildID) || [];
            const config = {};
            rows.forEach(row => { config[row.key] = row.value; });

            // Busca Dados do Usuário
            const userData = db.prepare("SELECT reputation, level FROM users WHERE id = ?").get(req.user.id) || { reputation: 0, level: 1 };

            res.render('manage', { 
                guild,
                user: req.user,
                bot: client,
                nickname: member.displayName || req.user.username,
                role: member.roles.highest.name || "Sem Cargo",
                reputation: userData.reputation,
                level: userData.level,
                config: config,
                query: req.query
            });
        } catch (error) {
            console.error("Erro na rota Manage:", error);
            res.status(500).send("Erro ao carregar painel.");
        }
    });

    // SALVAR
    app.post('/manage/:guildID/save', checkAuth, async (req, res) => {
        try {
            const { guildID } = req.params;
            const guild = client.guilds.cache.get(guildID);
            const member = await guild.members.fetch(req.user.id);

            if (!member.permissions.has("Administrator")) return res.status(403).send("Sem permissão.");

            const upsert = db.prepare(`
                INSERT INTO settings (guild_id, key, value) 
                VALUES (?, ?, ?) 
                ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
            `);

            const transaction = db.transaction((data) => {
                for (const [key, value] of Object.entries(data)) {
                    upsert.run(guildID, key, value ? value.toString() : "");
                }
            });

            transaction(req.body);
            res.redirect(`/manage/${guildID}?success=true`);
        } catch (error) {
            console.error("Erro ao salvar:", error);
            res.status(500).send("Erro ao salvar.");
        }
    });

    // --- LIGA O SERVIDOR (Faltava isso!) ---
    const PORT = process.env.DASHBOARD_PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Dashboard online na porta ${PORT}`);
    });
}

module.exports = loadDashboard;