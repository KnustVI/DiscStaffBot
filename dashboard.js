const express = require('express');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { GuildScheduledEventStatus, ChannelType } = require('discord.js');
const db = require('./src/database');
const SqliteSessionStore = require('./web/sqliteSessionStore');
const ConfigSystem = require('./src/systems/core/configSystem');
const PremiumSystem = require('./src/systems/premium/premiumSystem');

const app = express();

// Rótulos exibidos pra web dos status reais de reports.status (mesmo mapa
// usado em reportChatSystem.js:89-106) — 'closed_no_reason'/'closed_with_reason'
// são os dois únicos valores "fechado" (checados via LIKE 'closed%' nas
// queries abaixo, não existe um booleano is_closed na tabela).
const REPORT_STATUS_LABELS = {
    waiting: 'Aguardando staff',
    responded: 'Staff respondeu',
    inactive: 'Inativo (24h sem mensagens)',
    closed_no_reason: 'Fechado sem motivo',
    closed_with_reason: 'Concluído',
};

// "Pulso" do servidor (jogadores/staff online agora) — reaproveitado pelas
// páginas de Moderação, Reports e Events (o Figma repete a mesma seção "IN
// GAME"/"STAFF ONLINE" nelas). Staff "online"/"offline" aqui é status EM
// JOGO (via pot_players.is_online, alimentado pelo webhook de login do PoT),
// não presença do Discord — o bot não tem a intent GuildPresences habilitada,
// e o dono confirmou que o sentido real dessa seção é status em jogo mesmo.
async function getServerPulse(guildId, guild) {
    const staffRoleIds = new Set([
        ...ConfigSystem.getRoleIds(guildId, 'staff_role'),
        ...ConfigSystem.getRoleIds(guildId, 'supervisor_role'),
        ...ConfigSystem.getRoleIds(guildId, 'event_role'),
    ]);

    const members = staffRoleIds.size > 0 ? await guild.members.fetch().catch(() => new Map()) : new Map();
    const staffMembers = [...members.values()].filter(m => [...staffRoleIds].some(id => m.roles.cache.has(id)));

    // "Em modo espectador" (Figma) = staff com sessão aberta em
    // pot_spectator_sessions (ligado/desligado via AdminSpectate no jogo —
    // ver analyticsSystem.js) — sinal real de "moderando agora", bem mais
    // direto que inferir por presença numa thread de report.
    const spectatingAlderonIds = new Set(
        db.prepare('SELECT alderon_id FROM pot_spectator_sessions WHERE guild_id = ?').all(guildId).map(r => r.alderon_id)
    );

    const roster = staffMembers.map(m => {
        const link = db.prepare('SELECT alderon_id FROM player_links WHERE user_id = ?').get(m.id);
        const potPlayer = link
            ? db.prepare('SELECT is_online, dinosaur_active FROM pot_players WHERE guild_id = ? AND alderon_id = ?').get(guildId, link.alderon_id)
            : null;
        const online = !!potPlayer?.is_online;
        const spectating = online && !!link && spectatingAlderonIds.has(link.alderon_id);
        // "Jogando" (dono, 2026-07-20): fora do modo espectador E já deu
        // respawn de dino — dinosaur_active só vira 1 no PlayerRespawn e
        // zera no login/morte (ver comentário da coluna em schema.js), então
        // cobre exatamente "não só online, já está jogando de fato" (não
        // conta quem está parado na tela de seleção de dino).
        const playing = online && !spectating && !!potPlayer?.dinosaur_active;
        return {
            id: m.id,
            name: m.nickname || m.user.username,
            online,
            moderating: spectating,
            playing,
        };
    });

    const playersOnline = db.prepare('SELECT COUNT(*) c FROM pot_players WHERE guild_id = ? AND is_online = 1').get(guildId).c;
    const playersTotal = db.prepare('SELECT COUNT(*) c FROM pot_players WHERE guild_id = ?').get(guildId).c;
    const staffOnline = roster.filter(s => s.online).length;
    const staffSpectating = roster.filter(s => s.moderating).length;
    const staffPlaying = roster.filter(s => s.playing).length;

    return {
        roster,
        playersOnline,
        playersTotal,
        staffOnline,
        staffSpectating,
        staffPlaying,
        staffModerating: staffSpectating,
        staffTotal: roster.length,
    };
}

// Mesmo ID hardcoded em todo comando de developer (ver src/commands/developer/*.js)
// — usado aqui só pra liberar o preview de região (BR/internacional) da
// landing page pro dono logado, ver rota GET / mais abaixo.
const DEVELOPER_ID = '203676076189286412';

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
    // Preview de região — só o dono (mesmo DEVELOPER_ID hardcoded em todo
    // comando de developer) consegue forçar a versão internacional (Ko-fi)
    // pra conferir visual/fluxo sem precisar estar de fato fora do Brasil.
    // ?preview_region=intl|br só tem efeito com essa sessão logada — pra
    // qualquer outro visitante o parâmetro é ignorado e a região real
    // (Cloudflare) continua valendo, então não dá pra um visitante comum
    // "escolher" a região só editando a URL.
    const isOwnerSession = (req) => req.user && req.user.id === DEVELOPER_ID;

    app.get('/', (req, res) => {
        const country = req.headers['cf-ipcountry'] || 'BR';
        const detectedIsBrazil = country.toUpperCase() === 'BR';
        const isOwner = isOwnerSession(req);
        const regionOverride = isOwner && ['intl', 'br'].includes(req.query.preview_region) ? req.query.preview_region : null;
        const isBrazil = regionOverride ? regionOverride === 'br' : detectedIsBrazil;

        res.render('hero', { isBrazil, isOwner, regionOverride });
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

    // ==================== MODERAÇÃO ====================
    app.get('/moderacao/:guildID', checkAuth, async (req, res) => {
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.redirect('/dashboard');
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.redirect('/dashboard');

        const pulse = await getServerPulse(guildID, guild);

        const openReportsAlert = db.prepare(
            "SELECT report_id, user_id, created_at FROM reports WHERE guild_id = ? AND status = 'waiting' ORDER BY created_at DESC"
        ).all(guildID);

        const punByStatus = db.prepare('SELECT status, COUNT(*) c FROM punishments WHERE guild_id = ? GROUP BY status').all(guildID);
        const punActive = punByStatus.find(r => r.status === 'active')?.c || 0;
        const punTotal = punByStatus.reduce((sum, r) => sum + r.c, 0);

        const filterWordCount = db.prepare('SELECT COUNT(*) c FROM pot_chat_filters WHERE guild_id = ?').get(guildID).c;
        const autoPunishments = db.prepare('SELECT COUNT(*) c FROM punishments WHERE guild_id = ? AND moderator_id = ?').get(guildID, client.user.id).c;

        const settingsRows = db.prepare('SELECT key, value FROM settings WHERE guild_id = ?').all(guildID);
        const settings = Object.fromEntries(settingsRows.map(s => [s.key, s.value]));
        const roles = [...guild.roles.cache.values()].filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position);
        const staffRoleIds = ConfigSystem.getRoleIds(guildID, 'staff_role');
        const supervisorRoleIds = ConfigSystem.getRoleIds(guildID, 'supervisor_role');

        res.render('moderacao', {
            guild,
            nickname: member.nickname || member.user.username,
            role: 'Administrador',
            pulse,
            staffRoleIds,
            supervisorRoleIds,
            openReportsAlert,
            punActive,
            punTotal,
            filterWordCount,
            autoPunishments,
            settings,
            roles,
            isCacador: PremiumSystem.isGuildAtLeast(guildID, 'cacador'),
            success: req.query.success === 'true',
        });
    });

    app.post('/moderacao/:guildID/save', checkAuth, async (req, res) => {
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.status(404).send('Guild não encontrada.');
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.status(403).send('Acesso negado.');

        const { staff_role, supervisor_role, strike_role, role_exemplar, role_problematico, panel_accent_color, panel_footer_text } = req.body;
        ConfigSystem.setRoleIds(guildID, 'staff_role', staff_role ? [staff_role] : []);
        ConfigSystem.setRoleIds(guildID, 'supervisor_role', supervisor_role ? [supervisor_role] : []);
        ConfigSystem.setSetting(guildID, 'strike_role', strike_role || null);
        ConfigSystem.setSetting(guildID, 'role_exemplar', role_exemplar || null);
        ConfigSystem.setSetting(guildID, 'role_problematico', role_problematico || null);
        // Personalização de painéis é exclusiva do plano Caçador (mesma checagem
        // de getPanelPersonalization, configSystem.js:2308-2319) — ignora
        // silenciosamente em vez de travar o resto do formulário.
        if (PremiumSystem.isGuildAtLeast(guildID, 'cacador')) {
            ConfigSystem.setSetting(guildID, 'panel_accent_color', (panel_accent_color || '').replace(/^#/, '') || null);
            ConfigSystem.setSetting(guildID, 'panel_footer_text', panel_footer_text || null);
        }
        res.redirect(`/moderacao/${guildID}?success=true`);
    });

    // ==================== REPORTS (DENÚNCIAS) ====================
    app.get('/reports/:guildID', checkAuth, async (req, res) => {
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.redirect('/dashboard');
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.redirect('/dashboard');

        const pulse = await getServerPulse(guildID, guild);

        // AGID (Alderon ID) só existe se quem abriu o report tiver vinculado a
        // conta via /registrar (player_links) — quando não tem, a linha some
        // no template em vez de mostrar algo inventado (mesmo critério já usado
        // no card de identidade do ReportChat, ver userIdentity.js:30-40).
        const enrich = (row) => {
            const link = db.prepare('SELECT alderon_id, player_name FROM player_links WHERE user_id = ?').get(row.user_id);
            return {
                ...row,
                agid: link?.alderon_id || null,
                playerName: link?.player_name || null,
                statusLabel: REPORT_STATUS_LABELS[row.status] || row.status,
            };
        };

        const openReports = db.prepare(
            "SELECT * FROM reports WHERE guild_id = ? AND status NOT LIKE 'closed%' ORDER BY created_at DESC"
        ).all(guildID).map(enrich);
        const closedReports = db.prepare(
            "SELECT * FROM reports WHERE guild_id = ? AND status LIKE 'closed%' ORDER BY closed_at DESC LIMIT 30"
        ).all(guildID).map(enrich);

        res.render('reports', {
            guild,
            nickname: member.nickname || member.user.username,
            role: 'Administrador',
            pulse,
            openReports,
            closedReports,
        });
    });

    // ==================== EVENTS ====================
    app.get('/events/:guildID', checkAuth, async (req, res) => {
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.redirect('/dashboard');
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.redirect('/dashboard');

        const pulse = await getServerPulse(guildID, guild);

        // Eventos são nativos do Discord (guild.scheduledEvents), não uma tabela
        // própria — buscados um a um com withUserCount pra pegar "inscritos"
        // (scheduledEvent.userCount), que o bot nunca guardava até hoje.
        const eventList = await guild.scheduledEvents.fetch().catch(() => new Map());
        const eventsWithCounts = await Promise.all(
            [...eventList.values()].map(ev =>
                guild.scheduledEvents.fetch({ guildScheduledEvent: ev.id, withUserCount: true }).catch(() => ev)
            )
        );
        const happeningNow = eventsWithCounts.filter(ev => ev.status === GuildScheduledEventStatus.Active);
        const scheduledEvents = eventsWithCounts.filter(ev => ev.status === GuildScheduledEventStatus.Scheduled);

        const settingsRows = db.prepare('SELECT key, value FROM settings WHERE guild_id = ?').all(guildID);
        const settings = Object.fromEntries(settingsRows.map(s => [s.key, s.value]));
        const roles = [...guild.roles.cache.values()].filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position);
        const channels = [...guild.channels.cache.values()].filter(c => c.type === ChannelType.GuildText);
        const eventRoleIds = ConfigSystem.getRoleIds(guildID, 'event_role');
        const eventNotifyRoleIds = ConfigSystem.getRoleIds(guildID, 'event_notify_role');

        res.render('events', {
            guild,
            nickname: member.nickname || member.user.username,
            role: 'Administrador',
            pulse,
            happeningNow,
            scheduledEvents,
            settings,
            roles,
            channels,
            eventRoleIds,
            eventNotifyRoleIds,
            isCacador: PremiumSystem.isGuildAtLeast(guildID, 'cacador'),
            success: req.query.success === 'true',
        });
    });

    app.post('/events/:guildID/save', checkAuth, async (req, res) => {
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.status(404).send('Guild não encontrada.');
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.status(403).send('Acesso negado.');

        const { event_role, event_notify_role, event_announce_channel } = req.body;
        ConfigSystem.setRoleIds(guildID, 'event_role', event_role ? [event_role] : []);
        ConfigSystem.setRoleIds(guildID, 'event_notify_role', event_notify_role ? [event_notify_role] : []);
        // Canal de anúncios é exclusivo do plano Caçador (configSystem.js:113-119).
        if (PremiumSystem.isGuildAtLeast(guildID, 'cacador')) {
            ConfigSystem.setSetting(guildID, 'event_announce_channel', event_announce_channel || null);
        }
        res.redirect(`/events/${guildID}?success=true`);
    });

    const PORT = process.env.DASHBOARD_PORT || 3000;
    app.listen(PORT, () => {
        console.log(`\x1b[35m[WEB]\x1b[0m Dashboard rodando em http://localhost:${PORT}`);
    });
}

module.exports = loadDashboard;