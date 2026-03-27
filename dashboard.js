const express = require('express');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const session = require('express-session');
const path = require('path');
const db = require('./database/database');
const Database = require('better-sqlite3');



const app = express();

function loadDashboard(client) {

    app.use(express.urlencoded({ extended: true }));
        // Esta linha é mágica: ela diz que tudo na pasta 'public' pode ser acessado pelo navegador
    app.use(express.static(path.join(__dirname, 'public')));

    // Configura o EJS
    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'ejs');
    
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
        try {
            const guildID = req.params.guildID;
            const guild = client.guilds.cache.get(guildID);
            
            // Se o bot não estiver no servidor, volta pra inicial
            if (!guild) return res.redirect('/');

            // 1. Tentar buscar o membro (com fallback caso falhe)
            let member;
            try {
                member = await guild.members.fetch(req.user.id);
            } catch (e) {
                console.log("Membro não encontrado no cache/guild.");
                return res.redirect('/');
            }

            // 2. Verificar Permissão
            if (!member.permissions.has('Administrator')) return res.redirect('/');

            // 3. Buscar Dados no SQLite (Usando os nomes exatos das suas tabelas)
            let reputation = 100;
            let level = 1;

            try {
                const repData = db.prepare("SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?").get(guildID, req.user.id);
                if (repData) reputation = repData.points;

                const punCount = db.prepare("SELECT COUNT(*) as total FROM punishments WHERE guild_id = ? AND user_id = ?").get(guildID, req.user.id);
                if (punCount) level = Math.floor(punCount.total / 5) + 1;
            } catch (dbError) {
                console.error("Erro ao ler banco de dados:", dbError.message);
                // Mantém os valores padrão se o DB falhar
            }

            // 4. Renderizar com nomes de variáveis IGUAIS aos do seu EJS
            res.render('home', {
                guild: guild,
                user: req.user,
                bot: client,
                nickname: member.displayName || req.user.username,
                role: member.roles.highest.name || "Membro",
                reputation: reputation,
                level: level
            });

        } catch (globalError) {
            console.error("ERRO CRÍTICO NA ROTA HOME:", globalError);
            res.status(500).send("Erro ao carregar a página. Verifique o console do Bot.");
        }
    });

    // MANAGE (CONFIGURAÇÕES)
        app.get('/manage/:guildID', checkAuth, async (req, res) => {
            try {
                const guildID = req.params.guildID;
                const guild = client.guilds.cache.get(guildID);
                
                if (!guild) return res.redirect('/');

                // 1. Busca o Membro
                const member = await guild.members.fetch(req.user.id).catch(() => null);
                if (!member) return res.redirect('/');

                // 2. Busca Configurações do Servidor
                const rows = db.prepare("SELECT key, value FROM settings WHERE guild_id = ?").all(guildID);
                const config = {};
                rows.forEach(row => { config[row.key] = row.value; });

                // 3. Buscar Reputation e Level (com fallback para 0 caso não exista no DB)
                const userData = db.prepare("SELECT reputation, level FROM users WHERE id = ?").get(req.user.id);
                
                // Criamos as constantes para o EJS não quebrar
                const reputation = userData ? userData.reputation : 0;
                const level = userData ? userData.level : 1;
                const highestRole = member.roles.highest.name || "Sem Cargo";
                const nickname = member.displayName || req.user.username;

                // 4. Renderiza a página 'manage' (ou 'home' se você ainda não criou o arquivo manage.ejs)
                res.render('manage', { 
                    guild: guild,
                    user: req.user,
                    bot: client,
                    nickname: nickname,
                    role: highestRole,
                    reputation: reputation,
                    level: level,
                    config: config 
                });

            } catch (error) {
                console.error("Erro na rota Manage:", error);
                res.status(500).send("Erro ao carregar as configurações.");
            }
        });

    // SALVAR CONFIGURAÇÕES (POST)
        app.post('/manage/:guildID/save', checkAuth, async (req, res) => {
        try {
            const { guildID } = req.params;
            const settingsData = req.body;

            // 1. Verificação de segurança: O usuário tem permissão nesse servidor?
            const guild = client.guilds.cache.get(guildID);
            if (!guild) return res.status(404).send("Servidor não encontrado.");
            
            const member = await guild.members.fetch(req.user.id);
            if (!member.permissions.has("Administrator")) {
                return res.status(403).send("Você não tem permissão de Administrador.");
            }

            // 2. Preparar o Upsert
            const upsert = db.prepare(`
                INSERT INTO settings (guild_id, key, value) 
                VALUES (?, ?, ?) 
                ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
            `);

            // 3. Executar a transação
            const transaction = db.transaction((data) => {
                for (const [key, value] of Object.entries(data)) {
                    // Opcional: Ignorar valores vazios ou campos específicos
                    if (value !== undefined && value !== null) {
                        upsert.run(guildID, key, value.toString());
                    }
                }
            });

            transaction(settingsData);
            
            // Redireciona de volta com um aviso de sucesso
            res.redirect(`/manage/${guildID}?success=true`);

        } catch (error) {
            console.error("Erro ao salvar configurações:", error);
            res.status(500).send("Erro ao salvar os dados.");
        }
    });
}

module.exports = loadDashboard;