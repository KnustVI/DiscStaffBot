const express = require('express');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const session = require('express-session');
const path = require('path');
const db = require('./database/database'); // Certifique-se que o db exporta o better-sqlite3 instanciado

const app = express();

function loadDashboard(client) {

    // 1. Configurações e Middlewares Globais
    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'ejs');
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // 2. Configuração de Sessão e Passport
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

    // Middleware para proteger rotas
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
    // ROTAS PRINCIPAIS
    // ==========================

    // INDEX (LOGIN/SELEÇÃO)
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

    // HOME (GRÁFICOS E ESTATÍSTICAS)
    app.get('/home/:guildID', checkAuth, async (req, res) => {
        try {
            const guildID = req.params.guildID;
            const guild = client.guilds.cache.get(guildID);
            if (!guild) return res.redirect('/');

            const member = await guild.members.fetch(req.user.id).catch(() => null);
            if (!member || !member.permissions.has('Administrator')) return res.redirect('/');

            // Buscar Reputation e Level (Tabelas: reputation e punishments)
            let reputation = 100;
            let level = 1;
            const repData = db.prepare("SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?").get(guildID, req.user.id);
            if (repData) reputation = repData.points;

            const punCount = db.prepare("SELECT COUNT(*) as total FROM punishments WHERE guild_id = ? AND user_id = ?").get(guildID, req.user.id);
            if (punCount) level = Math.floor(punCount.total / 5) + 1;

            res.render('home', {
                guild,
                user: req.user,
                bot: client,
                nickname: member.displayName || req.user.username,
                role: member.roles.highest.name || "Membro",
                reputation,
                level
            });
        } catch (err) {
            console.error("Erro na Home:", err);
            res.redirect('/');
        }
    });

    // MANAGE (CONFIGURAÇÕES DO BOT)
    app.get('/manage/:guildID', checkAuth, async (req, res) => {
        try {
            const guildID = req.params.guildID;
            const guild = client.guilds.cache.get(guildID) || await client.guilds.fetch(guildID).catch(() => null);
            if (!guild) {
            console.log(`❌ Guild ${guildID} não encontrada! Redirecionando...`);
            return res.redirect('/');
            }

            const member = await guild.members.fetch(req.user.id).catch(() => null);
            if (!member) {
            console.log("❌ Membro não encontrado no servidor!");
            return res.redirect('/');
            }

            // Verifique se ele realmente tem permissão (Admin)
            if (!member.permissions.has('Administrator')) {
                console.log("❌ Usuário não é Administrador!");
                return res.redirect('/');
            }
            
            // Busca Configurações (Tabela settings)
            const rows = db.prepare("SELECT key, value FROM settings WHERE guild_id = ?").all(guildID) || [];
            const config = {};
            rows.forEach(row => { config[row.key] = row.value; });

            // Busca Dados do Usuário (Tabela users)
            const userData = db.prepare("SELECT reputation, level FROM users WHERE id = ?").get(req.user.id) || { reputation: 100, level: 1 };

            res.render('manage', { 
                guild,
                user: req.user,
                bot: client,
                nickname: member.displayName || req.user.username,
                role: member.roles.highest.name || "Sem Cargo",
                reputation: userData.reputation || "N/A",
                level: userData.level || "N/A",
                config,
                query: req.query
            });
        } catch (error) {
            console.error("Erro no Manage:", error);
            res.redirect('/');
        }
    });

    // SALVAR CONFIGURAÇÕES
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
            res.status(500).send("Erro ao salvar dados.");
        }
    });

    // Ligar o Servidor
    const PORT = process.env.DASHBOARD_PORT || 3000;
    app.listen(PORT, () => {
        console.log(`✅ Dashboard Online na porta ${PORT}!`);
    });
}

module.exports = loadDashboard;