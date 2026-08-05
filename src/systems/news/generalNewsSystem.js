// src/systems/news/generalNewsSystem.js
/**
 * "Novidades" gerais de Path of Titans na página web /perfil (pedido do
 * dono, 2026-08-05) — busca os vídeos mais recentes do canal oficial no
 * YouTube. Fonte única por enquanto, mas o formato de item devolvido
 * (`source: 'youtube'`) já deixa espaço pra outras fontes no futuro sem
 * precisar mudar quem consome (ver dashboard.js GET /perfil, perfil.ejs).
 *
 * Precisa de duas variáveis de ambiente (opcionais — sem elas, devolve
 * lista vazia e perfil.ejs mostra "em breve", sem quebrar nada):
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

// playlistItems.list (1 unidade de cota) — os vídeos mais recentes da
// playlist de uploads, já na ordem certa (mais novo primeiro) sem
// precisar ordenar aqui.
async function fetchLatestVideos(playlistId, apiKey) {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}&maxResults=${MAX_RESULTS}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`playlistItems.list falhou (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return (data.items || [])
        .map((item) => {
            const s = item.snippet || {};
            const videoId = s.resourceId?.videoId;
            const thumbnailUrl = s.thumbnails?.medium?.url || s.thumbnails?.default?.url || null;
            if (!videoId || !thumbnailUrl) return null; // vídeo privado/removido ainda listado na playlist
            return {
                source: 'youtube',
                title: s.title,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                thumbnailUrl,
                publishedAtLabel: formatRelativeDate(s.publishedAt),
            };
        })
        .filter(Boolean);
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
 * @returns {Promise<Array<{source: string, title: string, url: string, thumbnailUrl: string, publishedAtLabel: string}>>}
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
