const express = require('express');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { GuildScheduledEventStatus, ChannelType } = require('discord.js');
const db = require('./src/database');
const SqliteSessionStore = require('./web/sqliteSessionStore');
const ConfigSystem = require('./src/systems/core/configSystem');
const PremiumSystem = require('./src/systems/premium/premiumSystem');
const CustomBannerResolver = require('./src/utils/customBannerResolver');
const { storeImageBuffer } = require('./src/utils/imageStorage');
const ProfileImagePool = require('./src/systems/pot/profileImagePool');

const app = express();

// Upload de banner próprio (Personalização/Report-Chat) — mesmo whitelist
// de formato do lado Discord (src/utils/imageStorage.js), guardado só em
// memória (nunca gravado em disco): storeImageBuffer já reencoda/reenvia
// pro canal de armazenamento do bot antes de qualquer coisa persistir.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
            return cb(new Error('O arquivo enviado precisa ser uma imagem estática (png, jpg ou webp).'));
        }
        cb(null, true);
    },
});

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

// Cache curto do guild.members.fetch() (chamada cara/sujeita a rate limit
// da API do Discord) — sem isso, a lista de staff some/pisca sempre que
// essa chamada falha ou demora, e agora ela roda TANTO a cada carregamento
// de página QUANTO a cada poll de 15s do ingame-pulse-poll.js, multiplicando
// a frequência. Guarda o último resultado bom por guild; se um fetch novo
// falhar, cai pro cache (mesmo vencido) em vez de virar lista vazia — é
// isso que fazia a lista "sumir em alguns momentos".
const memberFetchCache = new Map(); // guildId -> { members, expiresAt }
const MEMBER_FETCH_TTL_MS = 25000;

async function getCachedMembers(guild) {
    const cached = memberFetchCache.get(guild.id);
    if (cached && cached.expiresAt > Date.now()) return cached.members;

    const fresh = await guild.members.fetch().catch(() => null);
    if (fresh) {
        memberFetchCache.set(guild.id, { members: fresh, expiresAt: Date.now() + MEMBER_FETCH_TTL_MS });
        return fresh;
    }
    return cached ? cached.members : new Map();
}

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

    const members = staffRoleIds.size > 0 ? await getCachedMembers(guild) : new Map();
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
            ? db.prepare('SELECT is_online FROM pot_players WHERE guild_id = ? AND alderon_id = ?').get(guildId, link.alderon_id)
            : null;
        const online = !!potPlayer?.is_online;
        const spectating = online && !!link && spectatingAlderonIds.has(link.alderon_id);
        // "Jogando" (dono, 2026-07-20): online e fora do modo espectador —
        // definição simples, mesma usada tanto no rótulo por staff quanto
        // no total do donut (uma única fonte de verdade, sem os dois
        // discordarem entre si).
        const playing = online && !spectating;

        // "Maior cargo no discord" (pedido do dono) — não existe conceito de
        // cargo/rank EM JOGO nos dados do PoT hoje (pot_players não guarda
        // isso), então usa sempre a posição real do cargo mais alto entre os
        // cargos de staff (staff_role/supervisor_role/event_role) que o
        // membro tem no servidor.
        const memberStaffRoles = [...m.roles.cache.values()].filter(r => staffRoleIds.has(r.id));
        const topRole = memberStaffRoles.sort((a, b) => b.position - a.position)[0];

        return {
            id: m.id,
            name: m.nickname || m.user.username,
            cargo: topRole ? topRole.name : '—',
            online,
            moderating: spectating,
            playing,
            // Texto literal do card (pedido do dono: "Online ou Offline ou
            // Espectador") — a cor da borda continua só 2 estados (verde/
            // vermelho, ver ingame-pulse.ejs), pois "Espectador" ainda é
            // online (só uma sub-condição dele).
            statusLabel: spectating ? 'Espectador' : (online ? 'Online' : 'Offline'),
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

// Resolve a `value` de uma opção de banner ESTÁTICA (só sobra "Padrão do
// bot" nas 3 listas depois da unificação com o pool dinâmico — ex:
// 'title_strike') pra URL servível pelo dashboard — os mesmos arquivos do
// imageManager (assets/images/, usados como attachment:// no Discord)
// foram copiados pra web/public/images/ com hífen em vez de underscore,
// então a troca de separador já resolve.
function bannerOptionUrl(value) {
    return `/images/${String(value).replace(/_/g, '-')}.webp`;
}

// getStrikeBannerOptions()/etc. (configSystem.js) misturam a opção estática
// "Padrão do bot" com fotos do pool dinâmico ("pool:<id>", ver
// ProfileImagePool) — cada uma precisa de uma resolução de URL diferente
// (arquivo local vs. fetch no canal de armazenamento do bot), daí essa
// função async por cima das opções síncronas.
async function resolveBannerOptionsWithUrls(client, options) {
    return Promise.all(options.map(async opt => ({
        ...opt,
        url: ProfileImagePool.isPoolValue(opt.value)
            ? await ProfileImagePool.resolveImageUrl(client, 'banner', ProfileImagePool.poolIdFromValue(opt.value))
            : bannerOptionUrl(opt.value),
    })));
}

// Estatísticas de Punições/Automoderação (moderacao.ejs) — função própria
// pra poder ser chamada tanto no carregamento normal de
// /moderacao/:guildID quanto no fragment de poll em tempo real (GET
// /fragments/moderation-stats/:guildID, pedido do dono: "gráficos"
// também em tempo real, mesmo padrão já usado em getServerPulse acima),
// sem duplicar as queries nos dois lugares.
function getModerationStats(guildId, botUserId) {
    const punByStatus = db.prepare('SELECT status, COUNT(*) c FROM punishments WHERE guild_id = ? GROUP BY status').all(guildId);
    const punActive = punByStatus.find(r => r.status === 'active')?.c || 0;
    const punTotal = punByStatus.reduce((sum, r) => sum + r.c, 0);
    const punRevoked = punTotal - punActive;
    const punHighSeverity = db.prepare(
        "SELECT COUNT(*) c FROM punishments WHERE guild_id = ? AND level_severity IN ('Grave', 'Severa')"
    ).get(guildId).c;

    const filterWordCount = db.prepare('SELECT COUNT(*) c FROM pot_chat_filters WHERE guild_id = ?').get(guildId).c;
    const autoPunishments = db.prepare('SELECT COUNT(*) c FROM punishments WHERE guild_id = ? AND moderator_id = ?').get(guildId, botUserId).c;
    const filterLevelCount = db.prepare('SELECT COUNT(DISTINCT level_id) c FROM pot_chat_filters WHERE guild_id = ?').get(guildId).c;

    return { punActive, punTotal, punRevoked, punHighSeverity, filterWordCount, filterLevelCount, autoPunishments };
}

// Reports abertos/fechados (reports.ejs) — mesmo motivo de
// Nome de exibição de um usuário do Discord a partir só do ID — tenta o
// cache do client PRIMEIRO (rápido, sem chamada de API, e mais atualizado
// que o banco pra quem o bot já viu recentemente), cai pra tabela `users`
// (snapshot salvo por db.ensureUser em qualquer interação) se não estiver
// em cache. Sem fetch() de propósito: a lista de reports pode ter dezenas
// de usuários pra resolver (reporter/closed_by/thread_deleted_by de cada
// linha), um fetch por usuário seria lento e bateria em rate limit à toa.
function resolveUserDisplayName(client, userId) {
    if (!userId) return null;
    const cached = client.users.cache.get(userId);
    if (cached) return cached.username;
    const dbUser = db.prepare('SELECT username FROM users WHERE user_id = ?').get(userId);
    return dbUser?.username || `Usuário desconhecido (${userId})`;
}

// getModerationStats acima: reaproveitado pelo carregamento normal de
// /reports/:guildID e pelo fragment de poll (GET
// /fragments/reports-list/:guildID). Precisa do client pra resolver nome
// do Discord de quem abriu/fechou/apagou o tópico (ver
// resolveUserDisplayName acima) — pedido do dono: a lista não mostrava
// nem o nome do Discord nem o nome em jogo do jogador antes disso.
function getReportsData(guildId, client) {
    const enrich = (row) => {
        const link = db.prepare('SELECT alderon_id, player_name FROM player_links WHERE user_id = ?').get(row.user_id);
        return {
            ...row,
            agid: link?.alderon_id || null,
            playerName: link?.player_name || null,
            discordUsername: resolveUserDisplayName(client, row.user_id),
            closedByName: row.closed_by ? resolveUserDisplayName(client, row.closed_by) : null,
            threadDeletedByName: row.thread_deleted_by ? resolveUserDisplayName(client, row.thread_deleted_by) : null,
            statusLabel: REPORT_STATUS_LABELS[row.status] || row.status,
        };
    };

    const openReports = db.prepare(
        "SELECT * FROM reports WHERE guild_id = ? AND status NOT LIKE 'closed%' ORDER BY created_at DESC"
    ).all(guildId).map(enrich);
    const closedReports = db.prepare(
        "SELECT * FROM reports WHERE guild_id = ? AND status LIKE 'closed%' ORDER BY closed_at DESC LIMIT 30"
    ).all(guildId).map(enrich);

    return { openReports, closedReports };
}

// Mesmo ID hardcoded em todo comando de developer (ver src/commands/developer/*.js)
// — usado aqui pra liberar o preview de região (BR/internacional) da
// landing page pro dono logado (GET /) e, agora, pra travar o dashboard
// só pro dono enquanto ele está em desenvolvimento (ver
// DASHBOARD_LOCKED_TO_OWNER abaixo).
const DEVELOPER_ID = '203676076189286412';

// Trava temporária (pedido do dono, 2026-08-02): enquanto o dashboard
// ainda está em desenvolvimento, só quem loga com o DEVELOPER_ID acima
// consegue de fato entrar — visitante não logado ainda vê o botão de
// login normal (senão o próprio dono nunca provaria quem é), mas
// qualquer OUTRA conta logada esbarra num aviso em vez do conteúdo real
// (ver GET /dashboard e o gate em /moderacao, /reports, /events abaixo).
// Pra reabrir o dashboard pro público, é só trocar pra false.
const DASHBOARD_LOCKED_TO_OWNER = true;

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

    // Servidores que o usuário administra E onde o bot já está — mesmo
    // filtro usado em /dashboard (ver rota abaixo), reaproveitado pelo
    // seletor de servidor no ícone do page-header (troca de servidor sem
    // precisar voltar pro /dashboard) nas páginas de Moderação/Reports/
    // Eventos.
    function getAdminGuildsWithBot(req) {
        if (!req.user || !req.user.guilds) return [];
        return req.user.guilds.filter(g =>
            (parseInt(g.permissions) & 0x8) === 0x8 && // Permissão de ADMINISTRADOR
            client.guilds.cache.has(g.id) // bot precisa estar no servidor
        );
    }

    // Ver DASHBOARD_LOCKED_TO_OWNER no topo do arquivo — chamado logo após
    // checkAuth (que já garante req.user) em toda página/save de servidor
    // (moderação/reports/eventos), pra ninguém além do dono entrar
    // enquanto o dashboard está em desenvolvimento. Manda pra /dashboard
    // em vez de responder 403 direto porque é lá que mora o aviso
    // explicando o motivo (ver GET /dashboard).
    function isDashboardLocked(req) {
        return DASHBOARD_LOCKED_TO_OWNER && req.user.id !== DEVELOPER_ID;
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

    // ==================== POOL DE IMAGENS (só o dono) ====================
    // Ativa/desativa a visibilidade pública de cada imagem do pool dinâmico
    // (avatar/plano de fundo/emblema/banner — ver profileImagePool.js) sem
    // precisar removê-la de verdade (pedido do dono, preparação pro pool
    // ficar mais aberto no futuro). Página GLOBAL, sem :guildID (o pool não
    // pertence a nenhum servidor). isOwnerSession (não isDashboardLocked,
    // que é só o cadeado temporário de "site em desenvolvimento") é o gate
    // certo aqui — fica restrito ao dono pra sempre, mesmo depois do resto
    // do dashboard abrir pra outros admins.
    const IMAGE_POOL_TYPES = [
        { type: 'avatar', label: 'Avatar (Foto de Perfil)' },
        { type: 'background', label: 'Plano de Fundo' },
        { type: 'badge', label: 'Emblema' },
        { type: 'banner', label: 'Banner (Personalização)' },
    ];

    app.get('/dev/image-pool', checkAuth, async (req, res) => {
        if (!isOwnerSession(req)) return res.status(403).send('Acesso restrito ao desenvolvedor do bot.');

        const groups = await Promise.all(IMAGE_POOL_TYPES.map(async ({ type, label }) => {
            const rows = ProfileImagePool.listImages(type);
            const images = await Promise.all(rows.map(async row => ({
                ...row,
                url: await ProfileImagePool.resolveImageUrl(client, type, row.id),
            })));
            return { type, label, images };
        }));

        res.render('dev-image-pool', { groups });
    });

    app.post('/dev/image-pool/:type/:id/toggle', checkAuth, async (req, res) => {
        if (!isOwnerSession(req)) return res.status(403).send('Acesso restrito ao desenvolvedor do bot.');
        const { type } = req.params;
        const id = Number(req.params.id);
        const row = ProfileImagePool.getByTypeAndId(type, id);
        if (row) ProfileImagePool.setPublic(type, id, !row.is_public);
        res.redirect('/dev/image-pool');
    });

    // Upload direto pelo dashboard (pedido do dono: não precisar ir no
    // Discord toda vez) — mesma receita de storeImageBuffer já usada pro
    // upload próprio de banner (POST /moderacao/:guildID/save), só que
    // gravando no pool em vez de num setting de guild específico.
    app.post(
        '/dev/image-pool/:type/upload',
        checkAuth,
        upload.single('imagem'),
        async (req, res) => {
            if (!isOwnerSession(req)) return res.status(403).send('Acesso restrito ao desenvolvedor do bot.');
            const { type } = req.params;
            if (!ProfileImagePool.VALID_TYPES.includes(type)) return res.status(400).send('Tipo de pool inválido.');

            const label = (req.body.label || '').trim();
            const file = req.file;
            if (label && file) {
                const result = await storeImageBuffer(client, file.buffer, `${type} (pool) — "${label}" adicionado via dashboard por \`${req.user.username}\``);
                if (result.ok) {
                    ProfileImagePool.addImage(type, label, result.messageId, req.user.id);
                }
            }
            res.redirect('/dev/image-pool');
        }
    );

    // Remove de verdade (diferente do toggle, que só esconde) — mesmo
    // efeito de /perfil-pool remover no Discord, só que pelo dashboard.
    app.post('/dev/image-pool/:type/:id/delete', checkAuth, async (req, res) => {
        if (!isOwnerSession(req)) return res.status(403).send('Acesso restrito ao desenvolvedor do bot.');
        const { type } = req.params;
        const id = Number(req.params.id);
        ProfileImagePool.removeImage(type, id);
        res.redirect('/dev/image-pool');
    });

    // Dashboard: Seleção de Servidores (era a raiz "/" antes da landing page)
    // Só mostra servidores onde o bot JÁ ESTÁ (pedido do dono) — antes
    // listava todo servidor que o usuário administra no Discord, mesmo sem
    // o bot lá (o ícone levava pra /moderacao/:guildID, que redireciona de
    // volta pro dashboard nesse caso já que client.guilds.cache não acha a
    // guild — clicável, mas sem nenhum efeito visível, confuso).
    app.get('/dashboard', (req, res) => {
        // Não logado ainda vê a tela de login normal (pode ser o próprio
        // dono provando quem é) — só quem JÁ ESTÁ logado como outra conta
        // vê o aviso de "em desenvolvimento" no lugar da lista de servidores.
        const locked = DASHBOARD_LOCKED_TO_OWNER && req.user && req.user.id !== DEVELOPER_ID;
        res.render('index', { guilds: locked ? [] : getAdminGuildsWithBot(req), locked });
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

    // ==================== FRAGMENTOS (atualização em tempo real) ====================
    // Devolve só o HTML do partial "IN GAME" já renderizado de novo com dado
    // fresco — usado pelo polling client-side em
    // web/public/js/ingame-pulse-poll.js (Moderação/Reports/Events) pra
    // atualizar status de staff/donuts sem recarregar a página inteira.
    // Mesmo padrão de auth das outras rotas por guild.
    app.get('/fragments/ingame-pulse/:guildID', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.status(403).send('');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.status(404).send('');
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.status(403).send('');

        const pulse = await getServerPulse(guildID, guild);
        res.render('partials/ingame-pulse', {
            pulse,
            showRoster: req.query.showRoster !== 'false',
        });
    });

    // Punições/Automoderação (moderacao.ejs) em tempo real — pedido do
    // dono ("gráficos" também em tempo real, mesmo padrão do fragment de
    // IN GAME acima). Só consultas ao banco (getModerationStats), sem
    // fetch de membros — não precisa do cache/TTL usado em
    // getCachedMembers/getServerPulse.
    app.get('/fragments/moderation-stats/:guildID', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.status(403).send('');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.status(404).send('');
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.status(403).send('');

        const stats = getModerationStats(guildID, client.user.id);
        res.render('partials/moderation-stats', stats);
    });

    // Lista de reports (reports.ejs) em tempo real — pedido do dono
    // ("chats de reportes" também em tempo real).
    app.get('/fragments/reports-list/:guildID', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.status(403).send('');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.status(404).send('');
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.status(403).send('');

        const { openReports, closedReports } = getReportsData(guildID, client);
        res.render('partials/reports-list', { guild, openReports, closedReports });
    });

    // ==================== MODERAÇÃO ====================
    app.get('/moderacao/:guildID', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.redirect('/dashboard');
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.redirect('/dashboard');

        const pulse = await getServerPulse(guildID, guild);

        const openReportsAlert = db.prepare(
            "SELECT report_id, user_id, created_at FROM reports WHERE guild_id = ? AND status = 'waiting' ORDER BY created_at DESC"
        ).all(guildID);

        const { punActive, punTotal, punRevoked, punHighSeverity, filterWordCount, filterLevelCount, autoPunishments } = getModerationStats(guildID, client.user.id);

        const settingsRows = db.prepare('SELECT key, value FROM settings WHERE guild_id = ?').all(guildID);
        const settings = Object.fromEntries(settingsRows.map(s => [s.key, s.value]));
        const roles = [...guild.roles.cache.values()].filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position);
        // Personalização (card no fim da página) espelha os blocos do
        // /config personalizar do Discord relevantes pra Moderação
        // (Strike/Unstrike, Aparência Geral — ver configSystem.js
        // refreshPersonalizarPanel; Report-Chat mora em GET /reports/:guildID,
        // ver lá), mesmas opções/rótulos nos dois lugares via
        // ConfigSystem.get*BannerOptions() — vêm do pool dinâmico de imagens
        // agora (ver profileImagePool.js), só "Padrão do bot" continua
        // estático (resolveBannerOptionsWithUrls trata os dois casos).
        const strikeBannerKey = settings.strike_banner_key || 'title_strike';
        const unstrikeBannerKey = settings.unstrike_banner_key || 'title_strike_removido';
        const strikeBannerOptions = await resolveBannerOptionsWithUrls(client, ConfigSystem.getStrikeBannerOptions());
        const unstrikeBannerOptions = await resolveBannerOptionsWithUrls(client, ConfigSystem.getUnstrikeBannerOptions());
        // Prévia da imagem PRÓPRIA enviada (Caçador, upload direto em vez de
        // escolher da galeria) — null se não houver upload ativo pra esse
        // campo, ver src/utils/customBannerResolver.js.
        const strikeCustomBannerUrl = await CustomBannerResolver.resolveBannerUrl(client, guildID, 'strike');
        const unstrikeCustomBannerUrl = await CustomBannerResolver.resolveBannerUrl(client, guildID, 'unstrike');
        const staffRoleIds = ConfigSystem.getRoleIds(guildID, 'staff_role');
        const supervisorRoleIds = ConfigSystem.getRoleIds(guildID, 'supervisor_role');
        // Mesmo limite por tier já usado no painel /config roles do Discord
        // (ver configSystem.js ROLE_TABS.moderation.fields[*].roleLimitKey) —
        // decide se cada campo vira select simples ou chips+botão de
        // adicionar em partials/role-picker.ejs.
        const roleLimits = {
            moderador: PremiumSystem.getRoleLimit(guildID, 'moderador'),
            supervisor: PremiumSystem.getRoleLimit(guildID, 'supervisor'),
        };

        res.render('moderacao', {
            guild,
            nickname: member.nickname || member.user.username,
            role: 'Administrador',
            isOwner: isOwnerSession(req),
            pageRoute: 'moderacao',
            otherGuilds: getAdminGuildsWithBot(req),
            pulse,
            staffRoleIds,
            supervisorRoleIds,
            roleLimits,
            openReportsAlert,
            punActive,
            punTotal,
            punRevoked,
            punHighSeverity,
            filterWordCount,
            autoPunishments,
            filterLevelCount,
            settings,
            roles,
            isCacador: PremiumSystem.isGuildAtLeast(guildID, 'cacador'),
            strikeBannerKey,
            unstrikeBannerKey,
            strikeBannerOptions,
            unstrikeBannerOptions,
            strikeCustomBannerUrl,
            unstrikeCustomBannerUrl,
            saved: req.query.saved,
        });
    });

    app.post(
        '/moderacao/:guildID/save',
        checkAuth,
        upload.fields([{ name: 'strike_banner_file', maxCount: 1 }, { name: 'unstrike_banner_file', maxCount: 1 }]),
        async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.status(404).send('Guild não encontrada.');
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.status(403).send('Acesso negado.');

        // Só grava as chaves que vieram NESTE submit (checagem "in body") —
        // defensivo mesmo com 1 form só hoje, não custa nada manter.
        const body = req.body;
        const files = req.files || {};
        try {
            // MODERADOR/SUPERVISOR agora aceitam mais de um cargo (ver
            // partials/role-picker.ejs) — cada cargo chega como um hidden
            // input separado, mesmo `name`; com express.urlencoded({extended:
            // true}) isso já vira array sozinho, mas um só cargo ainda chega
            // como string solta (comportamento do próprio parser), daí o
            // toArray. Limite reaplicado aqui (defesa em profundidade: mesmo
            // limite do tier, ver PremiumSystem.getRoleLimit) — o picker já
            // trava no client, mas um POST forjado não passa por ele.
            const toArray = (val) => Array.isArray(val) ? val : (val ? [val] : []);
            if ('staff_role' in body) {
                const limit = PremiumSystem.getRoleLimit(guildID, 'moderador');
                ConfigSystem.setRoleIds(guildID, 'staff_role', toArray(body.staff_role).filter(Boolean).slice(0, limit));
            }
            if ('supervisor_role' in body) {
                const limit = PremiumSystem.getRoleLimit(guildID, 'supervisor');
                ConfigSystem.setRoleIds(guildID, 'supervisor_role', toArray(body.supervisor_role).filter(Boolean).slice(0, limit));
            }
            if ('strike_role' in body) ConfigSystem.setSetting(guildID, 'strike_role', body.strike_role || null);
            if ('role_exemplar' in body) ConfigSystem.setSetting(guildID, 'role_exemplar', body.role_exemplar || null);
            if ('role_problematico' in body) ConfigSystem.setSetting(guildID, 'role_problematico', body.role_problematico || null);
            // Personalização de painéis é exclusiva do plano Caçador (mesma checagem
            // de getPanelPersonalization, configSystem.js:2308-2319) — ignora
            // silenciosamente em vez de travar o resto do formulário. Espelha
            // os blocos do /config personalizar do Discord relevantes pra
            // Moderação (Strike/Unstrike, Aparência Geral); Report-Chat tem
            // seu próprio save em POST /reports/:guildID/save.
            const strikeFile = files.strike_banner_file?.[0];
            const unstrikeFile = files.unstrike_banner_file?.[0];
            const personalizarFields = ['panel_accent_color', 'panel_footer_text', 'strike_banner_key', 'unstrike_banner_key'];
            if ((personalizarFields.some(f => f in body) || strikeFile || unstrikeFile) && PremiumSystem.isGuildAtLeast(guildID, 'cacador')) {
                if ('panel_accent_color' in body) ConfigSystem.setSetting(guildID, 'panel_accent_color', (body.panel_accent_color || '').replace(/^#/, '') || null);
                if ('panel_footer_text' in body) ConfigSystem.setSetting(guildID, 'panel_footer_text', body.panel_footer_text || null);

                // Upload de imagem própria tem prioridade sobre a galeria —
                // se um arquivo veio junto, ele vence mesmo com um rádio
                // marcado no mesmo submit (mesma receita de storeImageBuffer
                // usada pelo upload próprio do Discord, ver
                // src/utils/imageStorage.js/customBannerResolver.js).
                if (strikeFile) {
                    const result = await storeImageBuffer(client, strikeFile.buffer, `Banner do /strike de \`${guild.name}\` (\`${guild.id}\`)`);
                    if (result.ok) {
                        ConfigSystem.setSetting(guildID, 'strike_banner_key', 'custom_upload');
                        ConfigSystem.setSetting(guildID, 'strike_banner_message_id', result.messageId);
                    }
                } else if ('strike_banner_key' in body) {
                    // Mesma validação de valor do painel /config personalizar
                    // do Discord (isValidOption, configSystem.js) — o picker
                    // do dashboard já só manda um dos valores válidos, isso
                    // aqui é defesa contra um POST forjado.
                    const isValid = ConfigSystem.getStrikeBannerOptions().some(opt => opt.value === body.strike_banner_key);
                    if (isValid) {
                        ConfigSystem.setSetting(guildID, 'strike_banner_key', body.strike_banner_key);
                        ConfigSystem.setSetting(guildID, 'strike_banner_message_id', null);
                    }
                }

                if (unstrikeFile) {
                    const result = await storeImageBuffer(client, unstrikeFile.buffer, `Banner do /unstrike de \`${guild.name}\` (\`${guild.id}\`)`);
                    if (result.ok) {
                        ConfigSystem.setSetting(guildID, 'unstrike_banner_key', 'custom_upload');
                        ConfigSystem.setSetting(guildID, 'unstrike_banner_message_id', result.messageId);
                    }
                } else if ('unstrike_banner_key' in body) {
                    const isValid = ConfigSystem.getUnstrikeBannerOptions().some(opt => opt.value === body.unstrike_banner_key);
                    if (isValid) {
                        ConfigSystem.setSetting(guildID, 'unstrike_banner_key', body.unstrike_banner_key);
                        ConfigSystem.setSetting(guildID, 'unstrike_banner_message_id', null);
                    }
                }
            }
            res.redirect(`/moderacao/${guildID}?saved=success`);
        } catch (error) {
            console.error('❌ Erro ao salvar configurações de moderação:', error);
            res.redirect(`/moderacao/${guildID}?saved=error`);
        }
    });

    // ==================== REPORTS (DENÚNCIAS) ====================
    app.get('/reports/:guildID', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.redirect('/dashboard');
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.redirect('/dashboard');

        const pulse = await getServerPulse(guildID, guild);
        const { openReports, closedReports } = getReportsData(guildID, client);

        // Personalização do Report-Chat (bloco do /config personalizar do
        // Discord, ver configSystem.js refreshPersonalizarPanel) mora aqui
        // na aba de Denúncias, não em Moderação (pedido do dono) — mesmo
        // padrão de resolveBannerOptionsWithUrls/ConfigSystem.get*BannerOptions()
        // já usado em GET /moderacao/:guildID pro Strike/Unstrike.
        const settingsRows = db.prepare('SELECT key, value FROM settings WHERE guild_id = ?').all(guildID);
        const settings = Object.fromEntries(settingsRows.map(s => [s.key, s.value]));
        const reportChatBannerKey = settings.report_chat_banner_key || 'title_report_chat';
        const reportChatBannerOptions = await resolveBannerOptionsWithUrls(client, ConfigSystem.getReportChatBannerOptions());
        // Prévia da imagem PRÓPRIA enviada (Caçador, upload direto em vez de
        // escolher da galeria) — null se não houver upload ativo.
        const reportChatCustomBannerUrl = await CustomBannerResolver.resolveBannerUrl(client, guildID, 'reportchat');

        res.render('reports', {
            guild,
            nickname: member.nickname || member.user.username,
            role: 'Administrador',
            isOwner: isOwnerSession(req),
            pageRoute: 'reports',
            otherGuilds: getAdminGuildsWithBot(req),
            pulse,
            openReports,
            closedReports,
            settings,
            isCacador: PremiumSystem.isGuildAtLeast(guildID, 'cacador'),
            reportChatBannerKey,
            reportChatBannerOptions,
            reportChatCustomBannerUrl,
            saved: req.query.saved,
        });
    });

    app.post(
        '/reports/:guildID/save',
        checkAuth,
        upload.single('report_chat_banner_file'),
        async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.status(404).send('Guild não encontrada.');
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.status(403).send('Acesso negado.');

        const body = req.body;
        const bannerFile = req.file;
        try {
            // Personalização do Report-Chat é exclusiva do plano Caçador
            // (mesma checagem de getPanelPersonalization, configSystem.js) —
            // ignora silenciosamente em vez de travar o resto do formulário.
            const reportChatFields = ['report_chat_banner_key', 'report_chat_message', 'report_chat_welcome_message'];
            if ((reportChatFields.some(f => f in body) || bannerFile) && PremiumSystem.isGuildAtLeast(guildID, 'cacador')) {
                // Upload de imagem própria tem prioridade sobre a galeria —
                // se um arquivo veio junto, ele vence mesmo com um rádio
                // marcado no mesmo submit (mesma receita de storeImageBuffer
                // usada pelo upload próprio do Discord, ver
                // src/utils/imageStorage.js/customBannerResolver.js).
                if (bannerFile) {
                    const result = await storeImageBuffer(client, bannerFile.buffer, `Banner do report-chat de \`${guild.name}\` (\`${guild.id}\`)`);
                    if (result.ok) {
                        ConfigSystem.setSetting(guildID, 'report_chat_banner_key', 'custom_upload');
                        ConfigSystem.setSetting(guildID, 'report_chat_banner_message_id', result.messageId);
                    }
                } else if ('report_chat_banner_key' in body) {
                    // Mesma validação do painel /config personalizar do
                    // Discord (isValidOption) — o picker do dashboard já só
                    // manda um dos valores válidos, isso aqui é defesa
                    // contra um POST forjado.
                    const isValid = ConfigSystem.getReportChatBannerOptions().some(opt => opt.value === body.report_chat_banner_key);
                    if (isValid) {
                        ConfigSystem.setSetting(guildID, 'report_chat_banner_key', body.report_chat_banner_key);
                        ConfigSystem.setSetting(guildID, 'report_chat_banner_message_id', null);
                    }
                }
                // Mesmo limite de 1000 caracteres do modal do Discord
                // (TextInputBuilder maxLength) — o <textarea> do dashboard já
                // tem maxlength="1000" no HTML, isso aqui é a mesma defesa.
                if ('report_chat_message' in body) ConfigSystem.setSetting(guildID, 'report_chat_message', (body.report_chat_message || '').trim().slice(0, 1000) || null);
                if ('report_chat_welcome_message' in body) ConfigSystem.setSetting(guildID, 'report_chat_welcome_message', (body.report_chat_welcome_message || '').trim().slice(0, 1000) || null);
            }
            res.redirect(`/reports/${guildID}?saved=success`);
        } catch (error) {
            console.error('❌ Erro ao salvar personalização do report-chat:', error);
            res.redirect(`/reports/${guildID}?saved=error`);
        }
    });

    // ==================== EVENTS ====================
    app.get('/events/:guildID', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
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
            isOwner: isOwnerSession(req),
            pageRoute: 'events',
            otherGuilds: getAdminGuildsWithBot(req),
            pulse,
            happeningNow,
            scheduledEvents,
            settings,
            roles,
            channels,
            eventRoleIds,
            eventNotifyRoleIds,
            isCacador: PremiumSystem.isGuildAtLeast(guildID, 'cacador'),
            saved: req.query.saved,
        });
    });

    app.post('/events/:guildID/save', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.status(404).send('Guild não encontrada.');
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member || !member.permissions.has('Administrator')) return res.status(403).send('Acesso negado.');

        try {
            const { event_role, event_notify_role, event_announce_channel } = req.body;
            ConfigSystem.setRoleIds(guildID, 'event_role', event_role ? [event_role] : []);
            ConfigSystem.setRoleIds(guildID, 'event_notify_role', event_notify_role ? [event_notify_role] : []);
            // Canal de anúncios é exclusivo do plano Caçador (configSystem.js:113-119).
            if (PremiumSystem.isGuildAtLeast(guildID, 'cacador')) {
                ConfigSystem.setSetting(guildID, 'event_announce_channel', event_announce_channel || null);
            }
            res.redirect(`/events/${guildID}?saved=success`);
        } catch (error) {
            console.error('❌ Erro ao salvar configurações de eventos:', error);
            res.redirect(`/events/${guildID}?saved=error`);
        }
    });

    const PORT = process.env.DASHBOARD_PORT || 3000;
    app.listen(PORT, () => {
        console.log(`\x1b[35m[WEB]\x1b[0m Dashboard rodando em http://localhost:${PORT}`);
    });
}

module.exports = loadDashboard;