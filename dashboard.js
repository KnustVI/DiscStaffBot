const express = require('express');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const session = require('express-session');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Conecta ao seu banco de dados atual
const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));

// Cria a tabela de configurações se ela não existir
db.run(`CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    log_channel_id TEXT,
    staff_role_id TEXT
)`);

const app = express();

function loadDashboard(client) {
    // 1. Configuração do Passport (O motor de login)
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

    // 2. Configurações do Express
    app.use(session({
        secret: process.env.SESSION_SECRET || 'bot_secret_session',
        resave: false,
        saveUninitialized: false
    }));

    app.use(passport.initialize());
    app.use(passport.session());
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    // 3. ROTAS (As páginas do site)
    
    // Página Inicial
    app.get('/', (req, res) => {
    let userGuilds = [];

    if (req.user && req.user.guilds) {
        // Filtra apenas servidores onde o usuário é DONO ou tem permissão de ADMINISTRADOR
        // O bit 0x8 é o código do Discord para 'Administrator'
        userGuilds = req.user.guilds.filter(g => 
            g.owner === true || (parseInt(g.permissions) & 0x8) === 0x8
        );
    }

        res.render('index', { 
            user: req.user,
            bot: client,
            isAdmin: userGuilds.length > 0, // Se ele for admin em pelo menos 1, ele entra
            guilds: userGuilds // Passamos a lista de servidores dele para o HTML
        });
    });

    // Rota de Login (Redireciona para o Discord)
    app.get('/login', passport.authenticate('discord'));

    // Rota de Retorno (Onde o Discord te joga após o login)
    app.get('/auth/discord/callback', passport.authenticate('discord', {
        failureRedirect: '/'
    }), (req, res) => res.redirect('/'));

    // Rota de Logout
    app.get('/logout', (req, res) => {
        req.logout(() => {
            res.redirect('/');
        });
    });

    app.listen(process.env.DASHBOARD_PORT || 3000, () => {
        console.log(`✅ Dashboard rodando em: ${process.env.DASHBOARD_CALLBACK_URL.replace('/auth/discord/callback', '')}`);
    });

    // Rota para a página de configurações de um servidor específico
    app.get('/manage/:guildID', async (req, res) => {
        const guild = client.guilds.cache.get(req.params.guildID);
        
        // Segurança: Verifica se o bot está no servidor e se o usuário logado é Admin lá
        if (!guild) return res.status(404).send("Bot não encontrado neste servidor.");
        
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) {
            return res.status(403).send("Você não tem permissão para gerenciar este servidor.");
        }

        // Aqui pegamos a lista de canais de texto para o usuário escolher o de LOGS
        const channels = guild.channels.cache
            .filter(c => c.type === 0) // 0 = Texto
            .map(c => ({ id: c.id, name: c.name }));

        // Aqui pegamos a lista de cargos para o usuário escolher o de STAFF
        const roles = guild.roles.cache
            .filter(r => r.name !== '@everyone')
            .map(r => ({ id: r.id, name: r.name }));

        res.render('manage', {
            bot: client,
            user: req.user,
            guild: guild,
            channels: channels,
            roles: roles,
            // Simulando dados salvos (depois conectamos ao DB)
            settings: { 
                logChannel: "Ainda não definido", 
                staffRole: "Ainda não definido" 
            }
        });
    });


        // Rota para salvar as configurações
    app.post('/manage/:guildID/save', async (req, res) => {
        const { logChannel, staffRole } = req.body;
        const guildID = req.params.guildID;

        // Verifica permissão novamente por segurança
        const guild = client.guilds.cache.get(guildID);
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        
        if (!member || !member.permissions.has('Administrator')) {
            return res.status(403).send("Sem permissão.");
        }

        const sql = `INSERT INTO guild_settings (guild_id, log_channel_id, staff_role_id) 
                    VALUES (?, ?, ?) 
                    ON CONFLICT(guild_id) DO UPDATE SET 
                    log_channel_id = excluded.log_channel_id, 
                    staff_role_id = excluded.staff_role_id`;

        db.run(sql, [guildID, logChannel, staffRole], (err) => {
            if (err) return res.status(500).send("Erro ao salvar no banco.");
            res.redirect(`/manage/${guildID}?success=true`);
        });
    });

}

module.exports = loadDashboard;