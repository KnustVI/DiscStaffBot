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

    app.get('/logout', (req, res, next) => {
        req.logout((err) => {
            if (err) return next(err);
            req.session.destroy(() => {
                res.clearCookie('connect.sid');
                res.redirect('/');
            });
        });
    });

    // ==========================
    // INDEX (SELEÇÃO DE SERVIDORES)
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
            guilds: userGuilds
        });
    });

    // ==========================
    // HOME (ESTATÍSTICAS / GRÁFICOS)
    // ==========================
    app.get('/home/:guildID', checkAuth, async (req, res) => {
        try {
            const { guildID } = req.params;
            // Corrigido: Usar 'client' em vez de 'bot'
            const guild = client.guilds.cache.get(guildID) || await client.guilds.fetch(guildID).catch(() => null);
            
            if (!guild) return res.redirect('/');

            const member = await guild.members.fetch(req.user.id).catch(() => null);
            // Verifica se o membro existe e se é ADM
            if (!member || !member.permissions.has('Administrator')) return res.redirect('/');

            // Busca Reputação
            const repData = db.prepare("SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?").get(guildID, req.user.id);
            const reputation = repData ? repData.points : 100;

            // Busca Level baseado em punições
            const punCount = db.prepare("SELECT COUNT(*) as total FROM punishments WHERE guild_id = ? AND user_id = ?").get(guildID, req.user.id);
            const level = punCount ? Math.floor(punCount.total / 5) + 1 : 1;

            res.render('home', {
                guild,
                user: req.user,
                bot: client,
                member: member,
                nickname: member.displayName || req.user.username,
                role: member.roles.highest.name !== '@everyone' ? member.roles.highest.name : "Membro",
                reputation: reputation || 100,
                level: level || 1
            });
        } catch (err) {
            console.error("Erro na Home:", err);
            res.redirect('/');
        }
    });

    // ==========================
    // MANAGE (CONFIGURAÇÕES)
    // ==========================
    app.get('/manage/:guildID', checkAuth, async (req, res) => {
        try {
            const { guildID } = req.params;
            const guild = client.guilds.cache.get(guildID) || await client.guilds.fetch(guildID).catch(() => null);
            
            if (!guild) return res.redirect('/');

            const member = await guild.members.fetch(req.user.id).catch(() => null);
            // Trava de segurança: só entra se for ADM
            if (!member || !member.permissions.has('Administrator')) return res.redirect('/');

            // Busca as configurações atuais do banco de dados para exibir nos inputs
            const settingsRows = db.prepare("SELECT key, value FROM settings WHERE guild_id = ?").all(guildID);
            const settings = {};
            settingsRows.forEach(row => {
                settings[row.key] = row.value;
            });

            res.render('manage', {
                path: 'manage',
                guild,
                user: req.user,
                bot: client,
                member: member,
                nickname: member.displayName || req.user.username,
                role: member.roles.highest.name !== '@everyone' ? member.roles.highest.name : "Membro",
                settings: settings, // Envia as configs para o formulário
                success: req.query.success === 'true' // Para mostrar aviso de "Salvo com sucesso"
            });
        } catch (err) {
            console.error("Erro na Manage:", err);
            res.redirect('/');
        }
    });

    // ==========================
    // SALVAR CONFIGURAÇÕES (POST)
    // ==========================
    app.post('/manage/:guildID/save', checkAuth, async (req, res) => {
        try {
            const { guildID } = req.params;
            const guild = client.guilds.cache.get(guildID);
            if (!guild) return res.status(404).send("Guild não encontrada.");

            const member = await guild.members.fetch(req.user.id).catch(() => null);
            if (!member || !member.permissions.has("Administrator")) return res.status(403).send("Sem permissão.");

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
            res.status(500).send("Erro ao salvar dados.");
        }
    });

    const PORT = process.env.DASHBOARD_PORT || 3000;
    app.listen(PORT, () => {
        console.log(`✅ Dashboard Online na porta ${PORT}!`);
    });
}

module.exports = loadDashboard;