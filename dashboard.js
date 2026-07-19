const express = require('express');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const db = require('./src/database');
const SqliteSessionStore = require('./web/sqliteSessionStore');

const app = express();

// ==================== PARSER DE TERMOS_DE_SERVICO.txt ====================
// O .txt usa uma marcação própria (pensada pra ficar legível cru, sem
// precisar abrir nada): [==texto==]{#hexcolor} pra destaque colorido,
// ||texto|| como spoiler (sem sentido fora do Discord, só desembrulha),
// `codigo` pra inline code, • pra bullet, e blocos de seção separados por
// uma linha de travessões (――――). Convertido pra HTML aqui em vez de
// reescrever o documento inteiro em EJS, pra nunca haver risco de divergir
// do texto legal oficial (fonte única de verdade continua o .txt).
function parseTermosInline(text) {
    text = text.replace(/\[==(.+?)==\]\{#([0-9a-fA-F]{6})\}/g, (_, inner, color) =>
        `<span style="color:#${color}; font-weight:600;">${inner}</span>`);
    text = text.replace(/\|\|(.+?)\|\|/g, '$1');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    return text;
}

function parseTermosBody(bodyText) {
    const chunks = bodyText.split(/\n\s*\n/).map(c => c.trim()).filter(Boolean);
    const htmlParts = [];
    for (const chunk of chunks) {
        const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean);
        const isBulletList = lines.length > 0 && lines.every(l => l.startsWith('•'));
        if (isBulletList) {
            htmlParts.push('<ul>' + lines.map(l => `<li>${parseTermosInline(l.replace(/^•\s*/, ''))}</li>`).join('') + '</ul>');
        } else {
            htmlParts.push(`<p>${parseTermosInline(lines.join(' '))}</p>`);
        }
    }
    return htmlParts.join('\n');
}

function splitTermosBlocks(raw) {
    const DIVIDER = /^―{5,}$/;
    const blocks = [];
    let current = [];
    for (const line of raw.split(/\r?\n/)) {
        if (DIVIDER.test(line.trim())) {
            blocks.push(current.join('\n').trim());
            current = [];
        } else {
            current.push(line);
        }
    }
    blocks.push(current.join('\n').trim());
    return blocks.filter(Boolean);
}

function termosBlockToSection(block) {
    const lines = block.split('\n');
    const firstLine = (lines[0] || '').trim();
    // Bloco "tem cabeçalho" quando a 1a linha termina em ':', não é bullet, e
    // vem seguida de linha em branco (ex: "0. TÍTULO:" ou "HISTÓRICO DE
    // VERSÕES:") — sem isso, o parágrafo de fechamento (sem número, só uma
    // frase destacada) viraria seção fantasma.
    const hasHeader = firstLine.endsWith(':') && !firstLine.startsWith('•') && (lines[1] || '').trim() === '';
    if (!hasHeader) {
        return { number: null, title: null, bodyHtml: parseTermosBody(block) };
    }
    const numberMatch = firstLine.match(/^(\d+)\.\s*/);
    const number = numberMatch ? numberMatch[1] : null;
    const title = firstLine.replace(/^(\d+)\.\s*/, '').replace(/:$/, '');
    const bodyText = lines.slice(1).join('\n').trim();
    return { number, title, bodyHtml: parseTermosBody(bodyText) };
}

// labels: nome exato das linhas de metadado no idioma do arquivo (o PT usa
// "Última atualização:"/"Versão:", o EN usa "Last updated:"/"Version:") —
// só pra extrair essas duas linhas do preâmbulo, não afeta o resto do parser.
function parseTermosFile(fileName, labels) {
    const raw = fs.readFileSync(path.join(__dirname, fileName), 'utf8');
    const blocks = splitTermosBlocks(raw);

    const preambleLines = blocks[0].split('\n');
    const docTitle = preambleLines[0].trim();
    const versionIdx = preambleLines.findIndex(l => l.trim().startsWith(labels.version));
    const lastUpdated = (preambleLines.find(l => l.trim().startsWith(labels.lastUpdated)) || '').replace(labels.lastUpdated, '').trim();
    const version = (preambleLines.find(l => l.trim().startsWith(labels.version)) || '').replace(labels.version, '').trim();
    const preambleHtml = parseTermosBody(preambleLines.slice(versionIdx + 1).join('\n').trim());

    return {
        docTitle,
        lastUpdated,
        version,
        preambleHtml,
        sections: blocks.slice(1).map(termosBlockToSection),
    };
}

// Junta as duas versões (PT = texto juridicamente vigente, EN = tradução de
// cortesia — ver aviso na própria página) seção a seção, na ordem em que
// aparecem em cada arquivo. Os dois .txt são escritos manualmente pra
// manter a MESMA estrutura (mesmo número de seções, mesma ordem), então o
// zip por índice é seguro; se um dia divergirem, o pior caso é uma seção
// aparecer com título/corpo trocado — não um crash.
function loadTermosBilingual() {
    const pt = parseTermosFile('TERMOS_DE_SERVICO.txt', { lastUpdated: 'Última atualização:', version: 'Versão:' });
    const en = parseTermosFile('TERMOS_DE_SERVICO_EN.txt', { lastUpdated: 'Last updated:', version: 'Version:' });

    return {
        docTitlePt: pt.docTitle,
        docTitleEn: en.docTitle,
        lastUpdated: pt.lastUpdated,
        version: pt.version,
        preambleHtmlPt: pt.preambleHtml,
        preambleHtmlEn: en.preambleHtml,
        sections: pt.sections.map((s, i) => ({
            number: s.number,
            titlePt: s.title,
            titleEn: en.sections[i] ? en.sections[i].title : s.title,
            bodyHtmlPt: s.bodyHtml,
            bodyHtmlEn: en.sections[i] ? en.sections[i].bodyHtml : s.bodyHtml,
        })),
    };
}

function loadDashboard(client) {
    // --- 1. CONFIGURAÇÕES DE RENDERIZAÇÃO ---
    app.set('views', path.join(__dirname, 'web', 'views'));
    app.set('view engine', 'ejs');

    // Necessário quando o dashboard fica atrás de um reverse proxy (Nginx/
    // Caddy) num domínio próprio com HTTPS — sem isso, o Express nunca vê a
    // conexão original como "secure" (o proxy fala com ele por HTTP local),
    // e o cookie de sessão com `secure: true` (abaixo) nunca é salvo pelo
    // navegador, quebrando o login em loop de redirecionamento.
    if (process.env.NODE_ENV === 'production') {
        app.set('trust proxy', 1);
    }

    // Middlewares padrão
    app.use(express.static(path.join(__dirname, 'web', 'public')));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // --- 2. GERENCIAMENTO DE SESSÃO ---
    // Store em SQLite (mesma conexão better-sqlite3 do resto do bot, ver
    // web/sqliteSessionStore.js) — o padrão MemoryStore do express-session
    // não é feito pra produção: vaza memória e desloga todo mundo a cada
    // restart do bot.
    app.use(session({
        store: new SqliteSessionStore(),
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
        res.redirect('/dashboard');
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
        failureRedirect: '/dashboard'
    }), (req, res) => {
        req.session.save(() => res.redirect('/dashboard'));
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

    // Landing page pública (apresentação do bot) — primeira coisa que
    // qualquer visitante vê, sem precisar estar logado.
    //
    // Preço/forma de pagamento variam por região: Brasil continua 100%
    // manual (Pix + concessão de tier na mão, como já é hoje, em R$);
    // fora do Brasil vai por Ko-fi, em US$. `cf-ipcountry` é injetado
    // automaticamente pelo Cloudflare em toda requisição que passa pelo
    // Tunnel — não precisa de nenhum serviço de geolocalização externo.
    // Fallback pra 'BR' se o header não vier (ex: acesso direto sem
    // Cloudflare, como em dev local) — mantém o comportamento atual (Pix)
    // como padrão seguro em vez de mandar todo mundo pro Ko-fi por engano.
    app.get('/', (req, res) => {
        const country = req.headers['cf-ipcountry'] || 'BR';
        res.render('hero', { isBrazil: country.toUpperCase() === 'BR' });
    });

    // Termos de Serviço e Política de Privacidade — parseados direto de
    // TERMOS_DE_SERVICO.txt (raiz do repo) a cada request; documento é
    // pequeno e a página é pouco acessada, não vale a pena cachear e
    // arriscar servir uma versão desatualizada depois de uma edição.
    app.get('/termos', (req, res) => {
        res.render('termos', loadTermosBilingual());
    });

    // Dashboard: Seleção de Servidores (era a raiz "/" antes da landing page)
    app.get('/dashboard', (req, res) => {
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

        if (!guild) return res.redirect('/dashboard');

        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.redirect('/dashboard');

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

        if (!guild) return res.redirect('/dashboard');
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.redirect('/dashboard');

        const settingsRows = db.prepare("SELECT key, value FROM settings WHERE guild_id = ?").all(guildID);
        const settings = Object.fromEntries(settingsRows.map(s => [s.key, s.value]));

        res.render('manage', {
            guild,
            settings,
            success: req.query.success === 'true',
            user: req.user || null, // Garante que 'user' exista para o EJS
            bot: client,            // Garante que 'bot' exista para o título
            guilds: userGuilds
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