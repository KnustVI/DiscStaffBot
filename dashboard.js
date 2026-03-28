const express = require('express');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const session = require('express-session');
const path = require('path');
const db = require('./database/database');

const app = express();

function loadDashboard(client) {

    // 1. Configurações Globais
    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'ejs');
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // 2. Sessão e Passport
    app.use(session({
        secret: process.env.SESSION_SECRET || 'titans_pass_secret',
        resave: false,
        saveUninitialized: false
    }));

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

    app.use(passport.initialize());
    app.use(passport.session());

    const checkAuth = (req, res, next) => {
        if (req.isAuthenticated()) return next();
        res.redirect('/login');
    };

    // ==========================
    // ROTAS DE AUTENTICAÇÃO
    // ==========================
    app.get('/login', passport.authenticate('discord'));
    app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
        res.redirect('/');
    });
    app.get('/logout', (req, res) => {
        req.logout(() => res.redirect('/'));
    });

    // ==========================
    // INDEX
    // ==========================
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

    // ==========================
    // MANAGE (AQUI ESTAVA O ERRO)
    // ==========================
    app.get('/manage/:guildID', checkAuth, async (req, res) => {
        try {
            const { guildID } = req.params;
            
            // Tenta cache, se não busca no Discord
            let guild = client.guilds.cache.get(guildID);
            if (!guild) {
                guild = await client.guilds.fetch(guildID).catch(() => null);
            }

            if (!guild) {
                console.log(`❌ Guild ${guildID} não encontrada!`);
                return res.redirect('/');
            }

            const member = await guild.members.fetch(req.user.id).catch(() => null);
            if (!member) {
                console.log("❌ Membro não encontrado!");
                return res.redirect('/');
            }

            // SEGURANÇA: Verificação de Permissão Robusta
            if (!member.permissions.has('Administrator')) {
                console.log("❌ Sem permissão de Admin!");
                return res.redirect('/');
            }
            
            // CONFIGURAÇÕES
            const rows = db.prepare("SELECT key, value FROM settings WHERE guild_id = ?").all(guildID) || [];
            const config = {};
            rows.forEach(row => { config[row.key] = row.value; });

            // REPUTAÇÃO/LEVEL (Garantindo que nunca seja undefined para a sidebar)
            // IMPORTANTE: Verifique se sua tabela é 'users' ou 'reputation'
            const userData = db.prepare("SELECT reputation, level FROM users WHERE id = ?").get(req.user.id);
            
            const reputation = userData ? userData.reputation : 100;
            const level = userData ? userData.level : 1;

            res.render('manage', { 
                guild,
                user: req.user,
                bot: client,
                nickname: member.displayName || req.user.username,
                role: member.roles.highest.name || "Sem Cargo",
                reputation: reputation,
                level: level,
                config,
                query: req.query
            });

        } catch (error) {
            console.error("❌ Erro fatal no Manage:", error);
            res.redirect('/');
        }
    });

    // ==========================
    // SALVAR (POST)
    // ==========================
    app.post('/manage/:guildID/save', checkAuth, async (req, res) => {
        try {
            const { guildID } = req.params;
            const guild = client.guilds.cache.get(guildID);
            
            if (!guild) return res.redirect('/');

            const member = await guild.members.fetch(req.user.id).catch(() => null);
            if (!member || !member.permissions.has("Administrator")) {
                return res.status(403).send("Sem permissão.");
            }

            const upsert = db.prepare(`
                INSERT INTO settings (guild_id, key, value) 
                VALUES (?, ?, ?) 
                ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
            `);

            const transaction = db.transaction((data) => {
                for (const [key, value] of Object.entries(data)) {
                    // Prevenindo salvar valores vazios que quebram o HTML
                    const val = (value !== undefined && value !== null) ? value.toString() : "";
                    upsert.run(guildID, key, val);
                }
            });

            transaction(req.body);
            res.redirect(`/manage/${guildID}?success=true`);

        } catch (error) {
            console.error("Erro ao salvar:", error);
            res.status(500).send("Erro interno ao salvar.");
        }
    });

    const PORT = process.env.DASHBOARD_PORT || 3000;
    app.listen(PORT, () => {
        console.log(`✅ Dashboard Online na porta ${PORT}!`);
    });
}

module.exports = loadDashboard;