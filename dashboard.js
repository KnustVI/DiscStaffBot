const express = require('express');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const session = require('express-session');
const path = require('path');

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
}

module.exports = loadDashboard;