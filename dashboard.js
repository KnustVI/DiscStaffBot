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
const ImageShopSystem = require('./src/systems/pot/imageShopSystem');
const PunishmentLevels = require('./src/systems/moderation/punishmentLevels');
const PlayerRegistry = require('./src/systems/pot/potPlayerRegistry');
const CurrencySystem = require('./src/systems/pot/currencySystem');
const GameShopSystem = require('./src/systems/pot/gameShopSystem');
const AchievementSystem = require('./src/systems/pot/achievementSystem');
const PunishmentSystem = require('./src/systems/moderation/punishmentSystem');
const StaffPresenceSystem = require('./src/systems/moderation/staffPresenceSystem');
const GeneralNewsSystem = require('./src/systems/news/generalNewsSystem');
const PlayerRegistrationSystem = require('./src/systems/pot/playerRegistrationSystem');
const { renderProfileCard } = require('./src/utils/profileCardRenderer');
const PoTConfigSystem = require('./src/systems/pot/potConfigSystem');

// Cache-busting pras imagens estáticas da home (assets/screenshots em
// web/public/images/) — pedido do dono, 2026-08-12: atualizou o print do
// /perfil na home (screenshot-perfil.webp) e ele continuou aparecendo
// desatualizado pro navegador, mesmo com o arquivo já certo no disco —
// causa real: o nome do arquivo nunca muda, então o navegador (e qualquer
// cache na frente, ex. Cloudflare) segue servindo a versão antiga que já
// tinha em cache, sem saber que o conteúdo mudou. Calculado UMA VEZ no
// boot do processo (não por request) — todo `pm2 restart` já gera uma
// versão nova sozinho, sem precisar tocar em nada manualmente a cada
// atualização de imagem.
const ASSET_VERSION = Date.now();

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

// Multer chama next(err) quando o arquivo é rejeitado (tipo inválido, ou
// maior que os 8MB do limite acima) — como upload.single()/upload.fields()
// é usado como middleware ANTES do handler da rota, esse erro nunca
// chegava no try/catch de dentro da rota; sem um error handler próprio ele
// caía no handler PADRÃO do Express (página crua "Error: ...", sem nada a
// ver com o resto do site) em vez do fluxo normal de "?saved=error" que
// toda página de save já usa. Bug real reportado pelo dono, 2026-08-07:
// "Subir o arquivo de personalização de banner de report parece que deu
// erro" — mesma causa afeta TODOS os 4 uploads do dashboard (perfil,
// moderação, report-chat, pool de imagens do dono), não só o de report,
// então corrigido nos 4 de uma vez com este wrapper em vez de só o
// reportado. Envolve QUALQUER upload.single/upload.fields, redirecionando
// de volta com o mesmo aviso visual de erro já usado no resto do
// dashboard (partials/save-result-overlay.ejs) em vez de mostrar a tela
// crua do Express.
function safeUpload(multerMiddleware, redirectTo) {
    return (req, res, next) => {
        multerMiddleware(req, res, (err) => {
            if (err) {
                console.error(`❌ [Dashboard] Erro de upload (${req.originalUrl}):`, err.message);
                return res.redirect(typeof redirectTo === 'function' ? redirectTo(req) : redirectTo);
            }
            next();
        });
    };
}

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

// Cargo de staff de MAIOR posição no Discord que um membro possui, entre os
// 3 cargos configurados em config-roles (staff_role/supervisor_role/
// event_role) — "maior cargo no discord" (pedido do dono). Não existe
// conceito de cargo/rank EM JOGO nos dados do PoT hoje, então usa sempre a
// posição real do cargo mais alto no servidor. staffRoleIds é opcional
// (getServerPulse já calcula o Set uma vez pra todo o roster; quem chama
// avulso, como resolveStaffRoleLabel abaixo, deixa em branco).
function highestStaffRoleName(guildId, member, staffRoleIds) {
    if (!member) return null;
    const ids = staffRoleIds || new Set([
        ...ConfigSystem.getRoleIds(guildId, 'staff_role'),
        ...ConfigSystem.getRoleIds(guildId, 'supervisor_role'),
        ...ConfigSystem.getRoleIds(guildId, 'event_role'),
    ]);
    const memberStaffRoles = [...member.roles.cache.values()].filter(r => ids.has(r.id));
    const topRole = memberStaffRoles.sort((a, b) => b.position - a.position)[0];
    return topRole ? topRole.name : null;
}

// "Função" do staff (pedido do dono, 2026-08-07: "informe a role... alem
// do nome do maior cargo no discord") — DIFERENTE de highestStaffRoleName
// acima: aquela é o NOME LITERAL do cargo do Discord (pode ser qualquer
// coisa, ex: "Moderador Sênior"); esta é a CATEGORIA configurada em
// /config roles que a pessoa efetivamente ocupa (Moderador/Supervisor/
// Equipe de Eventos) — mostra TODAS que ela tiver, já que alguém pode
// acumular mais de uma (ex: Moderador Sênior é ao mesmo tempo Supervisor).
function staffRoleCategoryLabel(guildId, member) {
    if (!member) return '—';
    const parts = [];
    if (ConfigSystem.memberHasConfiguredRole(guildId, member, 'staff_role')) parts.push('Moderador');
    if (ConfigSystem.memberHasConfiguredRole(guildId, member, 'supervisor_role')) parts.push('Supervisor');
    if (ConfigSystem.memberHasConfiguredRole(guildId, member, 'event_role')) parts.push('Equipe de Eventos');
    return parts.length > 0 ? parts.join(' + ') : '—';
}

// Status EM JOGO (online/espectador/jogando + dinossauro + duração) de UM
// staff a partir da linha crua de pot_players + se tem sessão aberta em
// pot_spectator_sessions — extraído de getServerPulse pra ser reaproveitado
// também por GET /staff-perfil/:guildID/:userId (mesma regra, uma fonte só
// de verdade). Recebe os dados já buscados (não faz query sozinha) porque
// getServerPulse busca em lote pro roster inteiro (1 query de espectadores
// pra todo mundo, não 1 por pessoa) — só quem chama decide como buscar.
function computeGameStatus({ online, spectating, dinosaurType, sessionStartedAt }) {
    // "Jogando" (dono, 2026-07-20): online e fora do modo espectador —
    // definição simples, mesma usada tanto no rótulo por staff quanto no
    // total do donut (uma única fonte de verdade, sem os dois discordarem).
    const playing = online && !spectating;
    return {
        online,
        moderating: spectating,
        playing,
        // Texto literal do card (pedido do dono: "Online ou Offline ou
        // Espectador") — a cor da borda continua só 2 estados (verde/
        // vermelho, ver ingame-pulse.ejs), pois "Espectador" ainda é
        // online (só uma sub-condição dele).
        statusLabel: spectating ? 'Espectador' : (online ? 'Online' : 'Offline'),
        // Duração da sessão atual (pedido do dono, 2026-08-07: "se online
        // mostre a quanto tempo esta online") — mesmo formatDuration já
        // usado por /staffonline (presença do Discord), reaproveitado aqui
        // pra sessão EM JOGO (session_started_at, ver potPlayerRegistry.js
        // upsertPlayerFromEvent — marcado no PlayerLogin, limpo no logout).
        onlineSince: (online && sessionStartedAt) ? StaffPresenceSystem.formatDuration(Date.now() - sessionStartedAt) : null,
        // Dinossauro jogando agora (pedido do dono: "se não estiver no modo
        // espectador fale o dinossauro que esta jogando") — só faz sentido
        // fora do modo espectador (quem está espectando não está "jogando"
        // um dinossauro).
        dinosaurType: playing ? (dinosaurType || null) : null,
    };
}

// "Pulso" do servidor (jogadores/staff online agora) — reaproveitado pelas
// páginas de Moderação, Reports e Events (o Figma repete a mesma seção "IN
// GAME"/"STAFF ONLINE" nelas). Staff "online"/"offline" aqui é status EM
// JOGO (via pot_players.is_online, alimentado pelo webhook de login do PoT),
// não presença do Discord — o bot não tem a intent GuildPresences habilitada,
// e o dono confirmou que o sentido real dessa seção é status em jogo mesmo.
//
// `category` (pedido do dono, 2026-08-07: "na pagina de moderação mostre
// apenas os staffs configurados para moderação e na de eventos apenas os
// de eventos" — antes o MESMO roster com os 3 cargos combinados aparecia
// nas 2 páginas) — 'moderacao' filtra pra staff_role+supervisor_role
// (Supervisor conta como Moderador aqui também, mesmo raciocínio da seção
// 124), 'eventos' filtra só event_role. Sem category (ex: reports.ejs, que
// nem mostra o roster — showRoster:false) cai no comportamento antigo (os
// 3 cargos juntos), preservado só por compatibilidade.
async function getServerPulse(guildId, guild, category) {
    const staffRoleIds = new Set(
        category === 'moderacao' ? [
            ...ConfigSystem.getRoleIds(guildId, 'staff_role'),
            ...ConfigSystem.getRoleIds(guildId, 'supervisor_role'),
        ] : category === 'eventos' ? [
            ...ConfigSystem.getRoleIds(guildId, 'event_role'),
        ] : [
            ...ConfigSystem.getRoleIds(guildId, 'staff_role'),
            ...ConfigSystem.getRoleIds(guildId, 'supervisor_role'),
            ...ConfigSystem.getRoleIds(guildId, 'event_role'),
        ]
    );

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
        const link = db.prepare('SELECT alderon_id, player_name FROM player_links WHERE user_id = ?').get(m.id);
        // Status em jogo — fonte única (PlayerRegistry.getPlayerGameStatus,
        // pedido do dono 2026-08-11), antes uma query SQL escrita na mão
        // aqui, em /staffonline e na rota de perfil de staff avulso.
        const gameStatusRow = link ? PlayerRegistry.getPlayerGameStatus(guildId, link.alderon_id) : null;
        const online = !!gameStatusRow?.isOnline;
        const spectating = online && !!link && spectatingAlderonIds.has(link.alderon_id);
        const gameStatus = computeGameStatus({
            online,
            spectating,
            dinosaurType: gameStatusRow?.dinosaurType,
            sessionStartedAt: gameStatusRow?.sessionStartedAt,
        });

        return {
            id: m.id,
            name: m.nickname || m.user.username,
            cargo: highestStaffRoleName(guildId, m, staffRoleIds) || '—',
            roleLabel: staffRoleCategoryLabel(guildId, m),
            // ID em jogo (pedido do dono: "informe... o ID deles em jogo")
            // — null quando o staff nunca rodou /registrar; o template
            // mostra "Não vinculado" nesse caso.
            alderonId: link?.alderon_id || null,
            profileUrl: `/staff-perfil/${guildId}/${m.id}`,
            ...gameStatus,
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

// "(Cargo)" ao lado de qualquer usuário mencionado num report — pedido do
// dono: sempre informar se é staff ou não, validado pelos cargos
// configurados em config-roles (não qualquer cargo do Discord), mostrando
// o maior cargo dele (mesmo conceito de highestStaffRoleName/getServerPulse
// acima). Cache-only de propósito, mesmo motivo de resolveUserDisplayName —
// sem fetch por usuário numa lista com dezenas de linhas. Staff quase
// sempre já está em cache (interage com o bot via comandos); se não
// estiver, cai em "Não é staff" — mesmo risco aceito já documentado ali.
function resolveStaffRoleLabel(client, guildId, userId) {
    if (!userId) return null;
    const guild = client.guilds.cache.get(guildId);
    const member = guild?.members.cache.get(userId);
    return highestStaffRoleName(guildId, member) || 'Não é staff';
}

// Cargo(s) de staff configurado(s) (/config roles) do usuário logado, em
// QUALQUER servidor onde o bot o vê como membro — pedido do dono,
// 2026-08-07: "quando um usuário tiver o cargo staff configurado no
// discord, adicionar esse cargo ao perfil dele no site". GLOBAL como o
// resto do /perfil (mesmo espírito de getPlayedGuilds acima), reaproveita
// highestStaffRoleName/staffRoleCategoryLabel já definidas nesta mesma
// função — cache-only de propósito, mesmo critério já usado por
// resolveStaffRoleLabel logo acima: iterar E buscar (fetch) o membro em
// TODO servidor que o bot atende seria lento/bateria em rate limit à toa
// num carregamento de página; se o membro não estiver em cache nalgum
// servidor onde na verdade é staff, essa entrada simplesmente não aparece
// (mesmo risco aceito já documentado ali).
function getStaffRoles(userId, client) {
    const roles = [];
    for (const guild of client.guilds.cache.values()) {
        const member = guild.members.cache.get(userId);
        if (!member) continue;
        const category = staffRoleCategoryLabel(guild.id, member);
        if (category === '—') continue;
        roles.push({
            guildId: guild.id,
            guildName: guild.name,
            guildIconUrl: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
            category,
            roleName: highestStaffRoleName(guild.id, member),
        });
    }
    return roles;
}

// Histórico de Staff no /perfil web (pedido do dono, 2026-08-10: "Adicionar
// histórico de staff no perfil de staffs... no comando do discord e no
// site") — self-view sempre (web /perfil não tem como ver o de outra
// pessoa), então não precisa do gate de "quem pode ver" que o Discord
// precisa (lá dá pra ver o perfil de qualquer um). Servidores elegíveis são
// os mesmos de getStaffRoles, MAS filtrados por memberHasModOrEventRole
// (Moderador OU Equipe de Eventos) — Supervisor puro fica de fora, mesma
// regra já usada em /historico staff (análises não cobrem Supervisor).
// Dado já é apagado sozinho ao perder todos os cargos de staff
// (AnalyticsSystem.purgeStaffOnRoleLoss) — nada a checar aqui além de ler.
function getStaffHistoryForProfile(userId, client) {
    const AnalyticsSystem = require('./src/systems/moderation/analyticsSystem');
    const entries = [];
    for (const guild of client.guilds.cache.values()) {
        const member = guild.members.cache.get(userId);
        if (!member || !ConfigSystem.memberHasModOrEventRole(guild.id, member)) continue;
        const totals = AnalyticsSystem.getStaffHistoryTotals(guild.id, userId);
        const today = AnalyticsSystem.getStaffTodayStats(guild.id, userId);
        entries.push({
            guildId: guild.id,
            guildName: guild.name,
            guildIconUrl: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
            category: staffRoleCategoryLabel(guild.id, member),
            totals,
            today,
        });
    }
    return entries;
}

// Pedido do dono: "reports pode virar uma lista enorme no futuro" — cada
// seção (abertos/fechados) pagina em REPORTS_PAGE_SIZE (10) e aceita busca
// por report_id (ex: "R123"/"123", bate por substring no '#R'||report_number
// gerado) ou pelo nome de usuário de quem ABRIU o report (via tabela
// `users`, mantida atualizada pelo ensureUser em toda interação — quem abre
// um report necessariamente já interagiu com o bot). Filtro/paginação
// direto no SQL (LIMIT/OFFSET), não em JS, pra escalar mesmo com muitos
// reports — nunca carrega a tabela inteira só pra filtrar.
const REPORTS_PAGE_SIZE = 10;

function queryReportsSection(guildId, statusSql, orderBySql, search, rawPage) {
    let where = `guild_id = ? AND ${statusSql}`;
    const params = [guildId];
    if (search) {
        where += ` AND (report_id LIKE ? OR user_id IN (SELECT user_id FROM users WHERE username LIKE ?))`;
        const like = `%${search}%`;
        params.push(like, like);
    }
    const total = db.prepare(`SELECT COUNT(*) c FROM reports WHERE ${where}`).get(...params).c;
    const totalPages = Math.max(1, Math.ceil(total / REPORTS_PAGE_SIZE));
    const page = Math.min(Math.max(1, rawPage), totalPages);
    const offset = (page - 1) * REPORTS_PAGE_SIZE;
    const rows = db.prepare(
        `SELECT * FROM reports WHERE ${where} ORDER BY ${orderBySql} LIMIT ? OFFSET ?`
    ).all(...params, REPORTS_PAGE_SIZE, offset);
    return { rows, total, totalPages, page, search };
}

// Estado de paginação/busca lido da query string (?openPage=&openSearch=&
// closedPage=&closedSearch=) — usado tanto por GET /reports/:guildID
// quanto por GET /fragments/reports-list/:guildID, pra manter as 2 seções
// independentes entre si e sobreviver ao poll em tempo real (ver
// buildReportsQueryString abaixo).
function parseReportsQueryState(query) {
    const toPage = (v) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) && n > 0 ? n : 1;
    };
    return {
        openPage: toPage(query.openPage),
        openSearch: (query.openSearch || '').toString().trim(),
        closedPage: toPage(query.closedPage),
        closedSearch: (query.closedSearch || '').toString().trim(),
    };
}

// Monta a query string a partir do estado JÁ RESOLVIDO (página clampada,
// busca já aplicada) — usado pra montar a URL do fragment de poll, que
// precisa continuar buscando a MESMA página/busca a cada refresh de 15s
// (ver reports.ejs data-poll-url), não resetar pro padrão a cada poll.
function buildReportsQueryString({ openPage, openSearch, closedPage, closedSearch }) {
    const params = new URLSearchParams();
    if (openPage > 1) params.set('openPage', openPage);
    if (openSearch) params.set('openSearch', openSearch);
    if (closedPage > 1) params.set('closedPage', closedPage);
    if (closedSearch) params.set('closedSearch', closedSearch);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}

// getReportsData abaixo: reaproveitada pelo carregamento normal de
// /reports/:guildID e pelo fragment de poll (GET
// /fragments/reports-list/:guildID). Precisa do client pra resolver nome
// do Discord de quem abriu/fechou/apagou o tópico (ver
// resolveUserDisplayName acima) — pedido do dono: a lista não mostrava
// nem o nome do Discord nem o nome em jogo do jogador antes disso.
function getReportsData(guildId, client, state) {
    const enrich = (row) => {
        const link = db.prepare('SELECT alderon_id, player_name FROM player_links WHERE user_id = ?').get(row.user_id);
        return {
            ...row,
            agid: link?.alderon_id || null,
            playerName: link?.player_name || null,
            discordUsername: resolveUserDisplayName(client, row.user_id),
            discordRoleLabel: resolveStaffRoleLabel(client, guildId, row.user_id),
            closedByName: row.closed_by ? resolveUserDisplayName(client, row.closed_by) : null,
            closedByRoleLabel: row.closed_by ? resolveStaffRoleLabel(client, guildId, row.closed_by) : null,
            threadDeletedByName: row.thread_deleted_by ? resolveUserDisplayName(client, row.thread_deleted_by) : null,
            threadDeletedByRoleLabel: row.thread_deleted_by ? resolveStaffRoleLabel(client, guildId, row.thread_deleted_by) : null,
            statusLabel: REPORT_STATUS_LABELS[row.status] || row.status,
        };
    };

    const open = queryReportsSection(guildId, "status NOT LIKE 'closed%'", 'created_at DESC', state.openSearch, state.openPage);
    const closed = queryReportsSection(guildId, "status LIKE 'closed%'", 'closed_at DESC', state.closedSearch, state.closedPage);

    return {
        openReports: open.rows.map(enrich),
        openPagination: { page: open.page, totalPages: open.totalPages, total: open.total, search: open.search },
        closedReports: closed.rows.map(enrich),
        closedPagination: { page: closed.page, totalPages: closed.totalPages, total: closed.total, search: closed.search },
    };
}

// "Suas Denúncias" (perfil-denuncias.ejs, pedido do dono 2026-08-05) —
// mesma ideia de queryReportsSection/getReportsData acima, só que filtra
// por QUEM ABRIU o report (user_id, indexado via idx_reports_user) em vez
// de por servidor — global, sem guild_id nenhum no WHERE, então pode
// devolver reports de vários servidores diferentes misturados na mesma
// lista. Funções PRÓPRIAS (não reaproveita queryReportsSection/
// getReportsData direto) porque cada linha aqui pode ser de um servidor
// diferente — discordRoleLabel/closedByRoleLabel/threadDeletedByRoleLabel
// precisam resolver o cargo de staff usando o guild_id DA PRÓPRIA LINHA
// (row.guild_id), não um guildId único passado de fora como em
// getReportsData. guildName (nome do servidor, pro selo por card — ver
// showGuildBadge em partials/reports-list.ejs) só existe aqui.
function queryUserReportsSection(userId, statusSql, orderBySql, search, rawPage) {
    let where = `user_id = ? AND ${statusSql}`;
    const params = [userId];
    if (search) {
        where += ` AND report_id LIKE ?`;
        params.push(`%${search}%`);
    }
    const total = db.prepare(`SELECT COUNT(*) c FROM reports WHERE ${where}`).get(...params).c;
    const totalPages = Math.max(1, Math.ceil(total / REPORTS_PAGE_SIZE));
    const page = Math.min(Math.max(1, rawPage), totalPages);
    const offset = (page - 1) * REPORTS_PAGE_SIZE;
    const rows = db.prepare(
        `SELECT * FROM reports WHERE ${where} ORDER BY ${orderBySql} LIMIT ? OFFSET ?`
    ).all(...params, REPORTS_PAGE_SIZE, offset);
    return { rows, total, totalPages, page, search };
}

function getUserReportsData(userId, client, state) {
    const enrich = (row) => {
        const link = db.prepare('SELECT alderon_id, player_name FROM player_links WHERE user_id = ?').get(row.user_id);
        const guild = client.guilds.cache.get(row.guild_id);
        return {
            ...row,
            agid: link?.alderon_id || null,
            playerName: link?.player_name || null,
            discordUsername: resolveUserDisplayName(client, row.user_id),
            discordRoleLabel: resolveStaffRoleLabel(client, row.guild_id, row.user_id),
            closedByName: row.closed_by ? resolveUserDisplayName(client, row.closed_by) : null,
            closedByRoleLabel: row.closed_by ? resolveStaffRoleLabel(client, row.guild_id, row.closed_by) : null,
            threadDeletedByName: row.thread_deleted_by ? resolveUserDisplayName(client, row.thread_deleted_by) : null,
            threadDeletedByRoleLabel: row.thread_deleted_by ? resolveStaffRoleLabel(client, row.guild_id, row.thread_deleted_by) : null,
            statusLabel: REPORT_STATUS_LABELS[row.status] || row.status,
            guildName: guild?.name || 'Servidor desconhecido',
            // Logo do servidor por linha (pedido do dono, 2026-08-06:
            // "adicione apenas na lista a logo do servidor... com o nome
            // do servidor") — mesmo padrão de URL de ícone usado em
            // getPlayedGuilds/index.ejs; null quando o servidor não tem
            // ícone (cai no fallback genérico do template).
            guildIconUrl: guild?.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
        };
    };

    const open = queryUserReportsSection(userId, "status NOT LIKE 'closed%'", 'created_at DESC', state.openSearch, state.openPage);
    const closed = queryUserReportsSection(userId, "status LIKE 'closed%'", 'closed_at DESC', state.closedSearch, state.closedPage);

    return {
        openReports: open.rows.map(enrich),
        openPagination: { page: open.page, totalPages: open.totalPages, total: open.total, search: open.search },
        closedReports: closed.rows.map(enrich),
        closedPagination: { page: closed.page, totalPages: closed.totalPages, total: closed.total, search: closed.search },
    };
}

// "Histórico do jogador" no /perfil (pedido do dono, 2026-08-07: "Adicione
// ao perfil um botão de histórico do jogador puxando o histórico de
// reputação e punição") — GLOBAL como "Suas Denúncias" acima (mesmo
// espírito de self-view sem plateia): junta reputação + punições de
// QUALQUER servidor onde o usuário tem registro, tudo numa página só, sem
// precisar de um seletor de servidor como o Conversor de Moedas (aqui é só
// leitura de banco, não RCON contra um servidor específico). Reputação
// respeita o gate de tier por servidor (reputationEnabled — mesma regra
// aplicada por linha que o /historico do Discord usa em
// punishmentSystem.js#generateHistoryContainer) porque é um RECURSO
// premium; punições NUNCA são escondidas por tier — são registro de
// auditoria, ver a regra "Favorecer economia de espaço para dados
// derivados" no CLAUDE.md, que explicitamente NÃO se aplica a
// punishments/reports.
function getPlayerHistoryData(userId, client) {
    const guildIds = db.prepare(`
        SELECT DISTINCT guild_id FROM punishments WHERE user_id = ?
        UNION
        SELECT DISTINCT guild_id FROM reputation WHERE user_id = ?
    `).all(userId, userId).map((row) => row.guild_id);

    const reputationByGuild = guildIds.map((guildId) => {
        const rep = db.prepare('SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
        if (!rep) return null;
        const guild = client.guilds.cache.get(guildId);
        return {
            guildId,
            guildName: guild?.name || 'Servidor desconhecido',
            guildIconUrl: guild?.icon ? `https://cdn.discordapp.com/icons/${guildId}/${guild.icon}.png` : null,
            points: rep.points,
            reputationEnabled: PremiumSystem.getGuildLimits(guildId).reputationEnabled,
        };
    }).filter(Boolean).sort((a, b) => a.guildName.localeCompare(b.guildName));

    const punishments = db.prepare(
        `SELECT * FROM punishments WHERE user_id = ? ORDER BY created_at DESC`
    ).all(userId).map((p) => {
        const guild = client.guilds.cache.get(p.guild_id);
        return {
            ...p,
            guildName: guild?.name || 'Servidor desconhecido',
            guildIconUrl: guild?.icon ? `https://cdn.discordapp.com/icons/${p.guild_id}/${guild.icon}.png` : null,
            moderatorName: resolveUserDisplayName(client, p.moderator_id),
        };
    });

    return { reputationByGuild, punishments };
}

// Mesmo ID hardcoded em todo comando de developer (ver src/commands/developer/*.js)
// — usado aqui pra liberar o preview de região (BR/internacional) da
// landing page pro dono logado (GET /) e, agora, pra travar o dashboard
// só pro dono enquanto ele está em desenvolvimento (ver
// DASHBOARD_LOCKED_TO_OWNER abaixo).
const DEVELOPER_ID = '203676076189286412';

// Trava temporária (pedido do dono, 2026-08-02) DESATIVADA em 2026-08-07
// ("Para administradores dos servidores libere a visualização e uso do
// dashboard" / "sendo as informações sobre o server apenas para staffs e
// adms do servidor, e o perfil para qualquer usuário") — auditado antes
// de desligar: as 14 rotas por servidor (moderação/reports/eventos, GET
// e POST/save, mais os 3 fragments de poll) já checavam
// resolveAdminMember/isStaff/isAdmin de verdade, independente desta
// trava — ela só bloqueava TODO MUNDO além do dono por cima disso, sem
// motivo funcional depois desta revisão. As 8 rotas globais (/perfil e
// afins, /loja e afins) ficam abertas pra qualquer usuário autenticado,
// como pedido — nunca dependeram de permissão de servidor nenhuma.
// /dev/Loja continua exclusivo do dono (isOwnerSession própria, nunca
// dependeu desta constante). Deixada como `false` (não removida)
// pra poder travar de novo rápido se precisar, sem reescrever nada.
const DASHBOARD_LOCKED_TO_OWNER = false;

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

    // Servidores que o usuário pode ACESSAR (Administrador OU algum cargo de
    // equipe configurado, ver ConfigSystem.memberHasAnyStaffRole/isStaff em
    // resolveAdminMember) E onde o bot já está — mesmo filtro usado em
    // /dashboard (ver rota abaixo), reaproveitado pelo seletor de servidor
    // no ícone do page-header (troca de servidor sem precisar voltar pro
    // /dashboard) nas páginas de Moderação/Reports/Eventos.
    //
    // Precisou virar async (pedido do dono, 2026-08-06): o bitfield de
    // `permissions` que o OAuth2 do Discord devolve em req.user.guilds só
    // tem PERMISSÕES gerais do usuário, não diz nada sobre CARGO nenhum —
    // pra saber se ele tem um dos 3 cargos de equipe configurados
    // (staff_role/supervisor_role/event_role) é preciso buscar o
    // GuildMember de verdade. Custo fica baixo na prática: só busca pros
    // poucos servidores onde o bot roda (client.guilds.cache) E que o
    // próprio Discord já confirma que o usuário está (req.user.guilds),
    // nunca todo servidor do Discord do usuário.
    async function getAdminGuildsWithBot(req) {
        if (!req.user || !req.user.guilds) return [];
        const userGuildIds = new Set(req.user.guilds.map(g => g.id));
        const candidates = [...client.guilds.cache.values()].filter(g => userGuildIds.has(g.id));

        const resolved = await Promise.all(candidates.map(async (guild) => {
            try {
                const member = await guild.members.fetch(req.user.id);
                const hasAccess = ConfigSystem.memberIsGuildAdmin(guild.id, member) || ConfigSystem.memberHasAnyStaffRole(guild.id, member);
                return hasAccess ? { id: guild.id, name: guild.name, icon: guild.icon } : null;
            } catch (err) {
                return null;
            }
        }));
        return resolved.filter(Boolean);
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

    // Busca o GuildMember + checa Administrator, DISTINGUINDO falha da API
    // (fetch() rejeitou — timeout, 5xx, rate limit) de "realmente não é
    // admin" (fetch funcionou, member existe, só não tem a permissão). Toda
    // rota de guild fazia guild.members.fetch(...).catch(() => null) e
    // tratava os dois casos IDENTICAMENTE como "sem permissão" — um admin
    // de verdade podia ser bounceado/bloqueado silenciosamente por um erro
    // passageiro da API do Discord, sem nenhuma pista do motivo real (nem
    // no log do servidor). Cada rota decide sozinha a resposta em cima de
    // apiError (mensagem diferente de "acesso negado"), mas todas passam a
    // logar o erro de verdade em vez de engolir com .catch(() => null).
    //
    // isStaff (pedido do dono, 2026-08-06: "cargos adicionados em permissões
    // de equipes podem visualizar todo o dashboard") — Moderador/Supervisor/
    // Equipe de Eventos (ConfigSystem.STAFF_ROLE_KEYS, os mesmos 3 cargos já
    // usados em toda checagem de "é staff" do bot, ver highestStaffRoleName
    // acima) ganham acesso de VISUALIZAÇÃO ao dashboard deste servidor.
    // Administrator continua sendo quem EDITA — rotas de GET/fragments
    // passam a checar isStaff, rotas de POST (salvar configuração) seguem
    // checando isAdmin, sem nenhuma mudança nelas.
    async function resolveAdminMember(guild, userId) {
        try {
            const member = await guild.members.fetch(userId);
            // memberIsGuildAdmin (ver configSystem.js) = Administrator nativo
            // do Discord OU o cargo Administrativo do Dashboard configurado
            // na página "Game Server" (pedido do dono, 2026-08-11: cargo que
            // "vai ser permitido alterar qualquer configuração no dashboard...
            // sem necessariamente ter o admin no discord"). Ponto ÚNICO onde
            // isso entra no dashboard — toda rota de POST/edição já usa
            // isAdmin daqui, então o bypass vale pra Moderação/Reports/
            // Eventos/Game Server automaticamente, sem tocar em cada rota.
            const isAdmin = ConfigSystem.memberIsGuildAdmin(guild.id, member);
            const isStaff = isAdmin || ConfigSystem.memberHasAnyStaffRole(guild.id, member);
            return { member, isAdmin, isStaff, apiError: null };
        } catch (apiError) {
            return { member: null, isAdmin: false, isStaff: false, apiError };
        }
    }

    // Middleware para injetar dados globais em todos os templates EJS
    app.use((req, res, next) => {
        res.locals.user = req.user || null;
        res.locals.bot = client;
        // isOwner global (pedido do dono, 2026-08-13: barra de navegação
        // de topo ganha um item "Controle de Lojas" visível só pro dono,
        // em TODA página) — antes disso cada rota tinha que lembrar de
        // passar isOwner: isOwnerSession(req) manualmente pro
        // res.render(), e pelo menos 2 (portal.ejs/termos.ejs) nunca
        // passavam. Locals explícitos de res.render() sempre vencem
        // res.locals em conflito, então rotas que já passam isOwner
        // continuam com o valor idêntico — isto só preenche a lacuna nas
        // que não passavam. DEVELOPER_ID já é constante de módulo
        // (declarada antes deste middleware) — calculado direto aqui em
        // vez de chamar isOwnerSession(req) (só declarada mais abaixo,
        // dentro de loadDashboard) pra não depender de ordem nenhuma.
        res.locals.isOwner = !!(req.user && req.user.id === DEVELOPER_ID);
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

    app.get('/', async (req, res) => {
        const country = req.headers['cf-ipcountry'] || 'BR';
        const detectedIsBrazil = country.toUpperCase() === 'BR';
        const isOwner = isOwnerSession(req);
        const regionOverride = isOwner && ['intl', 'br'].includes(req.query.preview_region) ? req.query.preview_region : null;
        const isBrazil = regionOverride ? regionOverride === 'br' : detectedIsBrazil;

        // Novidades (pedido do dono, 2026-08-06: "migrar pra página home") —
        // migrado de GET /perfil pra cá; público, sem checkAuth, já que a
        // home é vista por visitante deslogado também (ver
        // getPartnerNews/GeneralNewsSystem, definidos mais abaixo — chamar
        // uma function declaration antes da definição textual funciona
        // normal em JS, hoisting).
        const generalNews = await GeneralNewsSystem.getGeneralNews();
        const partnerNews = await getPartnerNews(client);

        // Números da home (pedido do dono, 2026-08-10: "Adicionar numero de
        // players registrados e servidores que usam o bot na pagina
        // inicial") — jogadores = player_links inteira (1 linha por
        // vínculo /registrar, é GLOBAL, não por servidor); servidores =
        // client.guilds.cache.size (contagem ao vivo, não precisa de
        // query — o bot já sabe em quantos servidores está).
        const registeredPlayersCount = db.prepare('SELECT COUNT(*) c FROM player_links').get().c;
        const serversCount = client.guilds.cache.size;

        res.render('hero', { isBrazil, isOwner, regionOverride, generalNews, partnerNews, registeredPlayersCount, serversCount, assetVersion: ASSET_VERSION });
    });

    // Termos de Serviço e Política de Privacidade — parseados direto de
    // TERMOS_DE_SERVICO.txt (raiz do repo) a cada request; documento é
    // pequeno e a página é pouco acessada, não vale a pena cachear e
    // arriscar servir uma versão desatualizada depois de uma edição.
    app.get('/termos', (req, res) => {
        res.render('termos', loadTermosBilingual());
    });

    // Documentação pública de todos os comandos do bot (pedido do dono,
    // 2026-08-03: "criar nossa página de documentação... mostrando a
    // melhor forma de usar o bot atualmente") — sem login, mesmo padrão
    // de / (hero) e /termos. Conteúdo é estático (hardcoded em
    // documentacao.ejs), não gerado a partir dos comandos reais — ver
    // docblock no topo da view.
    app.get('/documentacao', (req, res) => {
        res.render('documentacao', { isOwner: isOwnerSession(req) });
    });

    // ==================== TODAS AS LOJAS (só o dono) ====================
    // Substitui a antiga /dev/image-pool (reforma das lojas, pedido do dono
    // 2026-08-12: "Controle da loja que é um acesso só do desenvolvedor,
    // deve ser um painel de configuração completa de todas as lojas...
    // preciso de todos os controles de configuração possiveis de todos os
    // items, e catalogo de preços de todos os servidores"). Página GLOBAL,
    // sem :guildID — junta: (1) links pra Loja de Jogo de CADA servidor
    // onde o bot está (a mesma página /lojajogo/:guildId do admin, com
    // bypass de dono já implementado lá — dá suporte em qualquer servidor
    // mesmo sem ser membro), (2) pool de Personalização/Banner/Emblema/
    // Título, (3) fila de aprovação do marketplace de imagem de jogador,
    // (4) requisito de resgate de emblema/título, (5) config global da
    // Loja de Personalização (taxa de envio). isOwnerSession (não
    // isDashboardLocked) é o gate certo aqui — fica restrito ao dono pra
    // sempre, mesmo depois do resto do dashboard abrir pra outros admins.
    const IMAGE_POOL_TYPES = [
        { type: 'personalizacao', label: 'Foto de Perfil / Plano de Fundo' },
        { type: 'banner', label: 'Banner (Personalização)' },
        // Único tipo texto (sem imagem) do pool — ver o comentário no topo de
        // profileImagePool.js. A view trata esse type com um form de texto
        // simples em vez do form de upload, e o card mostra o texto do
        // título no lugar da thumbnail (não há imagem pra resolver).
        { type: 'titulo', label: 'Título de Perfil' },
    ];
    // Badge fica FORA de IMAGE_POOL_TYPES de propósito — não usa mais
    // preço (setShopConfig só aceita 'personalizacao' agora), usa o
    // editor de requisito próprio (ver bloco separado na view).

    app.get('/dev/Loja', checkAuth, async (req, res) => {
        if (!isOwnerSession(req)) return res.status(403).send('Acesso restrito ao desenvolvedor do bot.');

        const groups = await Promise.all(IMAGE_POOL_TYPES.map(async ({ type, label }) => {
            const rows = ProfileImagePool.listImages(type).filter(r => !r.pending_review);
            const images = await Promise.all(rows.map(async row => ({
                ...row,
                url: await ProfileImagePool.resolveImageUrl(client, type, row.id),
                // requirement/requirementLabel só têm efeito real pra
                // 'titulo' (o outro tipo com resgate por requisito, ver
                // partials/requirement-form.ejs — personalizacao/banner
                // nunca gravam essa coluna, então ficam sempre null aqui,
                // sem custo/risco nenhum de calcular do mesmo jeito pra
                // manter os 3 tipos consistentes nesta mesma lista).
                requirement: AchievementSystem.parseRequirement(row),
                requirementLabel: AchievementSystem.describeRequirement(AchievementSystem.parseRequirement(row)),
            })));
            return { type, label, images };
        }));

        const badgeRows = ProfileImagePool.listImages('badge').filter(r => !r.pending_review);
        const badges = await Promise.all(badgeRows.map(async row => ({
            ...row,
            url: await ProfileImagePool.resolveImageUrl(client, 'badge', row.id),
            requirement: AchievementSystem.parseRequirement(row),
            requirementLabel: AchievementSystem.describeRequirement(AchievementSystem.parseRequirement(row)),
        })));

        const pendingRows = ProfileImagePool.getPendingSubmissions();
        const pendingSubmissions = await Promise.all(pendingRows.map(async row => ({
            ...row,
            url: await ProfileImagePool.resolveImageUrl(client, row.type, row.id),
            submitterName: resolveUserDisplayName(client, row.submitted_by),
        })));

        const allGuilds = [...client.guilds.cache.values()]
            .map(g => ({ id: g.id, name: g.name, iconURL: g.iconURL({ size: 64 }) }))
            .sort((a, b) => a.name.localeCompare(b.name));

        res.render('dev-lojas', {
            isOwner: true,
            groups,
            badges,
            pendingSubmissions,
            allGuilds,
            requirementTypes: AchievementSystem.REQUIREMENT_TYPES,
            personalizationConfig: ImageShopSystem.getPersonalizationShopConfig(),
            saved: req.query.saved,
        });
    });

    app.post('/dev/Loja/:type/:id/toggle', checkAuth, async (req, res) => {
        if (!isOwnerSession(req)) return res.status(403).send('Acesso restrito ao desenvolvedor do bot.');
        const { type } = req.params;
        const id = Number(req.params.id);
        const row = ProfileImagePool.getByTypeAndId(type, id);
        if (row) ProfileImagePool.setPublic(type, id, !row.is_public);
        res.redirect('/dev/Loja');
    });

    // Precifica um item do pool pra Loja de Caçadas — só 'personalizacao'
    // (badge/titulo usam requisito, não preço, ver rota /requisito abaixo
    // — ImageShopSystem.setShopConfig já recusa qualquer outro tipo).
    // Mandar preco 0/vazio remove da loja (o item continua no pool, só
    // deixa de ser comprável) — ver ImageShopSystem.setShopConfig.
    app.post('/dev/Loja/:type/:id/preco', checkAuth, async (req, res) => {
        if (!isOwnerSession(req)) return res.status(403).send('Acesso restrito ao desenvolvedor do bot.');
        const { type } = req.params;
        const id = Number(req.params.id);
        const ok = ImageShopSystem.setShopConfig(type, id, {
            price: Number(req.body.preco),
            minTier: req.body.tier_minimo,
        });
        res.redirect(`/dev/Loja?saved=${ok ? 'success' : 'error'}`);
    });

    // Define (ou limpa, se nenhuma linha vier preenchida) a LISTA de
    // requisitos de resgate automático de um emblema/título — ver
    // AchievementSystem. Virou lista (pedido do dono, 2026-08-13:
    // "preciso que ele adicione os requisitos como uma lista onde o
    // player só consiga reivindicar se fez todos os requisitos") — o
    // form (partials/requirement-form.ejs) manda N linhas via campos
    // repetidos com colchete (requirement_type[] etc.), que
    // express.urlencoded({extended:true}) (já configurado, usa `qs`)
    // devolve como array mesmo com 1 ocorrência só; normalizado pra
    // array de qualquer forma abaixo por segurança, sem depender disso.
    app.post('/dev/Loja/:type/:id/requisito', checkAuth, async (req, res) => {
        if (!isOwnerSession(req)) return res.status(403).send('Acesso restrito ao desenvolvedor do bot.');
        const { type } = req.params;
        const id = Number(req.params.id);
        const types = [].concat(req.body.requirement_type || []);
        const values = [].concat(req.body.requirement_value || []);
        const speciesList = [].concat(req.body.requirement_species || []);

        // Teto defensivo (não pedido explicitamente, mas evita spam de
        // linhas) — mesmo valor no form (ver requirement-form.ejs), que
        // já desabilita o botão "+ Adicionar" antes de chegar aqui.
        const MAX_REQUIREMENTS = 5;
        const requirements = [];
        for (let i = 0; i < Math.min(types.length, MAX_REQUIREMENTS); i++) {
            const reqType = types[i];
            // Linha adicionada mas deixada em branco (tipo "Nenhum") —
            // ignora silenciosamente, não bloqueia salvar as outras.
            if (!reqType) continue;
            const value = Number(values[i]);
            const def = AchievementSystem.REQUIREMENT_TYPES[reqType];
            const species = (speciesList[i] || '').trim();
            // Linha PREENCHIDA mas inválida (tipo desconhecido, valor
            // fora do range, ou espécie faltando quando o tipo exige)
            // cancela o save inteiro — mesmo comportamento de quando só
            // existia 1 requisito, nunca salva pela metade.
            if (!def || !Number.isFinite(value) || value <= 0 || (def.needsSpecies && !species)) {
                return res.redirect('/dev/Loja?saved=error');
            }
            requirements.push({ type: reqType, value, ...(species ? { species } : {}) });
        }
        const ok = ProfileImagePool.setRequirement(type, id, requirements.length > 0 ? requirements : null);
        res.redirect(`/dev/Loja?saved=${ok ? 'success' : 'error'}`);
    });

    // Upload direto pelo dashboard (pedido do dono: não precisar ir no
    // Discord toda vez) — mesma receita de storeImageBuffer já usada pro
    // upload próprio de banner (POST /moderacao/:guildID/save), só que
    // gravando no pool em vez de num setting de guild específico.
    app.post(
        '/dev/Loja/:type/upload',
        checkAuth,
        safeUpload(upload.single('imagem'), '/dev/Loja?saved=error'),
        async (req, res) => {
            if (!isOwnerSession(req)) return res.status(403).send('Acesso restrito ao desenvolvedor do bot.');
            const { type } = req.params;
            if (!ProfileImagePool.VALID_TYPES.includes(type)) return res.status(400).send('Tipo de pool inválido.');

            // Antes redirecionava sem feedback nenhum em qualquer caso de
            // falha (nome vazio, sem arquivo, ou storeImageBuffer falhando
            // ao repostar no canal de armazenamento) — parecia que o
            // upload funcionou mesmo quando não funcionou. Agora usa o
            // mesmo overlay ?saved=success/error já usado em Moderação/
            // Eventos (ver partials/save-result-overlay.ejs).
            const label = (req.body.label || '').trim();
            const file = req.file;
            let ok = false;
            if (label && file) {
                const result = await storeImageBuffer(client, file.buffer, `${type} (pool) — "${label}" adicionado via dashboard por \`${req.user.username}\``);
                if (result.ok) {
                    ProfileImagePool.addImage(type, label, result.messageId, req.user.id);
                    ok = true;
                }
            }
            res.redirect(`/dev/Loja?saved=${ok ? 'success' : 'error'}`);
        }
    );

    // Adiciona uma entrada de título (type==='titulo') — único tipo do pool
    // que é texto puro, sem attachment nenhum pra subir, então tem sua
    // própria rota em vez de passar pelo upload multer acima (ver
    // profileImagePool.js pro porquê de messageId ser '' e não null).
    app.post('/dev/Loja/titulo/add', checkAuth, async (req, res) => {
        if (!isOwnerSession(req)) return res.status(403).send('Acesso restrito ao desenvolvedor do bot.');
        const text = (req.body.titulo || '').trim();
        let ok = false;
        if (text) {
            ProfileImagePool.addImage('titulo', text, '', req.user.id);
            ok = true;
        }
        res.redirect(`/dev/Loja?saved=${ok ? 'success' : 'error'}`);
    });

    // Remove de verdade (diferente do toggle, que só esconde).
    app.post('/dev/Loja/:type/:id/delete', checkAuth, async (req, res) => {
        if (!isOwnerSession(req)) return res.status(403).send('Acesso restrito ao desenvolvedor do bot.');
        const { type } = req.params;
        const id = Number(req.params.id);
        ProfileImagePool.removeImage(type, id);
        res.redirect('/dev/Loja');
    });

    // Aprova um envio pendente do marketplace de imagem de jogador — vira
    // público/comprável, com o nome de quem enviou (ver imageShopSystem.js
    // purchaseImage pro repasse de 10%/reprecificação que passam a valer
    // a partir daqui).
    app.post('/dev/Loja/pendente/:id/aprovar', checkAuth, async (req, res) => {
        if (!isOwnerSession(req)) return res.status(403).send('Acesso restrito ao desenvolvedor do bot.');
        const id = Number(req.params.id);
        const row = ProfileImagePool.approveSubmission(id);
        res.redirect(`/dev/Loja?saved=${row ? 'success' : 'error'}`);
    });

    // Reprova — devolve a taxa de envio pro jogador e apaga o item por
    // completo (pedido do dono: "removemos tudo sobre o item").
    app.post('/dev/Loja/pendente/:id/reprovar', checkAuth, async (req, res) => {
        if (!isOwnerSession(req)) return res.status(403).send('Acesso restrito ao desenvolvedor do bot.');
        const id = Number(req.params.id);
        const ok = ImageShopSystem.rejectSubmission(id);
        res.redirect(`/dev/Loja?saved=${ok ? 'success' : 'error'}`);
    });

    // Config global da Loja de Personalização — taxa de envio (Caçadas) e
    // se o marketplace está aceitando envios novos agora.
    app.post('/dev/Loja/config', checkAuth, async (req, res) => {
        if (!isOwnerSession(req)) return res.status(403).send('Acesso restrito ao desenvolvedor do bot.');
        ImageShopSystem.setPersonalizationShopConfig({
            submissionFee: Number(req.body.submission_fee),
            acceptingSubmissions: req.body.accepting_submissions === '1',
        });
        res.redirect('/dev/Loja?saved=success');
    });

    // ==================== PERFIL (do usuário logado) ====================
    // Página global (sem :guildID — identidade do jogador é global, ver
    // player_links) pro avatar da sidebar levar a algum lugar (pedido do
    // dono: "avatar vira um botão animado que leva pra página de perfil").
    // Espelha o comando /perfil-edit do Discord (ConfigSystem.
    // buildPerfilEditPanelPayload) e o /perfil (playerRegistrationSystem.
    // sendProfile) — mesmas tabelas/regras de tier, um formulário só em
    // vez do fluxo por botão+modal do Discord.

    // Resolve a URL de PRÉVIA de uma foto/plano de fundo de perfil — mesma
    // receita de resolveBannerUrl (customBannerResolver.js), mas pra
    // player_links (banner_message_id/background_message_id, upload
    // próprio do Raptor) em vez de settings de guild (upload de banner de
    // servidor) — tabelas/chaves diferentes demais pra reaproveitar aquele
    // helper sem forçar um encaixe. messageId tem prioridade (upload
    // próprio, só existe no Raptor); sem ele, cai pro pool (poolKey, Compy).
    async function resolvePlayerImageUrl(type, poolKey, messageId) {
        if (messageId) {
            const storageChannelId = process.env.BANNER_STORAGE_CHANNEL_ID;
            if (storageChannelId) {
                try {
                    const storageChannel = await client.channels.fetch(storageChannelId);
                    const storedMessage = await storageChannel.messages.fetch(messageId);
                    const url = storedMessage.attachments.first()?.url;
                    if (url) return url;
                } catch (err) {
                    // segue pro fallback do pool
                }
            }
        }
        if (poolKey && ProfileImagePool.isPoolValue(poolKey)) {
            return await ProfileImagePool.resolveImageUrl(client, type, ProfileImagePool.poolIdFromValue(poolKey));
        }
        return null;
    }

    // Mesma fórmula de formatKD (src/systems/pot/playerRegistrationSystem.js,
    // usada pelo /perfil do Discord) — função local, não exportada de lá,
    // reimplementada aqui em vez de exportar só pra isso (3 linhas).
    function formatKD(kills, deaths) {
        if (deaths > 0) return (kills / deaths).toFixed(2);
        if (kills > 0) return kills.toFixed(2);
        return '—';
    }

    // "Servidores que você já jogou" (pedido do dono, 2026-08-05) —
    // DIFERENTE da lista "servidores que você administra"
    // (getAdminGuildsWithBot, exige permissão de Administrador no Discord
    // E o bot estar lá agora): aqui é histórico de jogo, não permissão —
    // qualquer servidor com integração Path of Titans onde este alderon_id
    // já registrou atividade (pot_players, UNIQUE por guild_id+alderon_id,
    // uma linha por servidor já jogado). Pode incluir servidor onde o
    // usuário NÃO é admin (só jogou lá) e mesmo servidor que o bot já
    // deixou (histórico continua valendo) — nesse caso cai no fallback
    // salvo em `guilds` (nome/ícone do último ensureGuild, ver
    // src/database/index.js) em vez do cache ao vivo do client.
    function getPlayedGuilds(alderonId, client) {
        if (!alderonId) return [];
        const rows = db.prepare(
            `SELECT guild_id, last_seen, total_playtime, is_online, session_started_at FROM pot_players WHERE alderon_id = ? ORDER BY last_seen DESC`
        ).all(alderonId);
        return rows.map((row) => {
            const cachedGuild = client.guilds.cache.get(row.guild_id);
            const dbGuild = cachedGuild ? null : db.prepare('SELECT name, icon FROM guilds WHERE guild_id = ?').get(row.guild_id);
            const name = cachedGuild?.name || dbGuild?.name || 'Servidor desconhecido';
            const iconHash = cachedGuild?.icon || dbGuild?.icon || null;
            const iconUrl = iconHash ? `https://cdn.discordapp.com/icons/${row.guild_id}/${iconHash}.png` : null;
            // Tempo de jogo POR SERVIDOR (pedido do dono, 2026-08-10:
            // "Adicione horas jogadas naquele servidor nas informações de
            // perfil" — dado já existia calculado, só ficava escondido
            // atrás de "Em breve" nos 2 lugares, ver comentário histórico
            // mais abaixo neste arquivo/em playerRegistrationSystem.js).
            // Soma o tempo AO VIVO da sessão atual quando online agora,
            // igual getGuildPlayerStats (Discord /perfil) — mesmo número
            // nos dois lugares em vez de ficar "parado" aqui enquanto
            // jogando.
            const liveSeconds = (row.is_online && row.session_started_at)
                ? Math.max(0, Math.floor((Date.now() - row.session_started_at) / 1000))
                : 0;
            const totalPlaytime = (row.total_playtime || 0) + liveSeconds;
            return {
                guildId: row.guild_id, name, iconUrl, lastSeen: row.last_seen,
                totalPlaytime,
                playtimeLabel: totalPlaytime > 0 ? StaffPresenceSystem.formatDuration(totalPlaytime * 1000) : null,
            };
        });
    }

    // "Novidades dos Servidores Parceiros" (pedido do dono, 2026-08-05,
    // migrado pra home em 2026-08-06) — feed GLOBAL na página inicial
    // (GET /), mostrado pra QUALQUER visitante, logado ou não, não só
    // pra quem administra o servidor divulgado. Lê
    // partner_news_title/text/updated_at/image_message_id/event_id
    // (settings) via um self-join no key/value plano de `settings` — só
    // entra no feed quem tem título preenchido, o bot ainda está no
    // servidor (client.guilds.cache, mesmo critério de "possui o bot" já
    // usado em getAdminGuildsWithBot) E o servidor continua Rastreador+
    // (pedido do dono, 2026-08-06: "divulgação de servidores parceiros são
    // permitidos a partir da assinatura TRACKER" — se o servidor cair pro
    // Free depois de já ter divulgado algo, some do feed sozinho, sem
    // precisar apagar o texto salvo). A partir de 2026-08-06 (seção 113 do
    // PREMIUM.txt), quem PUBLICA é sempre o comando /divulgar (imagem
    // obrigatória, 1x por semana) — moderacao.ejs virou só uma prévia
    // somente-leitura da divulgação atual.
    //
    // image_message_id: guardado por /divulgar como mensagem no canal fixo
    // BANNER_STORAGE_CHANNEL_ID (mesma receita de custom
    // BannerResolver.resolveBannerUrl/profileImagePool.resolveImageUrl) —
    // nunca guarda a URL do attachment em si (expira em ~24h), refaz o
    // fetch a cada carregamento da home. Divulgações antigas, feitas antes
    // do /divulgar existir (só título/texto, pelo dashboard web), não têm
    // esse campo — imageUrl fica null e o card renderiza sem imagem.
    //
    // event_id: evento agendado ESCOLHIDO manualmente via /divulgar
    // (qualquer Rastreador+, opção "evento" do comando) — tem prioridade
    // sobre o bônus automático abaixo. Sem escolha manual (ou se o evento
    // escolhido já não existe/não está mais agendado), Caçador ainda ganha
    // o bônus automático de sempre (pedido do dono, 2026-08-06: "para tier
    // HUNTER, além dele poder divulgar, vamos adicionar automaticamente o
    // último evento agendado do servidor") — busca os scheduled events
    // nativos do Discord e anexa o PRÓXIMO a acontecer (Status.Scheduled,
    // menor scheduledStartTimestamp) — "último agendado" aqui é lido como
    // "o mais próximo agendado", já que mostrar um evento já ocorrido não
    // ajudaria ninguém a decidir participar. Sem evento nenhum dos dois
    // jeitos, latestEvent fica null — card mostra só a divulgação normal.
    // Núcleo de resolução compartilhado por getPartnerNews (feed da home,
    // todos os servidores parceiros) e getOwnPartnerNews (prévia de UM
    // servidor só, moderacao.ejs) — evita duplicar o fetch de
    // imagem/evento nos dois lugares. `item` precisa de
    // {guild, guildId, imageMessageId, eventId}.
    async function resolvePartnerNewsMedia(client, item) {
        let imageUrl = null;
        if (item.imageMessageId && process.env.BANNER_STORAGE_CHANNEL_ID) {
            try {
                const storageChannel = await client.channels.fetch(process.env.BANNER_STORAGE_CHANNEL_ID);
                const storedMessage = await storageChannel.messages.fetch(item.imageMessageId);
                imageUrl = storedMessage.attachments.first()?.url || null;
            } catch (error) {
                imageUrl = null;
            }
        }

        let latestEvent = null;
        if (item.eventId) {
            try {
                const ev = await item.guild.scheduledEvents.fetch(item.eventId);
                if (ev && ev.status === GuildScheduledEventStatus.Scheduled && ev.scheduledStartTimestamp) {
                    latestEvent = { name: ev.name, scheduledStartAt: ev.scheduledStartTimestamp, url: `https://discord.com/events/${item.guildId}/${ev.id}` };
                }
            } catch (error) {
                latestEvent = null;
            }
        }
        if (!latestEvent && PremiumSystem.isGuildAtLeast(item.guildId, 'cacador')) {
            try {
                const eventList = await item.guild.scheduledEvents.fetch();
                const upcoming = [...eventList.values()]
                    .filter((ev) => ev.status === GuildScheduledEventStatus.Scheduled && ev.scheduledStartTimestamp)
                    .sort((a, b) => a.scheduledStartTimestamp - b.scheduledStartTimestamp);
                if (upcoming.length > 0) {
                    const ev = upcoming[0];
                    latestEvent = { name: ev.name, scheduledStartAt: ev.scheduledStartTimestamp, url: `https://discord.com/events/${item.guildId}/${ev.id}` };
                }
            } catch (error) {
                console.error(`❌ [Novidades] Erro ao buscar evento agendado de ${item.guildId}:`, error.message);
            }
        }

        // Link de convite pro servidor (pedido do dono, 2026-08-11: "No
        // carrossel de novidades de servidores em perfil e loja, adicione
        // um link para o servidor do discord") — vanityURLCode é só uma
        // propriedade já em cache (sem chamada de API), preferida quando
        // existe; senão tenta reaproveitar um convite já existente do
        // servidor via guild.invites.fetch() (exige o bot ter Gerenciar
        // Servidor — normalmente tem, já que o convite padrão do bot pede
        // permissions=8/Administrator). Sem convite nenhum acessível
        // (permissão faltando, nenhum convite ativo), fica null e o card
        // simplesmente não mostra o link — não trava a divulgação.
        let inviteUrl = item.guild.vanityURLCode ? `https://discord.gg/${item.guild.vanityURLCode}` : null;
        if (!inviteUrl) {
            try {
                const invites = await item.guild.invites.fetch();
                const firstInvite = invites.find((inv) => !inv.temporary) || invites.first();
                if (firstInvite) inviteUrl = `https://discord.gg/${firstInvite.code}`;
            } catch (error) {
                inviteUrl = null;
            }
        }

        return { imageUrl, latestEvent, inviteUrl };
    }

    // Cache curto (60s) do feed inteiro — pedido do dono, 2026-08-10:
    // "Site parece ter dificuldade para carregar as páginas". Causa raiz:
    // getPartnerNews virou parte de /, /perfil E /loja (antes só da home) —
    // cada carregamento faz de verdade fetch de canal+mensagem (imagem) e
    // scheduledEvents (bônus Caçador) do Discord POR anúncio elegível, sem
    // cache nenhum; com >1 anúncio publicado isso já passa de 1 chamada
    // REST só pra montar o feed, multiplicado por 3 páginas diferentes toda
    // vez que alguém navega entre elas. TTL curto o bastante pra uma
    // divulgação nova (/divulgar) aparecer rápido, longo o bastante pra
    // cortar a imensa maioria das chamadas repetidas de navegação normal.
    let _partnerNewsCache = null; // { data, expiresAt }
    const PARTNER_NEWS_CACHE_TTL_MS = 60 * 1000;

    async function getPartnerNews(client) {
        if (_partnerNewsCache && _partnerNewsCache.expiresAt > Date.now()) {
            return _partnerNewsCache.data;
        }
        const data = await _fetchPartnerNews(client);
        _partnerNewsCache = { data, expiresAt: Date.now() + PARTNER_NEWS_CACHE_TTL_MS };
        return data;
    }

    async function _fetchPartnerNews(client) {
        const rows = db.prepare(`
            SELECT t.guild_id, t.value AS title, x.value AS text, u.value AS updated_at,
                   img.value AS image_message_id, ev.value AS event_id
            FROM settings t
            LEFT JOIN settings x ON x.guild_id = t.guild_id AND x.key = 'partner_news_text'
            LEFT JOIN settings u ON u.guild_id = t.guild_id AND u.key = 'partner_news_updated_at'
            LEFT JOIN settings img ON img.guild_id = t.guild_id AND img.key = 'partner_news_image_message_id'
            LEFT JOIN settings ev ON ev.guild_id = t.guild_id AND ev.key = 'partner_news_event_id'
            WHERE t.key = 'partner_news_title' AND t.value IS NOT NULL AND TRIM(t.value) != ''
            ORDER BY CAST(u.value AS INTEGER) DESC
        `).all();

        const eligible = rows
            .map((row) => {
                const guild = client.guilds.cache.get(row.guild_id);
                if (!guild || !PremiumSystem.isGuildAtLeast(guild.id, 'rastreador')) return null;
                const iconUrl = guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null;
                return {
                    guild, guildId: guild.id, guildName: guild.name, iconUrl,
                    title: row.title, text: row.text || '',
                    imageMessageId: row.image_message_id || null,
                    eventId: row.event_id || null,
                };
            })
            .filter(Boolean);

        return Promise.all(eligible.map(async (item) => {
            const { imageUrl, latestEvent, inviteUrl } = await resolvePartnerNewsMedia(client, item);
            const { guild, imageMessageId, eventId, ...rest } = item;
            return { ...rest, imageUrl, latestEvent, inviteUrl };
        }));
    }

    // Prévia SOMENTE-LEITURA da divulgação atual de 1 servidor (pedido do
    // dono, 2026-08-06: publicar/atualizar virou exclusivo do /divulgar —
    // ver seção 113 do PREMIUM.txt), usada por moderacao.ejs "DIVULGAÇÃO
    // DO SERVIDOR". Mesma resolução de imagem/evento de getPartnerNews
    // (resolvePartnerNewsMedia), só que pra 1 guild_id só, sem rodar a
    // query + fetch de evento pra TODO servidor parceiro à toa. null
    // quando o servidor nunca publicou nada (partner_news_title vazio).
    async function getOwnPartnerNews(client, guildId) {
        const guild = client.guilds.cache.get(guildId);
        const title = ConfigSystem.getSetting(guildId, 'partner_news_title');
        if (!guild || !title || !title.trim()) return null;

        const text = ConfigSystem.getSetting(guildId, 'partner_news_text') || '';
        const updatedAtRaw = ConfigSystem.getSetting(guildId, 'partner_news_updated_at');
        const updatedAt = updatedAtRaw ? parseInt(updatedAtRaw, 10) : null;
        const imageMessageId = ConfigSystem.getSetting(guildId, 'partner_news_image_message_id');
        const eventId = ConfigSystem.getSetting(guildId, 'partner_news_event_id');

        const { imageUrl, latestEvent } = await resolvePartnerNewsMedia(client, { guild, guildId, imageMessageId, eventId });
        return { title, text, imageUrl, latestEvent, updatedAt };
    }

    app.get('/perfil', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');

        const userId = req.user.id;
        const link = PlayerRegistry.getPlayerByDiscordId(userId);
        const playerTier = PremiumSystem.getPlayerTier(userId);
        const premiumInfo = PremiumSystem.getPlayerPremiumInfo(userId);
        const isCompyPlus = playerTier === 'compy' || playerTier === 'raptor';
        const isRaptor = playerTier === 'raptor';
        // Saldo real de Caçadas (pedido do dono, 2026-08-07: "Libere o farm
        // dos itens por hora jogada agora") — não depende de `link` (mesma
        // função já usada em /loja, devolve 0 com segurança pra quem não
        // tem player_links ainda), calculado fora do bloco `if (link)`
        // abaixo porque o selo .perfil-hunt-pill no topo do card aparece
        // pra QUALQUER usuário logado, vinculado ou não.
        const huntBalance = PlayerRegistry.getHuntBalance(userId);
        // Ossos e XP (pedido do dono, 2026-08-10: "Adicionar todos os
        // saldos de moedas no perfil, no discord e em jogo") — mesmo
        // motivo/mesma garantia de segurança de huntBalance acima (funções
        // já usadas em /loja, devolvem 0 sem player_links).
        const bonesBalance = PlayerRegistry.getBonesBalance(userId);
        const xpBalance = PlayerRegistry.getXp(userId);
        // Progressão de Nível (pedido do dono, 2026-08-11: "Implemente um
        // sistema de progressão de níveis infinito baseado em horas
        // jogadas") — nível/percentual sempre calculados a partir do XP
        // total, nunca armazenados (ver levelSystem.js).
        const levelProgress = PlayerRegistry.getLevelProgress(userId);
        // Cargo(s) de staff configurado(s) (pedido do dono, 2026-08-07) —
        // não depende de `link` (é sobre a conta Discord, não sobre o
        // vínculo PoT), ver getStaffRoles acima.
        const staffRoles = getStaffRoles(userId, client);
        // Histórico de Staff (pedido do dono, 2026-08-10) — mesmo motivo de
        // staffRoles acima (não depende de link), ver getStaffHistoryForProfile.
        const staffHistory = getStaffHistoryForProfile(userId, client);

        let honorStars = null;
        let mostPlayedDinosaur = null;
        let kdStats = null;
        let playedGuilds = [];
        let badgeOptions = [];
        let redeemableItems = [];
        let avatarOptions = [];
        let backgroundOptions = [];
        let avatarPreviewUrl = null;
        let backgroundPreviewUrl = null;
        let ownedItems = [];

        // Personalização exige vínculo (mesmo gate do /perfil-edit: sem
        // player_links não tem onde gravar a escolha) — só calcula/busca
        // tudo isso quando faz sentido mostrar o editor.
        if (link) {
            honorStars = PunishmentSystem.getGlobalHonorStars(userId);
            mostPlayedDinosaur = PlayerRegistry.getMostPlayedDinosaur(link.alderon_id);
            // KDA (pedido do dono, 2026-08-05: "tá faltando KDA no perfil
            // também") — GLOBAL (soma de todo servidor, ver
            // getGlobalPlayerStats), diferente do /perfil no Discord (que
            // mostra só do servidor onde o comando foi rodado, pedido do
            // dono lá pra não confundir a comunidade PÚBLICA de um
            // servidor específico). Essa distinção não se aplica aqui:
            // /perfil no dashboard só o próprio usuário vê, sem plateia.
            // Respeita hide_kda (Compy+, ver aba Personalização) igual o
            // Discord faz.
            if (!link.hide_kda) {
                const stats = PlayerRegistry.getGlobalPlayerStats(link.alderon_id);
                kdStats = { kills: stats.kills, deaths: stats.deaths, kd: formatKD(stats.kills, stats.deaths) };
            }
            playedGuilds = getPlayedGuilds(link.alderon_id, client);
            // Livres + possuídos (comprado antes da reforma ou resgatado
            // por requisito) pra ESTE jogador — ver ConfigSystem.
            // _usableBadgeOptions. Emblema com requisito não cumprido nem
            // resgatado ainda não entra na lista de EQUIPAR (redeemableItems
            // abaixo é a lista separada de "ainda dá pra resgatar").
            badgeOptions = ConfigSystem.getUsableBadgeOptions(userId);
            redeemableItems = ImageShopSystem.getRedeemableItems(userId);
            if (isCompyPlus && !isRaptor) {
                avatarOptions = ConfigSystem.getPersonalizationOptions();
                backgroundOptions = avatarOptions;
            } else if (!isCompyPlus) {
                // Free tier pode ter comprado uma imagem ESPECÍFICA na Loja
                // (pedido do dono, 2026-08-07: "a loja vai ser permitida a
                // qualquer jogador, para comprar e adicionar ao seu
                // inventario imagens de personalização") — mesma fonte
                // usada pelo /perfil-edit do Discord, ver
                // ConfigSystem.getOwnedUsableOptions/imageShopSystem.js.
                // Foto e plano de fundo unificados num tipo só
                // (personalizacao, reforma 2026-08-12) — a mesma imagem
                // comprada aparece nos dois seletores.
                avatarOptions = ConfigSystem.getOwnedUsableOptions(userId, 'personalizacao');
                backgroundOptions = avatarOptions;
            }
            avatarPreviewUrl = await resolvePlayerImageUrl('personalizacao', link.selected_photo_key, isRaptor ? link.banner_message_id : null);
            backgroundPreviewUrl = await resolvePlayerImageUrl('personalizacao', link.selected_background_key, isRaptor ? link.background_message_id : null);

            // "Seus Itens" (pedido do dono, 2026-08-10: "Adicionar itens de
            // jogo no perfil do site") — inventário REAL de compras da Loja
            // de Personalização (image_inventory, ver imageShopSystem.js),
            // não confundir com avatarOptions/backgroundOptions acima (que
            // são as OPÇÕES disponíveis pra escolher, não o que já foi
            // comprado). Resolve label+URL de cada item comprado pra exibir
            // como galeria simples, só leitura (trocar o que está
            // selecionado continua sendo só pela aba Personalização).
            const inventoryRows = ImageShopSystem.getInventory(userId);
            ownedItems = await Promise.all(inventoryRows.map(async (row) => {
                const poolItem = ProfileImagePool.getByTypeAndId(row.pool_type, row.pool_id);
                return {
                    type: row.pool_type,
                    id: row.pool_id,
                    label: poolItem?.label || 'Item',
                    url: poolItem ? await ProfileImagePool.resolveImageUrl(client, row.pool_type, row.pool_id) : null,
                    purchasedAt: row.purchased_at,
                };
            }));
        }

        const otherGuilds = await getAdminGuildsWithBot(req);

        // Tempo de jogo TOTAL (soma de todo servidor já jogado) — pedido do
        // dono, 2026-08-10, ver comentário completo em perfil.ejs perto do
        // card "Tempo de Jogo". Cada pg.totalPlaytime já vem com o tempo AO
        // VIVO somado quando online agora (ver getPlayedGuilds acima).
        const totalPlaytimeSeconds = playedGuilds.reduce((sum, pg) => sum + (pg.totalPlaytime || 0), 0);
        const totalPlaytimeLabel = totalPlaytimeSeconds > 0 ? StaffPresenceSystem.formatDuration(totalPlaytimeSeconds * 1000) : null;

        res.render('perfil', {
            nickname: req.user.global_name || req.user.username,
            role: 'Membro',
            isOwner: isOwnerSession(req),
            otherGuilds,
            discordUser: req.user,
            link,
            playerTier,
            premiumInfo,
            isCompyPlus,
            isRaptor,
            honorStars,
            mostPlayedDinosaur,
            kdStats,
            huntBalance,
            bonesBalance,
            xpBalance,
            levelProgress,
            ownedItems,
            staffRoles,
            staffHistory,
            playedGuilds,
            totalPlaytimeLabel,
            badgeOptions,
            redeemableItems,
            avatarOptions,
            backgroundOptions,
            avatarPreviewUrl,
            backgroundPreviewUrl,
            saved: req.query.saved,
        });
    });

    // "Histórico do jogador" (pedido do dono, 2026-08-07: "Adicione ao
    // perfil um botão de histórico do jogador puxando o histórico de
    // reputação e punição") — ver getPlayerHistoryData acima pra
    // explicação completa do formato/regras de gate. Só checkAuth, mesmo
    // espírito self-view de /perfil/denuncias (qualquer usuário logado vê
    // o PRÓPRIO histórico, não precisa ser admin de servidor nenhum).
    app.get('/perfil/historico', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { reputationByGuild, punishments } = getPlayerHistoryData(req.user.id, client);
        res.render('perfil-historico', {
            nickname: req.user.global_name || req.user.username,
            role: 'Membro',
            isOwner: isOwnerSession(req),
            otherGuilds: await getAdminGuildsWithBot(req),
            reputationByGuild,
            punishments,
        });
    });

    // "Suas Denúncias" (pedido do dono, 2026-08-05: item da sidebar
    // restrita de /perfil) — global, sem :guildID, mostra só os reports
    // que ESTE usuário abriu, em QUALQUER servidor, ver getUserReportsData
    // acima. Só checkAuth (sem resolveAdminMember/isAdmin) — qualquer
    // usuário logado vê os próprios reports, não precisa ser admin de
    // servidor nenhum (mesmo espírito de /perfil).
    app.get('/perfil/denuncias', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const state = parseReportsQueryState(req.query);
        const { openReports, openPagination, closedReports, closedPagination } = getUserReportsData(req.user.id, client, state);
        res.render('perfil-denuncias', {
            nickname: req.user.global_name || req.user.username,
            role: 'Membro',
            isOwner: isOwnerSession(req),
            otherGuilds: await getAdminGuildsWithBot(req),
            openReports,
            openPagination,
            closedReports,
            closedPagination,
        });
    });

    // "Loja" (pedido do dono, 2026-08-06: "Monte um site com uma prévia da
    // loja parecida com o que combinamos que fez com o image-pool"),
    // global como /perfil (moeda é do JOGADOR, não do servidor). A Loja
    // de Personalização (Caçadas) continua PRÉVIA VISUAL só (sistema de
    // Caçadas/XP ainda não implementado) — reaproveita o pool dinâmico
    // de imagens (avatar/plano de fundo/emblema) como inventário de
    // EXEMPLO, mesmo critério de visibilidade PÚBLICA do /perfil-edit.
    //
    // O conversor Ossos<->Marks (pedido do dono, 2026-08-07: "adicione um
    // sistema de conversor de moedas") é FUNCIONAL DE VERDADE — ver
    // PREMIUM.txt seção 122/123/currencySystem.js: saldo real
    // (player_links.bones_balance) + RCON de verdade contra o servidor
    // de jogo escolhido. Precisa do jogador estar vinculado (/registrar)
    // pra saber o Alderon ID a mirar no RCON, de pelo menos um servidor
    // jogado (getPlayedGuilds, mesma fonte já usada no /perfil) pra
    // escolher ONDE creditar/remover os Marks, e de estar ONLINE nesse
    // servidor agora (confirmado pelo dono: addmarks só funciona online,
    // e o conversor como um todo exige isso — checado em
    // currencySystem.js._resolveTarget). O texto cru que o RCON devolveu
    // (?resposta=) é repassado pro template pra transparência, já que um
    // `removemarks` "bem sucedido" no transporte não garante saldo
    // suficiente no jogo (ver comentário no topo de currencySystem.js).
    app.get('/loja', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');

        // requirement/requirementLabel (ver AchievementSystem) só têm
        // efeito real pra badge/titulo — personalizacao nunca grava essa
        // coluna, fica sempre null aqui, sem custo/risco de calcular do
        // mesmo jeito pros 3 tipos (mesmo padrão já usado em /dev/Loja).
        const resolvePublicGroup = async (type) => {
            const rows = ProfileImagePool.listImages(type, { publicOnly: true });
            return Promise.all(rows.map(async (row) => {
                const requirement = AchievementSystem.parseRequirement(row);
                return {
                    ...row,
                    url: await ProfileImagePool.resolveImageUrl(client, type, row.id),
                    owned: ImageShopSystem.ownsImage(req.user.id, type, row.id),
                    requirement,
                    requirementLabel: AchievementSystem.describeRequirement(requirement),
                };
            }));
        };
        // Foto de perfil e plano de fundo unificados num grupo só
        // (personalizacao, reforma das lojas 2026-08-12) — a mesma imagem
        // comprada serve pras duas coisas, então não faz mais sentido
        // mostrar o mesmo item 2x sob headers diferentes (ver loja.ejs).
        // Emblema/Título (badges/titulos) saíram do card de Personalização
        // (pedido do dono, 2026-08-13: "Emblemas e titulos não devem
        // ficar no card da loja de personalização") — moraram pro card
        // próprio "Missões e Recompensas" mais abaixo, já que não são
        // comprados com Caçadas, são resgatados de graça por requisito.
        const [personalizacao, badges, titulos] = await Promise.all([
            resolvePublicGroup('personalizacao'),
            resolvePublicGroup('badge'),
            resolvePublicGroup('titulo'),
        ]);
        // Quais badges/titulos este jogador já pode resgatar AGORA (requisito
        // cumprido, ainda não possui) — mesma fonte usada em /perfil.
        const redeemableKeys = new Set(
            ImageShopSystem.getRedeemableItems(req.user.id).map((i) => `${i.type}:${i.id}`)
        );
        badges.forEach((b) => { b.redeemable = redeemableKeys.has(`badge:${b.id}`); });
        titulos.forEach((t) => { t.redeemable = redeemableKeys.has(`titulo:${t.id}`); });

        const link = PlayerRegistry.getPlayerByDiscordId(req.user.id);
        const bonesBalance = PlayerRegistry.getBonesBalance(req.user.id);
        const huntBalance = PlayerRegistry.getHuntBalance(req.user.id);
        const xpBalance = PlayerRegistry.getXp(req.user.id);
        // Progressão de Nível (pedido do dono, 2026-08-11), ver comentário
        // completo na rota /perfil acima.
        const levelProgress = PlayerRegistry.getLevelProgress(req.user.id);
        const playedGuilds = link ? getPlayedGuilds(link.alderon_id, client) : [];
        // Carrossel pequeno de anúncios de servidores parceiros no topo
        // (pedido do dono, 2026-08-10) — mesma fonte da home/perfil.
        const partnerNews = await getPartnerNews(client);

        // Loja de Jogo (reforma 2026-08-12) — um catálogo POR servidor já
        // jogado (mesma lista de playedGuilds do conversor de moedas
        // acima), só com os itens que o admin daquele servidor de fato
        // ligou (enabled=true) e, no caso da Missão, já tem o nome
        // configurado (sem isso a compra falharia mesmo aparecendo aqui —
        // melhor nem mostrar do que mostrar um item que sempre erra).
        const gameShopCatalogs = playedGuilds.map((pg) => {
            const shopConfig = GameShopSystem.getGuildShopConfig(pg.guildId);
            const availableItems = Object.keys(GameShopSystem.GAME_SHOP_ITEMS)
                .map((key) => ({ key, ...GameShopSystem.GAME_SHOP_ITEMS[key], config: shopConfig[key] }))
                .filter((item) => item.config.enabled && item.config.price > 0 && (!item.needsMission || item.config.missionName));
            return { guildId: pg.guildId, name: pg.name, items: availableItems };
        }).filter((catalog) => catalog.items.length > 0);

        // Inventário da Loja de Jogo (reforma 2026-08-12, pedido do dono:
        // "A compra dos itens deve ficar no inventario do jogador, itens
        // usaveis em jogo devem ter botão para usar no inventário deles
        // pelo site") — itens já comprados e ainda não usados, com botão
        // "Usar" por linha (ver POST /loja/usar-jogo). Nome do servidor
        // resolvido via client.guilds.cache (guildId sozinho não basta
        // pra exibição) — fallback pro próprio ID se o bot não estiver
        // mais nesse servidor.
        const gameShopInventory = GameShopSystem.getInventory(req.user.id).map((item) => ({
            ...item,
            guildName: client.guilds.cache.get(item.guildId)?.name || item.guildId,
        }));

        res.render('loja', {
            nickname: req.user.global_name || req.user.username,
            role: 'Membro',
            isOwner: isOwnerSession(req),
            otherGuilds: await getAdminGuildsWithBot(req),
            personalizacao,
            badges,
            titulos,
            isLinked: !!link,
            bonesBalance,
            huntBalance,
            xpBalance,
            levelProgress,
            marksPerBone: CurrencySystem.MARKS_PER_BONE,
            dailyMarksLimit: CurrencySystem.DAILY_MARKS_TO_BONES_LIMIT,
            playedGuilds,
            gameShopCatalogs,
            gameShopInventory,
            partnerNews,
            convertResult: req.query.convertido || null,
            convertError: req.query.erro || null,
            convertAmount: req.query.valor || null,
            convertRconResponse: req.query.resposta || null,
            purchaseResult: req.query.comprado || null,
            gameShopPurchaseResult: req.query.jogoComprado || null,
            gameShopUseResult: req.query.jogoUsado || null,
            redeemResult: req.query.resgatado || null,
            personalizationConfig: ImageShopSystem.getPersonalizationShopConfig(),
            submissionSent: req.query.enviado === '1',
        });
    });

    // Conversor Ossos<->Marks (POST, redireciona de volta pra /loja com o
    // resultado na query string — mesmo padrão de feedback já usado em
    // ?saved=success/error, só que com uma mensagem específica em vez do
    // genérico "Configurações salvas", já que aqui o valor convertido
    // importa). Nenhuma das duas rotas usa :guildID na URL (a Loja é
    // global) — o servidor de destino do RCON vem do corpo do form
    // (guildId, escolhido entre os servidores que o jogador já jogou).
    app.post('/loja/converter/ossos-marks', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildId, quantidade } = req.body;
        const amount = parseInt(quantidade, 10);
        const result = await CurrencySystem.convertBonesToMarks(client, req.user.id, guildId, amount);
        if (result.ok) {
            return res.redirect(`/loja?convertido=ossos-marks&valor=${result.marksCredited}&resposta=${encodeURIComponent(result.rconResponse || '')}`);
        }
        return res.redirect(`/loja?erro=${encodeURIComponent(result.error)}`);
    });

    app.post('/loja/converter/marks-ossos', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildId, quantidade } = req.body;
        const amount = parseInt(quantidade, 10);
        const result = await CurrencySystem.convertMarksToBones(client, req.user.id, guildId, amount);
        if (result.ok) {
            return res.redirect(`/loja?convertido=marks-ossos&valor=${result.bonesCredited}&resposta=${encodeURIComponent(result.rconResponse || '')}`);
        }
        return res.redirect(`/loja?erro=${encodeURIComponent(result.error)}`);
    });

    // Compra de item da Loja de Personalização (POST, redireciona de volta
    // pra /loja com o resultado na query string — MESMO padrão de feedback
    // do conversor logo acima: ?erro= em caso de falha, reaproveitando o
    // banner de erro já existente no template sem precisar de um segundo.
    // Sucesso usa ?comprado=<label> em vez de ?convertido= (ação diferente,
    // merece o próprio parâmetro/banner) — ver loja.ejs pro texto exibido.
    app.post('/loja/comprar', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { poolType, poolId } = req.body;
        const id = Number(poolId);
        const result = ImageShopSystem.purchaseImage(req.user.id, poolType, id);
        if (result.ok) {
            const row = ProfileImagePool.getByTypeAndId(poolType, id);
            return res.redirect(`/loja?comprado=${encodeURIComponent(row ? row.label : '')}`);
        }
        return res.redirect(`/loja?erro=${encodeURIComponent(result.error)}`);
    });

    // Compra de item da Loja de Jogo (Growth/Skipshed/Missão, pago em
    // Ossos) — reforma 2026-08-12: NÃO dispara RCON mais na hora da
    // compra, só debita e grava no inventário (ver gameShopSystem.js
    // purchaseGameShopItem) — o RCON de verdade só roda quando o jogador
    // clica "Usar" no inventário (POST /loja/usar-jogo, logo abaixo).
    // Mesmo padrão de feedback das outras rotas de /loja: ?erro=
    // reaproveita o banner já existente, sucesso usa ?jogoComprado=<label>.
    app.post('/loja/comprar-jogo', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildId, itemKey } = req.body;
        const result = await GameShopSystem.purchaseGameShopItem(guildId, req.user.id, itemKey);
        if (result.ok) {
            return res.redirect(`/loja?jogoComprado=${encodeURIComponent(result.label)}`);
        }
        return res.redirect(`/loja?erro=${encodeURIComponent(result.error)}`);
    });

    // Usa um item já comprado da Loja de Jogo — aqui, sim, dispara o RCON
    // de verdade (ver gameShopSystem.js useGameShopItem), checando
    // online/espécie NESTE momento (não no momento da compra). Sucesso
    // usa ?jogoUsado=<label> (banner próprio, distinto de ?jogoComprado=
    // — "aplicado no jogo" faz mais sentido aqui do que "comprado").
    app.post('/loja/usar-jogo', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const inventoryId = Number(req.body.inventoryId);
        const result = await GameShopSystem.useGameShopItem(inventoryId, req.user.id);
        if (result.ok) {
            return res.redirect(`/loja?jogoUsado=${encodeURIComponent(result.label)}`);
        }
        return res.redirect(`/loja?erro=${encodeURIComponent(result.error)}`);
    });

    // Envio de imagem própria pra venda no marketplace (reforma das lojas,
    // 2026-08-12: "um jogador pode pagar hunst para criar um item a
    // venda, e enviar uma imagem com limite de proporção 800 x 427, toda
    // imagem subida deve virar webp"). Checa saldo/config ANTES de subir
    // (evita gastar o custo de upload+webp se o jogador nem tem Caçadas
    // suficientes ou o marketplace está fechado); a proporção é validada
    // com sharp().metadata() no buffer CRU (webp/resize de
    // storeImageBuffer só roda depois, se passar). Fica pendente até o
    // dono aprovar/reprovar em /dev/Loja — ver ImageShopSystem.submitImageForSale.
    app.post(
        '/loja/enviar-imagem',
        checkAuth,
        safeUpload(upload.single('imagem'), '/loja?erro=' + encodeURIComponent('Erro ao processar o arquivo.')),
        async (req, res) => {
            if (isDashboardLocked(req)) return res.redirect('/dashboard');
            const label = (req.body.label || '').trim();
            const file = req.file;
            if (!label || !file) {
                return res.redirect(`/loja?erro=${encodeURIComponent('Informe um nome e escolha uma imagem.')}`);
            }

            const config = ImageShopSystem.getPersonalizationShopConfig();
            if (!config.accepting_submissions) {
                return res.redirect(`/loja?erro=${encodeURIComponent('O envio de imagens pra venda está temporariamente fechado.')}`);
            }
            if (PlayerRegistry.getHuntBalance(req.user.id) < config.submission_fee) {
                return res.redirect(`/loja?erro=${encodeURIComponent('Saldo de Caçadas insuficiente pra pagar a taxa de envio.')}`);
            }

            try {
                const sharp = require('sharp');
                const metadata = await sharp(file.buffer).metadata();
                const targetRatio = 800 / 427;
                const actualRatio = (metadata.width || 0) / (metadata.height || 1);
                if (!metadata.width || !metadata.height || Math.abs(actualRatio - targetRatio) / targetRatio > 0.02) {
                    return res.redirect(`/loja?erro=${encodeURIComponent('A imagem precisa ter proporção 800x427 (aprox. 1.87:1).')}`);
                }
            } catch (error) {
                return res.redirect(`/loja?erro=${encodeURIComponent('Não foi possível processar essa imagem.')}`);
            }

            const stored = await storeImageBuffer(client, file.buffer, `Envio de \`${req.user.username}\` (\`${req.user.id}\`) pra venda na Loja — "${label}"`);
            if (!stored.ok) {
                return res.redirect(`/loja?erro=${encodeURIComponent('Erro ao processar a imagem — tente novamente.')}`);
            }

            const result = ImageShopSystem.submitImageForSale(req.user.id, label, stored.messageId);
            if (!result.ok) {
                return res.redirect(`/loja?erro=${encodeURIComponent(result.error)}`);
            }
            return res.redirect('/loja?enviado=1');
        }
    );

    app.post(
        '/perfil/save',
        checkAuth,
        safeUpload(upload.fields([{ name: 'avatar_file', maxCount: 1 }, { name: 'background_file', maxCount: 1 }]), '/perfil?saved=error'),
        async (req, res) => {
            if (isDashboardLocked(req)) return res.redirect('/dashboard');

            const userId = req.user.id;
            const link = PlayerRegistry.getPlayerByDiscordId(userId);
            if (!link) return res.redirect('/perfil?saved=error');

            const playerTier = PremiumSystem.getPlayerTier(userId);
            const isCompyPlus = playerTier === 'compy' || playerTier === 'raptor';
            const isRaptor = playerTier === 'raptor';
            const body = req.body;
            const files = req.files || {};

            try {
                // Emblema — liberado em QUALQUER tier, mas emblemas com
                // preço exigem compra prévia na Loja (mesma regra do
                // /perfil-edit no Discord, ver ConfigSystem.getUsableBadgeOptions).
                if ('badge_key' in body) {
                    const key = body.badge_key || null;
                    const valid = !key || ConfigSystem.getUsableBadgeOptions(userId).some(opt => opt.value === key);
                    if (valid) PlayerRegistry.setSelectedBadgeKey(userId, key);
                }

                if (isCompyPlus) {
                    PlayerRegistry.setHideKda(userId, body.hide_kda === 'on');

                    if (isRaptor) {
                        // Upload próprio tem prioridade sobre "remover" no mesmo
                        // submit (mesma regra já usada pros banners de
                        // Strike/Unstrike em /moderacao/:guildID/save).
                        const avatarFile = files.avatar_file?.[0];
                        const backgroundFile = files.background_file?.[0];
                        if (avatarFile) {
                            const result = await storeImageBuffer(client, avatarFile.buffer, `Foto de perfil de \`${req.user.username}\` (\`${userId}\`) via dashboard`);
                            if (result.ok) PlayerRegistry.setBannerMessageId(userId, result.messageId);
                        }
                        if (backgroundFile) {
                            const result = await storeImageBuffer(client, backgroundFile.buffer, `Plano de fundo de \`${req.user.username}\` (\`${userId}\`) via dashboard`);
                            if (result.ok) PlayerRegistry.setBackgroundMessageId(userId, result.messageId);
                        } else if (body.remove_background === 'on') {
                            PlayerRegistry.setBackgroundMessageId(userId, null);
                        }
                        if ('profile_title' in body) {
                            PlayerRegistry.setProfileTitle(userId, (body.profile_title || '').trim() || null);
                        }
                    } else {
                        // Compy: escolhe da galeria do pool em vez de enviar
                        // arquivo próprio (mesma restrição do /perfil-edit).
                        if (body.remove_background === 'on') {
                            PlayerRegistry.setSelectedBackgroundKey(userId, null);
                        } else if ('background_key' in body) {
                            const key = body.background_key || null;
                            const valid = !key || ConfigSystem.getPersonalizationOptions().some(opt => opt.value === key);
                            if (valid) PlayerRegistry.setSelectedBackgroundKey(userId, key);
                        }
                        if ('photo_key' in body) {
                            const key = body.photo_key || null;
                            const valid = !key || ConfigSystem.getPersonalizationOptions().some(opt => opt.value === key);
                            if (valid) PlayerRegistry.setSelectedPhotoKey(userId, key);
                        }
                    }
                } else {
                    // Free: só pode escolher entre foto/plano de fundo que
                    // comprou na Loja e já pode usar (pedido do dono,
                    // 2026-08-07: "a loja vai ser permitida a qualquer
                    // jogador, para comprar e adicionar ao seu inventario
                    // imagens de personalização") — mesma fonte usada pelo
                    // /perfil-edit do Discord, ver imageShopSystem.js.
                    const ownedPhotoOptions = ConfigSystem.getOwnedUsableOptions(userId, 'personalizacao');
                    const ownedBackgroundOptions = ownedPhotoOptions;
                    if (body.remove_background === 'on') {
                        PlayerRegistry.setSelectedBackgroundKey(userId, null);
                    } else if ('background_key' in body) {
                        const key = body.background_key || null;
                        const valid = !key || ownedBackgroundOptions.some(opt => opt.value === key);
                        if (valid) PlayerRegistry.setSelectedBackgroundKey(userId, key);
                    }
                    if ('photo_key' in body) {
                        const key = body.photo_key || null;
                        const valid = !key || ownedPhotoOptions.some(opt => opt.value === key);
                        if (valid) PlayerRegistry.setSelectedPhotoKey(userId, key);
                    }
                }

                res.redirect('/perfil?saved=success');
            } catch (error) {
                console.error('❌ Erro ao salvar personalização de perfil:', error);
                res.redirect('/perfil?saved=error');
            }
        }
    );

    // Resgata um emblema/título cujo requisito já foi cumprido (reforma
    // das lojas, 2026-08-12) — mesmo par type:id usado no menu Resgatar
    // do Discord (ver ConfigSystem.handlePerfilRedeemSelect), aqui vindo
    // de um <select> do form web. Reconfere elegibilidade no
    // ImageShopSystem.redeemItem, nunca confia só na lista já renderizada.
    // Rota COMPARTILHADA por /perfil e /loja (pedido do dono, 2026-08-13:
    // card "Missões e Recompensas" novo em /loja também lista/resgata
    // emblema+título) — redirectTo (campo hidden do form) decide pra onde
    // volta depois; só aceita o valor fixo 'loja' (nunca uma URL vinda do
    // corpo do request, pra não abrir a porta pra open-redirect), qualquer
    // outra coisa cai no default de sempre (/perfil, ?saved=). /loja usa
    // os próprios parâmetros de query já estabelecidos na página
    // (?resgatado=/?erro=, ver GET /loja) em vez de ?saved=, que é
    // específico do padrão de overlay de configurações do /perfil.
    app.post('/perfil/resgatar', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const backToLoja = req.body.redirectTo === 'loja';
        const [type, idStr] = (req.body.item || '').split(':');
        const id = Number(idStr);
        if (!type || !id) {
            return res.redirect(backToLoja ? `/loja?erro=${encodeURIComponent('Requisição inválida.')}` : '/perfil?saved=error');
        }
        const result = ImageShopSystem.redeemItem(req.user.id, type, id);
        if (backToLoja) {
            return res.redirect(result.ok
                ? `/loja?resgatado=${encodeURIComponent(result.label)}`
                : `/loja?erro=${encodeURIComponent(result.error)}`);
        }
        res.redirect(`/perfil?saved=${result.ok ? 'success' : 'error'}`);
    });

    // Portal (pedido do dono, 2026-08-06) — era "Seleção de Servidores"
    // (index.ejs, renomeado pra portal.ejs), agora a entrada única de
    // quem está logado: card de perfil + atalho pra /perfil ("Toca") +,
    // só pra quem administra algum servidor com o bot, a escolha de
    // servidor (mesmo getAdminGuildsWithBot de sempre).
    //
    // Só mostra servidores onde o bot JÁ ESTÁ (pedido do dono) — antes
    // listava todo servidor que o usuário administra no Discord, mesmo sem
    // o bot lá (o ícone levava pra /moderacao/:guildID, que redireciona de
    // volta pro portal nesse caso já que client.guilds.cache não acha a
    // guild — clicável, mas sem nenhum efeito visível, confuso).
    app.get('/dashboard', async (req, res) => {
        // Não logado ainda vê a tela de login normal (pode ser o próprio
        // dono provando quem é) — só quem JÁ ESTÁ logado como outra conta
        // vê o aviso de "em desenvolvimento" no lugar do resto do Portal.
        const locked = DASHBOARD_LOCKED_TO_OWNER && req.user && req.user.id !== DEVELOPER_ID;
        if (!req.user || locked) {
            return res.render('portal', { guilds: [], locked, profileCard: null });
        }

        const guilds = await getAdminGuildsWithBot(req);

        // Card de perfil — a MESMA imagem PNG que o /perfil gera no
        // Discord (ver playerRegistrationSystem.sendProfile), reaproveitando
        // renderProfileCard direto em vez de duplicar a lógica de
        // moldura/foto/estrelas. _resolveCardPhotoBuffer/_resolveBackgroundBuffer
        // são métodos de instância "privados" (convenção `_`, não enforced
        // pelo JS) que só usam interaction.client e targetUser.fetch() — um
        // objeto { client } no lugar da interaction de verdade funciona.
        // Chegou a virar um card HTML/CSS (Figma "Group 14"), mas voltou
        // pra imagem oficial (pedido do dono, 2026-08-06: "vai voltar a
        // ser a imagem oficial que geramos pelo Discord"). Sem vínculo
        // (ou falha no render), profileCard fica null e portal.ejs mostra
        // a mensagem de "use /registrar" no lugar.
        let profileCard = null;
        const player = PlayerRegistry.getPlayerByDiscordId(req.user.id);
        if (player) {
            try {
                const targetUser = await client.users.fetch(req.user.id);
                const playerTier = PremiumSystem.getPlayerTier(req.user.id);
                const system = new PlayerRegistrationSystem(client);
                const [photoBuffer, backgroundBuffer] = await Promise.all([
                    system._resolveCardPhotoBuffer({ client }, targetUser, player, playerTier),
                    system._resolveBackgroundBuffer({ client }, player, playerTier),
                ]);
                const cardBuffer = await renderProfileCard({
                    tier: playerTier,
                    photoBuffer,
                    backgroundBuffer,
                    nickname: player.player_name || targetUser.username,
                    alderonId: player.alderon_id,
                    discordUsername: targetUser.username,
                    titleLabel: player.profile_title || 'Em breve (missões)',
                    levelLabel: 'Nível 1',
                    speciesLabel: PlayerRegistry.getMostPlayedDinosaur(player.alderon_id) || 'Ainda sem registro',
                    honorStars: PunishmentSystem.getGlobalHonorStars(req.user.id),
                });
                profileCard = `data:image/png;base64,${cardBuffer.toString('base64')}`;
            } catch (error) {
                console.error('❌ [Portal] Erro ao gerar card de perfil:', error);
            }
        }

        res.render('portal', { guilds, locked: false, profileCard });
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
        const { isStaff, apiError } = await resolveAdminMember(guild, req.user.id);
        if (apiError) {
            console.error(`❌ [Dashboard] Falha ao verificar permissão de ${req.user.id} em ${guildID}:`, apiError);
            return res.status(503).send('');
        }
        if (!isStaff) return res.status(403).send('');

        // category (ver ingame-pulse-poll.js data-category) mantém o poll
        // de 15s filtrado igual ao carregamento inicial da página — sem
        // isso, o refresh trocaria o roster filtrado pelo combinado antigo.
        const category = req.query.category === 'moderacao' || req.query.category === 'eventos' ? req.query.category : undefined;
        const pulse = await getServerPulse(guildID, guild, category);
        res.render('partials/ingame-pulse', {
            pulse,
            showRoster: req.query.showRoster !== 'false',
        });
    });

    // Perfil de staff, SÓ LEITURA (pedido do dono, 2026-08-07: "adicione um
    // link em cada um para visitar o perfil deles, com um botão de volta
    // depois", ver o link "Ver perfil" em partials/staff-row.ejs) — versão
    // enxuta do /perfil normal (que só existe pro próprio usuário logado,
    // com forms de edição amarrados a req.user.id): aqui é sempre outro
    // staff, sem NENHUM formulário, só identidade Discord + vínculo PoT +
    // status em jogo NESTE servidor. Acesso: qualquer staff do servidor
    // (mesmo gate isStaff das outras páginas de guild), não só quem
    // configurou os cargos. Botão "Voltar" usa history.back() no template
    // (não uma URL fixa) — funciona voltando pra Moderação, Eventos, ou
    // qualquer lugar que tenha linkado pra cá, sem precisar de ?returnTo=.
    app.get('/staff-perfil/:guildID/:userID', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID, userID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.redirect('/dashboard');
        const { isStaff, apiError } = await resolveAdminMember(guild, req.user.id);
        if (apiError) {
            console.error(`❌ [Dashboard] Falha ao verificar permissão de ${req.user.id} em ${guildID}:`, apiError);
            return res.status(503).send('Não foi possível verificar sua permissão agora (falha temporária do Discord) — tente novamente em instantes.');
        }
        if (!isStaff) return res.redirect('/dashboard');

        const targetMember = await guild.members.fetch(userID).catch(() => null);
        if (!targetMember) return res.status(404).send('Membro não encontrado neste servidor.');

        const link = PlayerRegistry.getPlayerByDiscordId(userID);
        const playerTier = PremiumSystem.getPlayerTier(userID);
        const premiumInfo = PremiumSystem.getPlayerPremiumInfo(userID);

        let honorStars = null;
        let mostPlayedDinosaur = null;
        let kdStats = null;
        let gameStatus = null;

        // Mesma regra do /perfil normal: só calcula/mostra o que depende de
        // vínculo quando ele existe, e respeita hide_kda (privacidade que o
        // PRÓPRIO jogador escolheu, vale pra qualquer um vendo, staff ou não).
        if (link) {
            honorStars = PunishmentSystem.getGlobalHonorStars(userID);
            mostPlayedDinosaur = PlayerRegistry.getMostPlayedDinosaur(link.alderon_id);
            if (!link.hide_kda) {
                const stats = PlayerRegistry.getGlobalPlayerStats(link.alderon_id);
                kdStats = { kills: stats.kills, deaths: stats.deaths, kd: formatKD(stats.kills, stats.deaths) };
            }

            // Status em jogo NESTE servidor — mesma regra/mesma função de
            // getServerPulse (computeGameStatus), só que buscada avulsa (1
            // membro, não o roster inteiro) já que aqui é sempre 1 pessoa só.
            // Fonte da query: PlayerRegistry.getPlayerGameStatus (ver
            // docblock completo em potPlayerRegistry.js).
            const gameStatusRow = PlayerRegistry.getPlayerGameStatus(guildID, link.alderon_id);
            const online = !!gameStatusRow?.isOnline;
            const spectating = online && !!db.prepare(
                'SELECT 1 FROM pot_spectator_sessions WHERE guild_id = ? AND alderon_id = ?'
            ).get(guildID, link.alderon_id);
            gameStatus = computeGameStatus({
                online,
                spectating,
                dinosaurType: gameStatusRow?.dinosaurType,
                sessionStartedAt: gameStatusRow?.sessionStartedAt,
            });
        }

        res.render('staff-perfil', {
            nickname: req.user.global_name || req.user.username,
            role: 'Membro',
            isOwner: isOwnerSession(req),
            guild,
            discordUser: targetMember.user,
            displayName: targetMember.nickname || targetMember.user.username,
            cargo: highestStaffRoleName(guildID, targetMember) || '—',
            roleLabel: staffRoleCategoryLabel(guildID, targetMember),
            link,
            playerTier,
            premiumInfo,
            honorStars,
            mostPlayedDinosaur,
            kdStats,
            gameStatus,
        });
    });

    // Lista de reports (reports.ejs) em tempo real — pedido do dono
    // ("chats de reportes" também em tempo real).
    app.get('/fragments/reports-list/:guildID', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.status(403).send('');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.status(404).send('');
        const { isStaff, apiError } = await resolveAdminMember(guild, req.user.id);
        if (apiError) {
            console.error(`❌ [Dashboard] Falha ao verificar permissão de ${req.user.id} em ${guildID}:`, apiError);
            return res.status(503).send('');
        }
        if (!isStaff) return res.status(403).send('');

        const state = parseReportsQueryState(req.query);
        const { openReports, openPagination, closedReports, closedPagination } = getReportsData(guildID, client, state);
        res.render('partials/reports-list', { basePath: '/reports/' + guildID, openReports, openPagination, closedReports, closedPagination });
    });

    // ==================== GAME SERVER (config geral do servidor Path of Titans) ====================
    // Pedido do dono, 2026-08-11: "Adicione uma pagina de configuração
    // geral do servidor onde vai adicionar todas as configurações de
    // potserver (tudo que não temos nas categorias de moderação e de
    // eventos)". Espelha a config de /potserver setup (server_ip/rcon_port/
    // rcon_password/game_port/server_name — ver PoTConfigSystem.
    // getServerConfig/setServerConfig, um blob JSON em settings, não
    // colunas soltas) + a NOVA config de Cargo Administrativo do Dashboard
    // (admin_role — ver ConfigSystem.memberIsGuildAdmin). NÃO inclui o
    // painel de webhooks/logs por grupo de evento (/potserver logs) — é uma
    // UI própria grande (11 grupos, cada um com canal+regeneração de
    // webhook), fora do escopo desta página por ora, continua só no Discord.
    const ADMIN_ROLE_LIMIT = 5;

    app.get('/gameserver/:guildID', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.redirect('/dashboard');
        const { member, isAdmin, isStaff, apiError } = await resolveAdminMember(guild, req.user.id);
        if (apiError) {
            console.error(`❌ [Dashboard] Falha ao verificar permissão de ${req.user.id} em ${guildID}:`, apiError);
            return res.status(503).send('Não foi possível verificar sua permissão agora (falha temporária do Discord) — tente novamente em instantes.');
        }
        if (!isStaff) return res.redirect('/dashboard');

        const showAvatarHint = db.incrementDashboardAvatarHintViews(req.user.id) <= 3;
        const potConfig = PoTConfigSystem.getServerConfig(guildID) || {};
        const roles = [...guild.roles.cache.values()].filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position);
        const adminRoleIds = ConfigSystem.getRoleIds(guildID, 'admin_role');
        const role = isAdmin ? 'Administrador' : (highestStaffRoleName(guildID, member) || 'Staff');

        res.render('gameserver', {
            guild,
            nickname: member.nickname || member.user.username,
            role,
            isAdmin,
            isOwner: isOwnerSession(req),
            pageRoute: 'gameserver',
            otherGuilds: await getAdminGuildsWithBot(req),
            showAvatarHint,
            potConfig,
            roles,
            adminRoleIds,
            adminRoleLimit: ADMIN_ROLE_LIMIT,
            hasRconPassword: !!potConfig.rcon_password,
            saved: req.query.saved,
        });
    });

    app.post('/gameserver/:guildID/save', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.status(404).send('Guild não encontrada.');
        const { isAdmin, apiError } = await resolveAdminMember(guild, req.user.id);
        if (apiError) {
            console.error(`❌ [Dashboard] Falha ao verificar permissão de ${req.user.id} em ${guildID}:`, apiError);
            return res.status(503).send('Não foi possível verificar sua permissão agora (falha temporária do Discord) — tente novamente em instantes.');
        }
        if (!isAdmin) return res.status(403).send('Acesso negado.');

        const body = req.body;
        const toArray = (val) => Array.isArray(val) ? val : (val ? [val] : []);

        try {
            // Cargo Administrativo do Dashboard — form PRÓPRIO (marcador
            // 'admin_role_form_submitted', mesma razão de 'roles_form_submitted'
            // em moderacao.ejs: precisa gravar mesmo com 0 cargos selecionados,
            // sem apagar o campo ao salvar o outro card desta mesma página).
            if ('admin_role_form_submitted' in body) {
                ConfigSystem.setRoleIds(guildID, 'admin_role', toArray(body.admin_role).filter(Boolean).slice(0, ADMIN_ROLE_LIMIT));
            }

            // Conexão do servidor de jogo — mesmos campos de /potserver setup.
            if ('server_ip_form_submitted' in body) {
                const existing = PoTConfigSystem.getServerConfig(guildID) || {};
                const rconPortParsed = parseInt(body.rcon_port, 10);
                const gamePortParsed = body.game_port ? parseInt(body.game_port, 10) : NaN;
                const updatedConfig = {
                    ...existing,
                    enabled: true,
                    server_name: body.server_name || null,
                    server_ip: body.server_ip || null,
                    rcon_port: !isNaN(rconPortParsed) ? rconPortParsed : (existing.rcon_port || null),
                    // Campo write-only (nunca pré-preenchido no form, ver
                    // gameserver.ejs) — em branco = mantém a senha já salva,
                    // só troca se algo de fato foi digitado.
                    rcon_password: body.rcon_password ? body.rcon_password : (existing.rcon_password || null),
                    // Diferente de rcon_password: game_port É mostrado no
                    // form (não é segredo), então em branco aqui significa
                    // "remover" de verdade, não "manter" — semântica normal
                    // de formulário.
                    game_port: !isNaN(gamePortParsed) ? gamePortParsed : null,
                    webhook_port: existing.webhook_port || 8080,
                };
                PoTConfigSystem.setServerConfig(guildID, updatedConfig, req.user.id);
            }

            res.redirect(`/gameserver/${guildID}?saved=success`);
        } catch (error) {
            console.error('❌ Erro ao salvar configurações do Game Server:', error);
            res.redirect(`/gameserver/${guildID}?saved=error`);
        }
    });

    // ==================== LOJA DE JOGO (por servidor) ====================
    // Reforma das lojas (pedido do dono, 2026-08-12) — Growth (4 etapas,
    // cada uma com sua própria restrição de espécie)/Skipshed/Missão, pago
    // em Ossos, configurado POR SERVIDOR pelo próprio admin (GameShopSystem
    // — não confundir com a Loja de Personalização, que é global e só o
    // dono mexe, ver /dev/Loja). GET exige isStaff (visualização, mesmo
    // padrão de /gameserver), POST exige isAdmin (edição). O dono
    // (isOwnerSession) ignora o vínculo de membership/cargo com o servidor
    // — consegue configurar a Loja de Jogo de QUALQUER servidor onde o bot
    // está, mesmo sem ser membro lá (pedido: "para casos que eu precise
    // dar suporte em outros servidores").
    app.get('/lojajogo/:guildID', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.redirect('/dashboard');

        const owner = isOwnerSession(req);
        let member, isAdmin, isStaff;
        if (owner) {
            member = await guild.members.fetch(req.user.id).catch(() => null);
            isAdmin = true;
            isStaff = true;
        } else {
            const resolved = await resolveAdminMember(guild, req.user.id);
            if (resolved.apiError) {
                console.error(`❌ [Dashboard] Falha ao verificar permissão de ${req.user.id} em ${guildID}:`, resolved.apiError);
                return res.status(503).send('Não foi possível verificar sua permissão agora (falha temporária do Discord) — tente novamente em instantes.');
            }
            if (!resolved.isStaff) return res.redirect('/dashboard');
            member = resolved.member; isAdmin = resolved.isAdmin; isStaff = resolved.isStaff;
        }

        const showAvatarHint = db.incrementDashboardAvatarHintViews(req.user.id) <= 3;
        const shopConfig = GameShopSystem.getGuildShopConfig(guildID);
        const knownSpecies = PlayerRegistry.getKnownSpecies(guildID);
        const role = isAdmin ? 'Administrador' : (highestStaffRoleName(guildID, member) || 'Staff');

        res.render('lojajogo', {
            guild,
            nickname: member?.nickname || member?.user?.username || (owner ? 'Desenvolvedor' : 'Staff'),
            role,
            isAdmin,
            isOwner: owner,
            pageRoute: 'lojajogo',
            otherGuilds: await getAdminGuildsWithBot(req),
            showAvatarHint,
            items: GameShopSystem.GAME_SHOP_ITEMS,
            shopConfig,
            knownSpecies,
            saved: req.query.saved,
        });
    });

    app.post('/lojajogo/:guildID/save', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.status(404).send('Guild não encontrada.');

        const owner = isOwnerSession(req);
        if (!owner) {
            const { isAdmin, apiError } = await resolveAdminMember(guild, req.user.id);
            if (apiError) {
                console.error(`❌ [Dashboard] Falha ao verificar permissão de ${req.user.id} em ${guildID}:`, apiError);
                return res.status(503).send('Não foi possível verificar sua permissão agora (falha temporária do Discord) — tente novamente em instantes.');
            }
            if (!isAdmin) return res.status(403).send('Acesso negado.');
        }

        try {
            const body = req.body;
            const config = {};
            for (const key of Object.keys(GameShopSystem.GAME_SHOP_ITEMS)) {
                const item = GameShopSystem.GAME_SHOP_ITEMS[key];
                const priceParsed = parseInt(body[`${key}_price`], 10);
                const entry = {
                    enabled: body[`${key}_enabled`] === '1',
                    price: !isNaN(priceParsed) && priceParsed > 0 ? priceParsed : 0,
                };
                if (item.speciesRestrictable) {
                    const raw = body[`${key}_species`];
                    entry.species = (Array.isArray(raw) ? raw : (raw ? [raw] : [])).filter(Boolean);
                }
                if (item.needsMission) {
                    entry.missionName = (body[`${key}_mission`] || '').trim().slice(0, 100);
                }
                config[key] = entry;
            }
            GameShopSystem.setGuildShopConfig(guildID, config, req.user.id);
            res.redirect(`/lojajogo/${guildID}?saved=success`);
        } catch (error) {
            console.error('❌ Erro ao salvar Loja de Jogo:', error);
            res.redirect(`/lojajogo/${guildID}?saved=error`);
        }
    });

    // ==================== MODERAÇÃO ====================
    app.get('/moderacao/:guildID', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.redirect('/dashboard');
        const { member, isAdmin, isStaff, apiError } = await resolveAdminMember(guild, req.user.id);
        if (apiError) {
            console.error(`❌ [Dashboard] Falha ao verificar permissão de ${req.user.id} em ${guildID}:`, apiError);
            return res.status(503).send('Não foi possível verificar sua permissão agora (falha temporária do Discord) — tente novamente em instantes.');
        }
        if (!isStaff) return res.redirect('/dashboard');

        // Animação de indicação no avatar da sidebar (pedido do dono,
        // 2026-08-06: só nos 3 primeiros acessos ao dashboard, mostrando que
        // dá pra clicar ali pra ir pro perfil) — ver
        // db.incrementDashboardAvatarHintViews e partials/sidebar-v2.ejs.
        const showAvatarHint = db.incrementDashboardAvatarHintViews(req.user.id) <= 3;

        const pulse = await getServerPulse(guildID, guild, 'moderacao');

        // discordUsername resolvido aqui (mesma resolveUserDisplayName usada
        // por getReportsData) — o card usava "<@user_id>", sintaxe de menção
        // do PRÓPRIO Discord, que não resolve fora dele e aparecia como
        // texto cru na tela (mesmo bug já corrigido na lista de Denúncias).
        const openReportsAlert = db.prepare(
            "SELECT report_id, user_id, created_at FROM reports WHERE guild_id = ? AND status = 'waiting' ORDER BY created_at DESC"
        ).all(guildID).map(r => ({ ...r, discordUsername: resolveUserDisplayName(client, r.user_id) }));

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
        const reportMentionRoleIds = ConfigSystem.getRoleIds(guildID, 'report_mention_role');
        // Mesmo limite por tier já usado no painel /config roles do Discord
        // (ver configSystem.js ROLE_TABS.moderation.fields[*].roleLimitKey) —
        // decide se cada campo vira select simples ou chips+botão de
        // adicionar em partials/role-picker.ejs. reportMention é fixo em 3
        // pra qualquer tier (fixedLimit, não roleLimitKey — pedido do dono,
        // 2026-08-11: não escala com plano como os outros dois).
        const roleLimits = {
            moderador: PremiumSystem.getRoleLimit(guildID, 'moderador'),
            supervisor: PremiumSystem.getRoleLimit(guildID, 'supervisor'),
            reportMention: 3,
        };

        // CONFIGURAÇÕES DE PUNIÇÕES/REPUTAÇÃO (moderacao.ejs) — porta o
        // painel /config punishments do Discord (ver
        // src/systems/moderation/punishmentLevels.js e configSystem.js
        // refreshPointsPanel). guildLimits.customPunishmentApprovalEnabled/
        // automodEnabled hoje coincidem exatamente com isGuildAtLeast(...,
        // 'cacador'), mas lidos direto do PremiumSystem (fonte única de
        // verdade, mesma usada pelo painel Discord) em vez de assumir isso.
        const isRastreador = PremiumSystem.isGuildAtLeast(guildID, 'rastreador');
        const guildLimits = PremiumSystem.getGuildLimits(guildID);
        const punishmentLevels = PunishmentLevels.getLevels(guildID);
        const levelLimit = PunishmentLevels.getLevelLimit(guildID);
        const canCreateLevel = PunishmentLevels.canCreateLevel(guildID);

        // Prévia da Divulgação do Servidor (ver getOwnPartnerNews acima) +
        // próxima data em que /divulgar libera de novo (1 publicação por
        // semana) — null quando nunca publicou nada ainda.
        const partnerNews = await getOwnPartnerNews(client, guildID);
        const partnerNewsNextEligibleAt = partnerNews?.updatedAt
            ? partnerNews.updatedAt + 7 * 24 * 60 * 60 * 1000
            : null;

        // Pedido do dono, 2026-08-06: "quem entrar sem administrador, na
        // barra de perfil em sidebar, colocar o nome do maior cargo dele no
        // discord" — Administrador continua fixo em "Administrador"; quem
        // entrou só por ter um cargo de equipe (isStaff, ver
        // resolveAdminMember) vê o nome do próprio cargo mais alto entre os
        // 3 configurados (highestStaffRoleName, mesma fonte de verdade já
        // usada em getServerPulse/reports). isAdmin também vai pro template
        // pra travar visualmente os formulários de edição (ver
        // partials/view-only-banner e public/js/dashboard-view-only-lock.js).
        const role = isAdmin ? 'Administrador' : (highestStaffRoleName(guildID, member) || 'Staff');

        res.render('moderacao', {
            guild,
            nickname: member.nickname || member.user.username,
            role,
            isAdmin,
            isOwner: isOwnerSession(req),
            pageRoute: 'moderacao',
            otherGuilds: await getAdminGuildsWithBot(req),
            showAvatarHint,
            pulse,
            staffRoleIds,
            supervisorRoleIds,
            reportMentionRoleIds,
            roleLimits,
            openReportsAlert,
            settings,
            roles,
            isCacador: PremiumSystem.isGuildAtLeast(guildID, 'cacador'),
            isRastreador,
            punishmentLevels,
            levelLimit,
            canCreateLevel,
            customApprovalEnabled: guildLimits.customPunishmentApprovalEnabled,
            automodEnabled: guildLimits.automodEnabled,
            strikeBannerKey,
            unstrikeBannerKey,
            strikeBannerOptions,
            unstrikeBannerOptions,
            strikeCustomBannerUrl,
            unstrikeCustomBannerUrl,
            partnerNews,
            partnerNewsNextEligibleAt,
            saved: req.query.saved,
        });
    });

    app.post(
        '/moderacao/:guildID/save',
        checkAuth,
        safeUpload(upload.fields([{ name: 'strike_banner_file', maxCount: 1 }, { name: 'unstrike_banner_file', maxCount: 1 }]), (req) => `/moderacao/${req.params.guildID}?saved=error`),
        async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.status(404).send('Guild não encontrada.');
        const { member, isAdmin, apiError } = await resolveAdminMember(guild, req.user.id);
        if (apiError) {
            console.error(`❌ [Dashboard] Falha ao verificar permissão de ${req.user.id} em ${guildID}:`, apiError);
            return res.status(503).send('Não foi possível verificar sua permissão agora (falha temporária do Discord) — tente novamente em instantes.');
        }
        if (!isAdmin) return res.status(403).send('Acesso negado.');

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
            //
            // BUG REAL corrigido aqui (dono, 2026-08-07: "na atualização da
            // lista de cargos ele parece ter deletado uma configuração dos
            // cargos de moderação"): staff_role/supervisor_role eram
            // gravados INCONDICIONALMENTE, sem checagem "in body" — decisão
            // tomada quando esta página tinha um <form> ÚNICO pra tudo (o
            // role-picker em modo chips não renderiza NENHUM <input> quando
            // o usuário remove todos os cargos, então 'staff_role' in body
            // dava false igual num submit de verdade quanto numa ausência
            // de campo; gravar incondicional resolvia isso). Só que a
            // página DEPOIS foi dividida em cards/<form> INDEPENDENTES (ver
            // moderacao.ejs — Cargos de Moderação / Reputação /
            // Personalização, cada um seu próprio POST pra esta MESMA
            // rota), e só o form de Cargos de Moderação tem os role-picker
            // — salvar o form de Reputação OU Personalização mandava um
            // body SEM staff_role/supervisor_role, e a escrita incondicional
            // apagava os dois pra lista vazia a cada save de qualquer OUTRO
            // card. Corrigido com um marcador oculto só nesse form
            // ('roles_form_submitted', ver moderacao.ejs) — presente mesmo
            // quando todos os chips são removidos (resolve o caso original),
            // ausente nos outros 2 forms (resolve o bug novo).
            const toArray = (val) => Array.isArray(val) ? val : (val ? [val] : []);
            if ('roles_form_submitted' in body) {
                {
                    const limit = PremiumSystem.getRoleLimit(guildID, 'moderador');
                    ConfigSystem.setRoleIds(guildID, 'staff_role', toArray(body.staff_role).filter(Boolean).slice(0, limit));
                }
                {
                    const limit = PremiumSystem.getRoleLimit(guildID, 'supervisor');
                    ConfigSystem.setRoleIds(guildID, 'supervisor_role', toArray(body.supervisor_role).filter(Boolean).slice(0, limit));
                }
                // Menção em Reports Abertos (pedido do dono, 2026-08-09;
                // virou multi-cargo até 3 em 2026-08-11, ver fixedLimit em
                // configSystem.js ROLE_TABS) — precisa estar DENTRO deste
                // bloco `roles_form_submitted`, não num `if ('report_mention_role'
                // in body)` solto: agora que é role-picker em modo chips
                // (mesmo componente de staff_role/supervisor_role acima),
                // remover todos os cargos não manda nenhum campo no POST —
                // sem o marcador incondicional, salvar Reputação/
                // Personalização (outros forms desta mesma rota) ficaria
                // impossível de apagar depois de configurado uma vez, mesmo
                // bug original de staff_role/supervisor_role (ver comentário
                // completo em roles_form_submitted acima).
                ConfigSystem.setRoleIds(guildID, 'report_mention_role', toArray(body.report_mention_role).filter(Boolean).slice(0, 3));
            }
            if ('strike_role' in body) ConfigSystem.setSetting(guildID, 'strike_role', body.strike_role || null);
            if ('role_exemplar' in body) ConfigSystem.setSetting(guildID, 'role_exemplar', body.role_exemplar || null);
            if ('role_problematico' in body) ConfigSystem.setSetting(guildID, 'role_problematico', body.role_problematico || null);

            // Divulgação do Servidor (pedido do dono, 2026-08-05; tier-gated
            // em 2026-08-06) NÃO é mais editada por aqui — a partir de
            // 2026-08-06 (seção 113 do PREMIUM.txt) publicar/atualizar é
            // exclusivo do comando /divulgar (garante imagem obrigatória e
            // o limite de 1 publicação por semana, nenhum dos dois
            // reimplementado neste form). moderacao.ejs só lê o estado
            // atual pra mostrar uma prévia (ver partnerNews abaixo).

            // Recuperação diária de reputação + limites Exemplar/Problemático
            // — mesmas regras/faixas válidas do painel /config punishments
            // do Discord (ver configSystem.js processRecoveryModal/
            // processLimitesModal), exclusivo do plano Caçador
            // (automodEnabled). Entrada inválida é ignorada em silêncio, sem
            // travar o resto do form — mesmo padrão já usado abaixo pros
            // campos de Personalização (isValid checks).
            if (PremiumSystem.getGuildLimits(guildID).automodEnabled) {
                if ('rep_recovery_amount' in body) {
                    const amount = parseInt(body.rep_recovery_amount, 10);
                    if (!isNaN(amount) && amount >= 0 && amount <= 100) {
                        ConfigSystem.setSetting(guildID, 'rep_recovery_amount', String(amount));
                    }
                }
                if ('limit_exemplar' in body && 'limit_problematico' in body) {
                    const exemplarLimit = parseInt(body.limit_exemplar, 10);
                    const problematicoLimit = parseInt(body.limit_problematico, 10);
                    const exemplarValid = !isNaN(exemplarLimit) && exemplarLimit >= 50 && exemplarLimit <= 100;
                    const problematicoValid = !isNaN(problematicoLimit) && problematicoLimit >= 0 && problematicoLimit <= 50;
                    if (exemplarValid && problematicoValid && problematicoLimit < exemplarLimit) {
                        ConfigSystem.setSetting(guildID, 'limit_exemplar', String(exemplarLimit));
                        ConfigSystem.setSetting(guildID, 'limit_problematico', String(problematicoLimit));
                    }
                }
            }
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

    // Botão "Resetar Padrão" do card CONFIGURAÇÕES DE REPUTAÇÃO — ação
    // distinta de "Salvar Alterações" (reseta pros 3 valores padrão em vez
    // de gravar o que estiver nos campos), por isso rota própria em vez de
    // mais uma checagem dentro do POST /save de cima. O botão usa
    // formaction/formmethod (ver moderacao.ejs) pra apontar pra cá sem
    // precisar de um <form> aninhado dentro do form principal do card.
    app.post('/moderacao/:guildID/reputation/reset', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.status(404).send('Guild não encontrada.');
        const { isAdmin, apiError } = await resolveAdminMember(guild, req.user.id);
        if (apiError) {
            console.error(`❌ [Dashboard] Falha ao verificar permissão de ${req.user.id} em ${guildID}:`, apiError);
            return res.status(503).send('Não foi possível verificar sua permissão agora (falha temporária do Discord) — tente novamente em instantes.');
        }
        if (!isAdmin) return res.status(403).send('Acesso negado.');
        if (!PremiumSystem.getGuildLimits(guildID).automodEnabled) return res.status(403).send('Recurso exclusivo do plano Caçador.');
        try {
            ConfigSystem.setSetting(guildID, 'limit_exemplar', '95');
            ConfigSystem.setSetting(guildID, 'limit_problematico', '30');
            ConfigSystem.setSetting(guildID, 'rep_recovery_amount', '1');
            res.redirect(`/moderacao/${guildID}?saved=success`);
        } catch (error) {
            console.error('❌ Erro ao resetar limites de reputação:', error);
            res.redirect(`/moderacao/${guildID}?saved=error`);
        }
    });

    // ==================== NÍVEIS DE PUNIÇÃO (CONFIGURAÇÕES DE PUNIÇÕES) ====================
    // CRUD do card de Punições em moderacao.ejs, espelhando o painel
    // /config punishments do Discord (ver configSystem.js
    // handleCreateLevelModal/handleEditLevelModal/handleDeleteLevelButton/
    // handleToggleLevelApproval) em cima do MESMO módulo puro
    // (src/systems/moderation/punishmentLevels.js, sem dependência de
    // discord.js) — fonte única de verdade de validação/limite de tier com
    // o bot. Cada nível é uma entidade própria (criar/editar/deletar/
    // alternar aprovação), por isso ganha rotas dedicadas em vez de entrar
    // no POST /save de cima (que só grava pares chave/valor de `settings`).
    async function resolveLevelsAdmin(req, res, guildID) {
        const guild = client.guilds.cache.get(guildID);
        if (!guild) { res.status(404).send('Guild não encontrada.'); return null; }
        const { isAdmin, apiError } = await resolveAdminMember(guild, req.user.id);
        if (apiError) {
            console.error(`❌ [Dashboard] Falha ao verificar permissão de ${req.user.id} em ${guildID}:`, apiError);
            res.status(503).send('Não foi possível verificar sua permissão agora (falha temporária do Discord) — tente novamente em instantes.');
            return null;
        }
        if (!isAdmin) { res.status(403).send('Acesso negado.'); return null; }
        if (!PremiumSystem.isGuildAtLeast(guildID, 'rastreador')) { res.status(403).send('Recurso exclusivo a partir do plano Rastreador.'); return null; }
        return guild;
    }

    app.post('/moderacao/:guildID/levels/create', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = await resolveLevelsAdmin(req, res, guildID);
        if (!guild) return;
        try {
            if (!PunishmentLevels.canCreateLevel(guildID)) return res.redirect(`/moderacao/${guildID}?saved=error`);
            const { valid, data } = PunishmentLevels.validateLevelInput({
                name: req.body.name,
                severity: req.body.severity,
                points: req.body.points,
                durationStr: req.body.duration_str,
                action: req.body.action,
            });
            if (!valid) return res.redirect(`/moderacao/${guildID}?saved=error`);
            PunishmentLevels.createLevel(guildID, data, req.user.id);
            res.redirect(`/moderacao/${guildID}?saved=success`);
        } catch (error) {
            console.error('❌ Erro ao criar nível de punição:', error);
            res.redirect(`/moderacao/${guildID}?saved=error`);
        }
    });

    app.post('/moderacao/:guildID/levels/:levelId/edit', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID, levelId } = req.params;
        const guild = await resolveLevelsAdmin(req, res, guildID);
        if (!guild) return;
        try {
            if (!PunishmentLevels.getLevel(guildID, levelId)) return res.redirect(`/moderacao/${guildID}?saved=error`);
            const { valid, data } = PunishmentLevels.validateLevelInput({
                name: req.body.name,
                severity: req.body.severity,
                points: req.body.points,
                durationStr: req.body.duration_str,
                action: req.body.action,
            });
            if (!valid) return res.redirect(`/moderacao/${guildID}?saved=error`);
            PunishmentLevels.updateLevel(guildID, levelId, data, req.user.id);
            res.redirect(`/moderacao/${guildID}?saved=success`);
        } catch (error) {
            console.error('❌ Erro ao editar nível de punição:', error);
            res.redirect(`/moderacao/${guildID}?saved=error`);
        }
    });

    app.post('/moderacao/:guildID/levels/:levelId/delete', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID, levelId } = req.params;
        const guild = await resolveLevelsAdmin(req, res, guildID);
        if (!guild) return;
        try {
            PunishmentLevels.deleteLevel(guildID, levelId);
            res.redirect(`/moderacao/${guildID}?saved=success`);
        } catch (error) {
            console.error('❌ Erro ao deletar nível de punição:', error);
            res.redirect(`/moderacao/${guildID}?saved=error`);
        }
    });

    app.post('/moderacao/:guildID/levels/:levelId/toggle-approval', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID, levelId } = req.params;
        const guild = await resolveLevelsAdmin(req, res, guildID);
        if (!guild) return;
        if (!PremiumSystem.getGuildLimits(guildID).customPunishmentApprovalEnabled) return res.status(403).send('Recurso exclusivo do plano Caçador.');
        try {
            const level = PunishmentLevels.getLevel(guildID, levelId);
            if (!level) return res.redirect(`/moderacao/${guildID}?saved=error`);
            PunishmentLevels.setSupervisorApproval(guildID, levelId, !level.requires_supervisor_approval);
            res.redirect(`/moderacao/${guildID}?saved=success`);
        } catch (error) {
            console.error('❌ Erro ao alternar aprovação do nível:', error);
            res.redirect(`/moderacao/${guildID}?saved=error`);
        }
    });

    // ==================== REPORTS (DENÚNCIAS) ====================
    app.get('/reports/:guildID', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.redirect('/dashboard');
        const { member, isAdmin, isStaff, apiError } = await resolveAdminMember(guild, req.user.id);
        if (apiError) {
            console.error(`❌ [Dashboard] Falha ao verificar permissão de ${req.user.id} em ${guildID}:`, apiError);
            return res.status(503).send('Não foi possível verificar sua permissão agora (falha temporária do Discord) — tente novamente em instantes.');
        }
        if (!isStaff) return res.redirect('/dashboard');

        // Animação de indicação no avatar da sidebar — ver mesmo comentário
        // completo em GET /moderacao/:guildID.
        const showAvatarHint = db.incrementDashboardAvatarHintViews(req.user.id) <= 3;

        const pulse = await getServerPulse(guildID, guild);
        const reportsState = parseReportsQueryState(req.query);
        const { openReports, openPagination, closedReports, closedPagination } = getReportsData(guildID, client, reportsState);
        // URL do fragment de poll (ver reports.ejs data-poll-url) já com a
        // página/busca atuais embutidas — sem isso, o refresh de 15s
        // resetaria a seção pra página 1/sem busca a cada poll.
        const reportsFragmentUrl = `/fragments/reports-list/${guildID}${buildReportsQueryString({
            openPage: openPagination.page,
            openSearch: openPagination.search,
            closedPage: closedPagination.page,
            closedSearch: closedPagination.search,
        })}`;

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

        // "Maior cargo dele no Discord" pra quem não é Administrador — ver
        // comentário completo em GET /moderacao/:guildID.
        const role = isAdmin ? 'Administrador' : (highestStaffRoleName(guildID, member) || 'Staff');

        res.render('reports', {
            guild,
            nickname: member.nickname || member.user.username,
            role,
            isAdmin,
            isOwner: isOwnerSession(req),
            pageRoute: 'reports',
            otherGuilds: await getAdminGuildsWithBot(req),
            showAvatarHint,
            pulse,
            openReports,
            openPagination,
            closedReports,
            closedPagination,
            reportsFragmentUrl,
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
        safeUpload(upload.single('report_chat_banner_file'), (req) => `/reports/${req.params.guildID}?saved=error`),
        async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.status(404).send('Guild não encontrada.');
        const { member, isAdmin, apiError } = await resolveAdminMember(guild, req.user.id);
        if (apiError) {
            console.error(`❌ [Dashboard] Falha ao verificar permissão de ${req.user.id} em ${guildID}:`, apiError);
            return res.status(503).send('Não foi possível verificar sua permissão agora (falha temporária do Discord) — tente novamente em instantes.');
        }
        if (!isAdmin) return res.status(403).send('Acesso negado.');

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
        const { member, isAdmin, isStaff, apiError } = await resolveAdminMember(guild, req.user.id);
        if (apiError) {
            console.error(`❌ [Dashboard] Falha ao verificar permissão de ${req.user.id} em ${guildID}:`, apiError);
            return res.status(503).send('Não foi possível verificar sua permissão agora (falha temporária do Discord) — tente novamente em instantes.');
        }
        if (!isStaff) return res.redirect('/dashboard');

        // Animação de indicação no avatar da sidebar — ver mesmo comentário
        // completo em GET /moderacao/:guildID.
        const showAvatarHint = db.incrementDashboardAvatarHintViews(req.user.id) <= 3;

        const pulse = await getServerPulse(guildID, guild, 'eventos');

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
        // Mesmo limite por tier já usado no painel /config roles do Discord e
        // em Moderação (ver configSystem.js ROLE_TABS.events.fields[*].
        // roleLimitKey) — decide select simples vs chips em role-picker.ejs.
        const eventRoleLimits = {
            event: PremiumSystem.getRoleLimit(guildID, 'event'),
            eventNotify: PremiumSystem.getRoleLimit(guildID, 'eventNotify'),
        };

        // "Maior cargo dele no Discord" pra quem não é Administrador — ver
        // comentário completo em GET /moderacao/:guildID.
        const role = isAdmin ? 'Administrador' : (highestStaffRoleName(guildID, member) || 'Staff');

        res.render('events', {
            guild,
            nickname: member.nickname || member.user.username,
            role,
            isAdmin,
            isOwner: isOwnerSession(req),
            pageRoute: 'events',
            otherGuilds: await getAdminGuildsWithBot(req),
            showAvatarHint,
            pulse,
            happeningNow,
            scheduledEvents,
            settings,
            roles,
            channels,
            eventRoleIds,
            eventNotifyRoleIds,
            eventRoleLimits,
            isCacador: PremiumSystem.isGuildAtLeast(guildID, 'cacador'),
            saved: req.query.saved,
        });
    });

    app.post('/events/:guildID/save', checkAuth, async (req, res) => {
        if (isDashboardLocked(req)) return res.redirect('/dashboard');
        const { guildID } = req.params;
        const guild = client.guilds.cache.get(guildID);
        if (!guild) return res.status(404).send('Guild não encontrada.');
        const { member, isAdmin, apiError } = await resolveAdminMember(guild, req.user.id);
        if (apiError) {
            console.error(`❌ [Dashboard] Falha ao verificar permissão de ${req.user.id} em ${guildID}:`, apiError);
            return res.status(503).send('Não foi possível verificar sua permissão agora (falha temporária do Discord) — tente novamente em instantes.');
        }
        if (!isAdmin) return res.status(403).send('Acesso negado.');

        try {
            // event_role/event_notify_role agora aceitam mais de um cargo em
            // planos Rastreador/Caçador (role-picker.ejs, mesmo padrão de
            // staff_role/supervisor_role em Moderação) — antes vinha sempre
            // como valor único ([event_role]), truncando silenciosamente pra
            // 1 cargo mesmo quando o tier configurado pelo Discord (/config
            // roles) permitia mais. Limite reaplicado aqui (defesa em
            // profundidade, mesmo motivo do bloco de Moderação).
            const { event_announce_channel } = req.body;
            const toArray = (val) => Array.isArray(val) ? val : (val ? [val] : []);
            const eventLimit = PremiumSystem.getRoleLimit(guildID, 'event');
            const eventNotifyLimit = PremiumSystem.getRoleLimit(guildID, 'eventNotify');
            ConfigSystem.setRoleIds(guildID, 'event_role', toArray(req.body.event_role).filter(Boolean).slice(0, eventLimit));
            ConfigSystem.setRoleIds(guildID, 'event_notify_role', toArray(req.body.event_notify_role).filter(Boolean).slice(0, eventNotifyLimit));
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