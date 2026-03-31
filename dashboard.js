const express = require('express');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const session = require('express-session');
const path = require('path');
const db = require('../database'); // Ajustado para o caminho correto

const app = express();

function loadDashboard(client) {
    // --- 1. CONFIGURAÇÕES DE RENDERIZAÇÃO ---
    app.set('views', path.join(__dirname, '..', 'web', 'views'));
    app.set('view engine', 'ejs');
    
    // Middlewares padrão
    app.use(express.static(path.join(__dirname, '..', 'web', 'public')));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // --- 2. GERENCIAMENTO DE SESSÃO ---
    app.use(session({
        secret: process.env.SESSION_SECRET || 'robin_integrity_secure_session_882',
        resave: false,
        saveUninitialized: false,
        cookie: { 
            secure: process.env.NODE_ENV === 'production', // true se usar HTTPS
            maxAge: 1000 * 60 * 60 * 24 // 24 horas
        }
    }));

    // --- 3. PASSPORT (OAUTH2 DISCORD) ---
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

    // --- 4. MIDDLEWARES DE PROTEÇÃO ---
    function checkAuth(req, res, next) {
        if (req.isAuthenticated()) return next();
        res.redirect('/login'); 
    }

    // Middleware para injetar dados globais em todos os templates EJS
    app.use((req, res, next) => {
        res.locals.user = req.user || null;
        res.locals.bot = client;
        next();
    });

    // --- 5. ROTAS DE AUTENTICAÇÃO ---
    app.get('/login', passport.authenticate('discord'));
    
    app.get('/auth/discord/callback', passport.authenticate('discord', { 
        failureRedirect: '/' 
    }), (req, res) => {
        req.session.save(() => res.redirect('/'));
    });

    app.get('/logout', (req, res) => {
        req.logout(() => {
            req.session.destroy(() => {
                res.clearCookie('connect.sid');
                res.redirect('/');
            });
        });
    });

    // --- 6. ROTAS DE NAVEGAÇÃO ---

    // Index: Seleção de Servidores
    app.get('/', (req, res) => {
        let adminGuilds = [];
        if (req.user && req.user.guilds) {
            adminGuilds = req.user.guilds.filter(g => 
                (parseInt(g.permissions) & 0x8) === 0x8 // Permissão de ADMINISTRADOR
            ).map(g => ({
                ...g,
                botIn: client.guilds.cache.has(g.id)
            }));
        }
        res.render('index', { guilds: adminGuilds });
    });

    // Home do Servidor (Stats)
    app.get('/home/:guildID', checkAuth, async (req, res) => {
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        
        if (!guild) return res.redirect('/');

        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.redirect('/');

        // Dados do DB para a Dashboard
        const repData = db.prepare("SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?").get(guildID, req.user.id);
        const punCount = db.prepare("SELECT COUNT(*) as total FROM punishments WHERE guild_id = ?").get(guildID);

        res.render('home', {
            guild,
            member,
            reputation: repData?.points || 100,
            totalPunishments: punCount?.total || 0
        });
    });

    // Gerenciar Configurações
    app.get('/manage/:guildID', checkAuth, async (req, res) => {
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        
        if (!guild) return res.redirect('/');
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.redirect('/');

        const settingsRows = db.prepare("SELECT key, value FROM settings WHERE guild_id = ?").all(guildID);
        const settings = Object.fromEntries(settingsRows.map(s => [s.key, s.value]));

        res.render('manage', {
            guild,
            settings,
            success: req.query.success === 'true'
        });
    });

    // Salvar Configurações (POST com Transação)
    app.post('/manage/:guildID/save', checkAuth, async (req, res) => {
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);

        if (!guild) return res.status(404).send("Guild não encontrada.");
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has("Administrator")) return res.status(403).send("Acesso negado.");

        const upsert = db.prepare(`
            INSERT INTO settings (guild_id, key, value) 
            VALUES (?, ?, ?) 
            ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
        `);

        // Uso de Transaction do Better-SQLite3 para performance e segurança
        const saveSettings = db.transaction((data) => {
            for (const [key, value] of Object.entries(data)) {
                upsert.run(guildID, key, String(value));
            }
        });

        try {
            saveSettings(req.body);
            res.redirect(`/manage/${guildID}?success=true`);
        } catch (err) {
            console.error("Erro ao salvar:", err);
            res.status(500).send("Erro interno ao salvar.");
        }
    });

    const PORT = process.env.DASHBOARD_PORT || 3000;
    app.listen(PORT, () => {
        console.log(`\x1b[35m[WEB]\x1b[0m Dashboard rodando em http://localhost:${PORT}`);
    });
}

module.exports = loadDashboard;