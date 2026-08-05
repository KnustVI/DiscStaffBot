// src/systems/news/generalNewsSystem.js
/**
 * "Novidades" gerais de Path of Titans na página inicial (home, pedido do
 * dono 2026-08-05, migrado de /perfil pra home em 2026-08-06) — busca os
 * vídeos mais recentes do canal oficial no YouTube. Fonte única por
 * enquanto, mas o formato de item devolvido (`source: 'youtube'`) já
 * deixa espaço pra outras fontes no futuro sem precisar mudar quem
 * consome (ver dashboard.js GET /, hero.ejs).
 *
 * Precisa de duas variáveis de ambiente (opcionais — sem elas, devolve
 * lista vazia e hero.ejs mostra "em breve", sem quebrar nada):
 *   YOUTUBE_API_KEY     — chave da YouTube Data API v3 (Google Cloud Console)
 *   YOUTUBE_CHANNEL_ID  — ID do canal (começa com "UC...") OU handle (@algo)
 *
 * Cache em memória (sem tabela nova no banco) — os vídeos não mudam com
 * frequência a ponto de justificar buscar de novo a cada carregamento de
 * página; evita gastar cota da API à toa e deixa o /perfil rápido na
 * maioria das requisições. Em caso de falha da API, devolve o cache
 * antigo (se existir) em vez de lista vazia — melhor mostrar algo um
 * pouco desatualizado do que sumir com a seção por uma falha passageira.
 */
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 horas
const MAX_RESULTS = 6;
// Quantos itens crus pedir da playlist de uploads ANTES de filtrar Shorts
// (pedido do dono, 2026-08-05: "tem mais shorts do que vídeos, é possível
// ter vídeos comuns também?") — precisa de folga porque parte vai ser
// descartada; 30 cabe numa chamada só (limite da API é 50) e cobre até
// canais que postam Shorts com bastante frequência.
const PLAYLIST_FETCH_SIZE = 30;
// Sem campo oficial "é Short" na API — mesmo critério de duração que a
// comunidade usa há anos (Shorts clássicos são ≤60s). A duração MÁXIMA
// técnica do formato subiu pra 3min em 2024, mas na prática a esmagadora
// maioria continua bem curta, então esse corte já resolve o problema real
// sem descartar vídeos comuns por engano.
const SHORTS_MAX_SECONDS = 60;

let cache = { items: [], fetchedAt: 0 };

function isRawChannelId(value) {
    return /^UC[\w-]{22}$/.test(value);
}

// channels.list (1 unidade de cota) — resolve a playlist de uploads do
// canal, aceita tanto o ID cru quanto um handle (@algo). Evita usar
// search.list (100 unidades por chamada) só pra listar os últimos vídeos.
async function resolveUploadsPlaylistId(channelRef, apiKey) {
    const param = isRawChannelId(channelRef)
        ? `id=${encodeURIComponent(channelRef)}`
        : `forHandle=${encodeURIComponent(channelRef.startsWith('@') ? channelRef : `@${channelRef}`)}`;
    const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&${param}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`channels.list falhou (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null;
}

// videos.list (1 unidade de cota, não importa quantos IDs — até 50 por
// chamada) — duração de cada vídeo (pra filtrar Shorts, ver
// SHORTS_MAX_SECONDS acima) E contagem de visualizações (pedido do dono,
// 2026-08-05: formato igual ao mockup, "45 mil visualizações") — as duas
// vêm dessa MESMA chamada (part=contentDetails,statistics), sem gastar
// cota extra. playlistItems.list não devolve nenhuma das duas.
async function fetchVideoDetails(videoIds, apiKey) {
    if (videoIds.length === 0) return new Map();
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${videoIds.map(encodeURIComponent).join(',')}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`videos.list falhou (${res.status}): ${await res.text()}`);
    const data = await res.json();
    const map = new Map();
    for (const item of (data.items || [])) {
        map.set(item.id, {
            durationSeconds: parseISODurationSeconds(item.contentDetails?.duration),
            viewCount: parseInt(item.statistics?.viewCount, 10) || 0,
        });
    }
    return map;
}

// Formato ISO 8601 que a API devolve pra duração (ex: "PT7M36S" = 7min
// 36s, "PT45S" = 45s, "PT1H2M3S" = 1h2min3s) — qualquer parte pode faltar.
function parseISODurationSeconds(iso) {
    const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
    if (!match) return 0;
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);
    return hours * 3600 + minutes * 60 + seconds;
}

// "7:36" / "1:02:03" — mesmo selo de duração mostrado no canto da miniatura
// no próprio YouTube (e na referência de mockup que o dono mandou).
function formatDurationLabel(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
    const ss = String(seconds).padStart(2, '0');
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

// "45 mil" / "1,2 mi" — mesma abreviação usada pelo YouTube em PT-BR
// (pedido do dono, 2026-08-05, formato do mockup: "45 mil visualizações").
function formatViewCount(count) {
    const n = Number(count) || 0;
    if (n >= 1000000) {
        const v = n / 1000000;
        return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1).replace('.', ',')} mi`;
    }
    if (n >= 1000) {
        const v = n / 1000;
        return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1).replace('.', ',')} mil`;
    }
    return String(n);
}

// playlistItems.list (1 unidade de cota) — pega um lote maior de vídeos
// recentes (PLAYLIST_FETCH_SIZE), busca a duração de todos numa chamada só
// de videos.list, descarta os Shorts (≤60s) e devolve só os MAX_RESULTS
// vídeos comuns mais recentes que sobrarem.
async function fetchLatestVideos(playlistId, apiKey) {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}&maxResults=${PLAYLIST_FETCH_SIZE}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`playlistItems.list falhou (${res.status}): ${await res.text()}`);
    const data = await res.json();

    const candidates = (data.items || [])
        .map((item) => {
            const s = item.snippet || {};
            const videoId = s.resourceId?.videoId;
            const thumbnailUrl = s.thumbnails?.medium?.url || s.thumbnails?.default?.url || null;
            if (!videoId || !thumbnailUrl) return null; // vídeo privado/removido ainda listado na playlist
            return { videoId, title: s.title, thumbnailUrl, publishedAt: s.publishedAt };
        })
        .filter(Boolean);
    if (candidates.length === 0) return [];

    const details = await fetchVideoDetails(candidates.map((c) => c.videoId), apiKey);

    return candidates
        .map((c) => ({ ...c, ...(details.get(c.videoId) || { durationSeconds: 0, viewCount: 0 }) }))
        .filter((c) => c.durationSeconds > SHORTS_MAX_SECONDS)
        .slice(0, MAX_RESULTS)
        .map((c) => ({
            source: 'youtube',
            title: c.title,
            url: `https://www.youtube.com/watch?v=${c.videoId}`,
            thumbnailUrl: c.thumbnailUrl,
            publishedAtLabel: formatRelativeDate(c.publishedAt),
            durationLabel: formatDurationLabel(c.durationSeconds),
            viewCountLabel: formatViewCount(c.viewCount),
        }));
}

function formatRelativeDate(isoString) {
    const diffDays = Math.floor((Date.now() - new Date(isoString).getTime()) / 86400000);
    if (diffDays < 1) return 'hoje';
    if (diffDays === 1) return 'há 1 dia';
    if (diffDays < 7) return `há ${diffDays} dias`;
    const weeks = Math.floor(diffDays / 7);
    if (weeks < 5) return weeks === 1 ? 'há 1 semana' : `há ${weeks} semanas`;
    const months = Math.floor(diffDays / 30);
    if (months < 12) return months === 1 ? 'há 1 mês' : `há ${months} meses`;
    const years = Math.floor(diffDays / 365);
    return years === 1 ? 'há 1 ano' : `há ${years} anos`;
}

/**
 * @returns {Promise<Array<{source: string, title: string, url: string, thumbnailUrl: string, publishedAtLabel: string, durationLabel: string, viewCountLabel: string}>>}
 */
async function getGeneralNews() {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const channelRef = process.env.YOUTUBE_CHANNEL_ID;
    if (!apiKey || !channelRef) return [];

    if (cache.items.length > 0 && (Date.now() - cache.fetchedAt) < CACHE_TTL_MS) {
        return cache.items;
    }

    try {
        const uploadsPlaylistId = await resolveUploadsPlaylistId(channelRef, apiKey);
        if (!uploadsPlaylistId) return cache.items;
        const items = await fetchLatestVideos(uploadsPlaylistId, apiKey);
        cache = { items, fetchedAt: Date.now() };
        return items;
    } catch (error) {
        console.error('❌ [Novidades] Erro ao buscar vídeos do YouTube:', error.message);
        return cache.items;
    }
}

module.exports = { getGeneralNews };
