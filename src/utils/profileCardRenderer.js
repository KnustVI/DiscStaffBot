// src/utils/profileCardRenderer.js
/**
 * Gera o card de perfil (banner do /perfil) — moldura/foto vêm do path real
 * exportado do Figma em assets/cards/{tier}.svg (só a moldura é extraída do
 * SVG, clip-path da foto; nada mais do arquivo é rasterizado), o resto do
 * card (filete metálico, estrelas, emblemas, pílula de espécie, coluna de
 * identidade) é desenhado com @napi-rs/canvas. Layout espelha o card novo
 * do site (web/views/perfil.ejs, .pf-id-card) — mesmo path de moldura, mesma
 * técnica de "cópia maior/menor da mesma forma" pro filete/estrelas.
 *
 * Sem barra de XP/Caçadas e sem Premium Tier no card (pedido do dono) — só
 * nickname, título, Alderon ID e cargo de staff (condicional).
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { createCanvas, GlobalFonts, loadImage, Path2D } = require('@napi-rs/canvas');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const FONTS_DIR = path.join(PROJECT_ROOT, 'assets', 'fonts');
const CARDS_DIR = path.join(PROJECT_ROOT, 'assets', 'cards');
const ICONS_DIR = path.join(PROJECT_ROOT, 'assets', 'icons');

GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'TiltWarp.ttf'), 'Tilt Warp');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Poppins-Medium.ttf'), 'Poppins Medium');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Poppins-SemiBold.ttf'), 'Poppins SemiBold');

const TIER_FILES = {
    free: 'free.svg',
    compy: 'compy.svg',
    raptor: 'raptor.svg',
};

const SCALE = 2; // upscala o card (rasterizado em escala nativa) pra sair nítido

// Paleta por tier (mesmos valores do rascunho/card do site — filete
// metálico + cores da pílula de espécie).
const TIER_PALETTE = {
    free: { a: '#A6917D', b: '#F8DCC0', text: '#1F1D20', accent: '#F8DCC0', rimDark: '#A6917D', rimMid: '#F8DCC0', rimLight: '#FFF8EF' },
    compy: { a: '#A25E2D', b: '#DCA15E', text: '#F8DCC0', accent: '#FFAB4C', rimDark: '#8C5E2A', rimMid: '#FFAB4C', rimLight: '#FFD9AE' },
    raptor: { a: '#4B2427', b: '#803E30', text: '#DCA15E', accent: '#DE6045', rimDark: '#7A3526', rimMid: '#E89078', rimLight: '#F0B7AB' },
};

// Foto encolhe 20% (pedido do dono: mais espaço de fundo visível), ancorada
// no canto superior-esquerdo da moldura — mesma técnica do card do site.
const PHOTO_SHRINK = 0.8;

// Sombra dupla ("glow") pro nickname/título/linhas de identificação —
// necessário porque esse trecho do card fica fora da moldura preenchida,
// então quando há plano de fundo (foto) atrás, precisa de mais contraste
// pra continuar legível. Duas sombras diagonais opostas em vez de uma
// única sombra simples — mais evidente contra qualquer fundo.
function drawWithGlow(ctx, drawFn) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 5 * SCALE;
    ctx.shadowOffsetX = -5 * SCALE;
    ctx.shadowOffsetY = -5 * SCALE;
    drawFn();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowOffsetX = 5 * SCALE;
    ctx.shadowOffsetY = 5 * SCALE;
    drawFn();
    ctx.restore();
    drawFn(); // desenho final nítido, sem sombra, por cima das 2 sombras
}

// Sombra pra ícones pequenos e isolados (emblemas, ícone de espécie, ícones
// das linhas de identidade) — a dupla acima usa offset de ±5*SCALE, pensado
// pro texto grande; num ícone de ~20-24px isso "descola" a sombra em dois
// blobs separados em vez de um contorno colado. Uma única sombra próxima
// resolve.
function drawIconShadow(ctx, drawFn) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 5 * SCALE;
    ctx.shadowOffsetX = 2 * SCALE;
    ctx.shadowOffsetY = 3 * SCALE;
    drawFn();
    ctx.restore();
}

// ==================== estrelas — pré-rasterizadas uma vez ====================

let starImagesPromise = null;
function loadStarImages() {
    if (!starImagesPromise) {
        starImagesPromise = Promise.all([
            sharp(path.join(CARDS_DIR, 'star-full.svg')).png().toBuffer().then(loadImage),
            sharp(path.join(CARDS_DIR, 'star-empty.svg')).png().toBuffer().then(loadImage),
        ]);
    }
    return starImagesPromise;
}

// ==================== moldura por tier — path real do Figma ====================

async function bboxOfPath(d, viewW, viewH, style = 'fill="#ffffff"') {
    const svg = `<svg width="${viewW}" height="${viewH}" xmlns="http://www.w3.org/2000/svg"><path d="${d}" ${style}/></svg>`;
    const { info } = await sharp(Buffer.from(svg)).extractChannel(3).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
    return {
        x: info.trimOffsetLeft !== undefined ? -info.trimOffsetLeft : 0,
        y: info.trimOffsetTop !== undefined ? -info.trimOffsetTop : 0,
        width: info.width,
        height: info.height,
    };
}

// Mesma técnica acima, só que num PNG já renderizado (canal alfa) em vez de
// SVG cru — usada pra cortar o canvas do tier Free (sem plano de fundo) no
// tamanho exato do conteúdo real.
async function bboxOfPng(buffer) {
    const { info } = await sharp(buffer).extractChannel(3).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
    return {
        x: info.trimOffsetLeft !== undefined ? -info.trimOffsetLeft : 0,
        y: info.trimOffsetTop !== undefined ? -info.trimOffsetTop : 0,
        width: info.width,
        height: info.height,
    };
}

// Só extrai o path da moldura (clip-path da foto) — o resto do card antigo
// (texto/pílulas vetorizados do Figma) não é mais usado, o layout novo
// desenha tudo do zero. Cacheado por tier (só 3 valores possíveis) pelo
// tempo de vida do processo, mesmo motivo de antes: assets/cards/ só muda
// num deploy, que já reinicia o processo.
const frameCache = new Map();
function loadFrame(tier) {
    const key = TIER_FILES[tier] ? tier : 'free';
    if (!frameCache.has(key)) {
        const promise = (async () => {
            const svgPath = path.join(CARDS_DIR, TIER_FILES[key]);
            const svg = fs.readFileSync(svgPath, 'utf8');
            const [, viewWStr, viewHStr] = svg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/) || [null, '800', '430'];
            const viewW = Number(viewWStr);
            const viewH = Number(viewHStr);
            // Detecção ESTRUTURAL (grupo com filtro de sombra dupla+inner
            // shadow), não pelo valor do fill — versões do Figma variam o
            // fill desse path (máscara invisível ou preview pattern), só o
            // "d" importa de verdade (clip-path pra foto real).
            const frameMatch = svg.match(/<g filter="url\(#filter\d+_ddi[^)]*\)">\s*<path d="(M[^"]+)"[^>]*\/>/);
            if (!frameMatch) throw new Error('profileCardRenderer: moldura (frame path) não encontrada no SVG');
            const frameD = frameMatch[1];
            const frameBbox = await bboxOfPath(frameD, viewW, viewH);
            return { viewW, viewH, frameD, frameBbox };
        })();
        promise.catch(() => frameCache.delete(key));
        frameCache.set(key, promise);
    }
    return frameCache.get(key);
}

// ==================== render principal ====================

/**
 * @param {object} opts
 * @param {'free'|'compy'|'raptor'} opts.tier
 * @param {Buffer} opts.photoBuffer - bytes da foto (qualquer formato que o sharp leia)
 * @param {Buffer|null} [opts.backgroundBuffer] - bytes do plano de fundo (opcional).
 *   Quando presente, o canvas final fica no tamanho EXATO do card (mesma
 *   resolução nativa) — o plano de fundo cobre esse canvas inteiro (cover
 *   fit) e funciona como o fundo do próprio card. Cantos arredondados +
 *   sombra projetada na composição final.
 *   Quando AUSENTE (sempre o caso do tier Free — "não tem fundo, pedido do
 *   dono"), o canvas não fica no tamanho fixo do card: é cortado pro
 *   tamanho real do conteúdo (foto+emblemas+pílula+coluna de texto), com
 *   5px de margem em cima/embaixo — largura continua fixa.
 * @param {string} opts.nickname
 * @param {string} opts.alderonId
 * @param {string} opts.titleLabel
 * @param {string} opts.speciesLabel
 * @param {boolean} [opts.isCarnivore] - dieta da espécie mais jogada (ver
 *   PlayerRegistry.isDinosaurCarnivore) — decide CarniSkull vs HerbSkull.
 * @param {number} opts.honorStars - 0 a 5
 * @param {boolean} [opts.isStaff] - true quando o jogador tem cargo de staff
 *   configurado NESTE servidor (ver ConfigSystem.memberHasAnyStaffRole) —
 *   decide se a linha de cargo aparece.
 * @param {string} [opts.staffLabel] - categoria(s) de staff (ver
 *   ConfigSystem.staffRoleCategoryLabel) — só usado quando isStaff.
 * @param {Buffer[]} [opts.badges] - bytes de cada emblema conquistado
 *   (ProfileImagePool.resolveImageBuffer tipo 'badge') — até 4 exibidos.
 * @returns {Promise<Buffer>} PNG pronto (card, ou card+plano de fundo compostos)
 */
async function renderProfileCard({ tier, photoBuffer, backgroundBuffer, nickname, alderonId, titleLabel, speciesLabel, isCarnivore, honorStars, isStaff, staffLabel, badges }) {
    const palette = TIER_PALETTE[tier] || TIER_PALETTE.free;
    const { viewW, viewH, frameD, frameBbox } = await loadFrame(tier);

    const canvas = createCanvas(viewW * SCALE, viewH * SCALE);
    const ctx = canvas.getContext('2d');

    // Box da foto JÁ reduzida (20%), em pixels nativos (escala aplicada na
    // mão em todo o resto da função — sem ctx.scale global, pra não
    // interferir com os offsets de sombra já em pixels de drawWithGlow
    // acima). Fixo no canto superior-esquerdo da moldura original.
    const scaledBbox = {
        x: frameBbox.x * SCALE,
        y: frameBbox.y * SCALE,
        width: frameBbox.width * SCALE * PHOTO_SHRINK,
        height: frameBbox.height * SCALE * PHOTO_SHRINK,
    };

    // ── Moldura + filete metálico + foto — path2D nas coordenadas RAW do
    // SVG (viewBox), por isso SÓ este bloco entra num ctx.scale(SCALE)
    // próprio (restaurado no fim); desenha a MESMA forma da moldura (sem
    // reaproximar), com uma escala extra ancorada no canto superior-
    // esquerdo pra encolher a foto sem mover sua posição. ─────────────────
    ctx.save();
    ctx.scale(SCALE, SCALE);
    ctx.translate(frameBbox.x, frameBbox.y);
    ctx.scale(PHOTO_SHRINK, PHOTO_SHRINK);
    ctx.translate(-frameBbox.x, -frameBbox.y);

    // Filete metálico (cópia da MESMA forma, um pouco maior, atrás da
    // foto) — desenhado ANTES de qualquer clip() pra sombra/brilho não
    // ficarem cortados junto.
    const rimPath = new Path2D(frameD);
    ctx.save();
    ctx.translate(frameBbox.x + frameBbox.width / 2, frameBbox.y + frameBbox.height / 2);
    ctx.scale(1.018, 1.018);
    ctx.translate(-(frameBbox.x + frameBbox.width / 2), -(frameBbox.y + frameBbox.height / 2));
    const rimGrad = ctx.createLinearGradient(frameBbox.x, frameBbox.y, frameBbox.x + frameBbox.width, frameBbox.y + frameBbox.height);
    rimGrad.addColorStop(0, palette.rimLight);
    rimGrad.addColorStop(0.2, palette.rimMid);
    rimGrad.addColorStop(0.38, palette.rimDark);
    rimGrad.addColorStop(0.52, palette.rimLight);
    rimGrad.addColorStop(0.68, palette.rimDark);
    rimGrad.addColorStop(0.85, palette.rimMid);
    rimGrad.addColorStop(1, palette.rimLight);
    ctx.fillStyle = rimGrad;
    ctx.shadowColor = palette.accent;
    ctx.shadowBlur = 6;
    ctx.fill(rimPath);
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 6;
    ctx.fill(rimPath);
    ctx.restore();

    // Foto — clip na forma real, foto "cover".
    const framePath = new Path2D(frameD);
    ctx.save();
    ctx.clip(framePath);
    const photo = await loadImage(await sharp(photoBuffer).rotate().resize(Math.round(frameBbox.width), Math.round(frameBbox.height), { fit: 'cover' }).png().toBuffer());
    ctx.drawImage(photo, frameBbox.x, frameBbox.y, frameBbox.width, frameBbox.height);
    ctx.restore();

    ctx.restore(); // fecha o scale(PHOTO_SHRINK)
    ctx.restore(); // fecha o scale(SCALE) deste bloco

    // ── Estrelas de honra — ancoradas no canto inferior-esquerdo da foto
    // já reduzida. ──────────────────────────────────────────────────────
    const [starFull, starEmpty] = await loadStarImages();
    const starSize = 30 * PHOTO_SHRINK * SCALE;
    const starsY = scaledBbox.y + scaledBbox.height - 18 * PHOTO_SHRINK * SCALE;
    for (let i = 0; i < 5; i++) {
        const img = i < honorStars ? starFull : starEmpty;
        ctx.drawImage(img, scaledBbox.x + 14 * PHOTO_SHRINK * SCALE + i * (starSize + 4 * PHOTO_SHRINK * SCALE), starsY - starSize / 2, starSize, starSize);
    }

    // ── Emblemas conquistados — DENTRO do recorte/chanfro do canto
    // inferior-direito da moldura (mesmo lugar do card do site, mesma
    // "prateleira" a ~84% da altura do frame nas 3 tiers) — PNG sem fundo,
    // sombra preta simples (sem glow). Até 4, mesmo dado real do card do
    // site (ownedItems tipo 'badge'). ───────────────────────────────────
    const badgeSize = 22 * SCALE;
    const badgesY = scaledBbox.y + scaledBbox.height * 0.84 + 12 * SCALE;
    let bx = scaledBbox.x + scaledBbox.width - badgeSize;
    const badgeImages = await Promise.all((badges || []).slice(0, 4).map((buf) => loadImage(buf)));
    for (const badgeImg of badgeImages) {
        drawIconShadow(ctx, () => ctx.drawImage(badgeImg, bx, badgesY, badgeSize, badgeSize));
        bx -= badgeSize + 8 * SCALE;
    }

    // ── Pílula de espécie — direto abaixo da foto (18px de respiro, mesma
    // margem do card do site), largura igual à foto reduzida. ──────────
    const pillY = scaledBbox.y + scaledBbox.height + 18 * SCALE;
    const pillH = 40 * SCALE;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(scaledBbox.x, pillY, scaledBbox.width, pillH, 8 * SCALE);
    const pillGrad = ctx.createLinearGradient(scaledBbox.x, pillY, scaledBbox.x, pillY + pillH);
    pillGrad.addColorStop(0.47, palette.a);
    pillGrad.addColorStop(1, palette.b);
    ctx.fillStyle = pillGrad;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 7 * SCALE;
    ctx.shadowOffsetX = 7 * SCALE;
    ctx.shadowOffsetY = 9 * SCALE;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1 * SCALE;
    ctx.stroke();
    ctx.restore();

    const speciesIcon = await loadImage(path.join(ICONS_DIR, isCarnivore ? 'CarniSkull.webp' : 'HerbSkull.webp'));
    drawIconShadow(ctx, () => ctx.drawImage(speciesIcon, scaledBbox.x + 10 * SCALE, pillY + (pillH - 24 * SCALE) / 2, 24 * SCALE, 24 * SCALE));
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${15 * SCALE}px "Tilt Warp"`;
    ctx.fillStyle = palette.text;
    ctx.fillText((speciesLabel || '').toUpperCase(), scaledBbox.x + 42 * SCALE, pillY + pillH / 2 + 1 * SCALE);

    // ── Coluna de identidade — nickname/título + linhas com ícone, colada
    // na foto já reduzida com 24px de margem (mesma margem do card do
    // site entre a coluna da foto e a coluna de texto). Sem Premium Tier
    // (removido do grupo); cargo de staff só aparece se isStaff. ───────
    const infoX = scaledBbox.x + scaledBbox.width + 24 * SCALE;
    let cy = frameBbox.y * SCALE;
    ctx.fillStyle = '#F8DCC0'; // nickname sempre cream, não segue a cor por tier
    ctx.font = `${34 * SCALE}px "Tilt Warp"`;
    ctx.textBaseline = 'alphabetic';
    drawWithGlow(ctx, () => ctx.fillText((nickname || '').toUpperCase(), infoX, cy + 30 * SCALE));
    cy += 42 * SCALE;
    ctx.font = `${15 * SCALE}px "Poppins Medium"`;
    ctx.fillStyle = '#F8DCC0';
    drawWithGlow(ctx, () => ctx.fillText(titleLabel || '', infoX, cy + 14 * SCALE));
    cy += 32 * SCALE;

    const rows = [{ icon: 'logopot.webp', text: alderonId || '' }];
    if (isStaff && staffLabel) {
        rows.push({ icon: 'DiscordLOGO.webp', text: staffLabel });
    }
    for (const row of rows) {
        const icon = await loadImage(path.join(ICONS_DIR, row.icon));
        drawIconShadow(ctx, () => ctx.drawImage(icon, infoX, cy, 24 * SCALE, 24 * SCALE));
        ctx.font = `${16 * SCALE}px "Poppins SemiBold"`;
        ctx.fillStyle = '#F8DCC0';
        drawWithGlow(ctx, () => ctx.fillText(row.text, infoX + 32 * SCALE, cy + 17 * SCALE));
        cy += 40 * SCALE;
    }

    if (!backgroundBuffer) {
        // Tier Free (sem plano de fundo, pedido do dono) — corta o canvas
        // fixo pro tamanho REAL do conteúdo (largura continua fixa) em vez
        // de devolver o card com um monte de transparência sobrando
        // embaixo, já que não tem mais barra de XP/Caçadas nem foto atrás.
        const fullBuffer = canvas.toBuffer('image/png');
        const contentBox = await bboxOfPng(fullBuffer);
        const marginPx = 5 * SCALE;
        const outHeightPx = contentBox.height + marginPx * 2;
        const finalCanvas = createCanvas(canvas.width, outHeightPx);
        const fctx = finalCanvas.getContext('2d');
        const fullImg = await loadImage(fullBuffer);
        fctx.drawImage(fullImg, 0, contentBox.y, canvas.width, contentBox.height, 0, marginPx, canvas.width, contentBox.height);
        return finalCanvas.toBuffer('image/png');
    }

    // ── Plano de fundo full-bleed atrás do card inteiro ────────────────────
    // Canvas final no tamanho EXATO do card (mesma resolução nativa, sem
    // caixa custom separada) — o plano de fundo cobre esse canvas inteiro
    // (sem escalar/reposicionar) — só aparece nos espaços transparentes que
    // o próprio card já tem.
    const FINAL_W = canvas.width;
    const FINAL_H = canvas.height;
    const CARD_W = canvas.width;
    const CARD_H = canvas.height;
    const cardX = 0;
    const cardY = 0;

    let bgRotated;
    try {
        bgRotated = await sharp(backgroundBuffer).rotate().resize(FINAL_W, FINAL_H, { fit: 'cover', position: 'centre' }).png().toBuffer();
    } catch (error) {
        // Plano de fundo corrompido/formato não suportado — degrada pro card sozinho.
        console.error('❌ [ProfileCardRenderer] Erro ao processar plano de fundo, seguindo sem ele:', error.message);
        return canvas.toBuffer('image/png');
    }
    const bgImage = await loadImage(bgRotated);

    const finalCanvas = createCanvas(FINAL_W, FINAL_H);
    const fctx = finalCanvas.getContext('2d');
    // Cantos arredondados na imagem final inteira — clip aplicado ANTES de
    // desenhar qualquer coisa, então cobre plano de fundo + escurecida +
    // card + sombra de uma vez, sem precisar recortar cada camada.
    const CORNER_RADIUS = Math.round(20 * (FINAL_W / 800));
    fctx.save();
    fctx.beginPath();
    fctx.roundRect(0, 0, FINAL_W, FINAL_H, CORNER_RADIUS);
    fctx.clip();

    fctx.drawImage(bgImage, 0, 0);
    // Leve escurecida — sem isso, um plano de fundo muito claro/colorido
    // compete visualmente com o card por cima.
    fctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    fctx.fillRect(0, 0, FINAL_W, FINAL_H);

    // Sombra projetada em cima do CONTORNO real do card (via canal alfa do
    // canvas do card) — não uma sombra "no olho" desenhada por cima de uma
    // forma fixa, então acompanha automaticamente qualquer ajuste futuro
    // de layout do card.
    fctx.save();
    fctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    fctx.shadowBlur = 22 * SCALE;
    fctx.shadowOffsetX = 0;
    fctx.shadowOffsetY = 6 * SCALE;
    fctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, cardX, cardY, CARD_W, CARD_H);
    fctx.restore(); // fecha o save() da sombra

    fctx.restore(); // fecha o save() do clip de cantos arredondados

    return finalCanvas.toBuffer('image/png');
}

module.exports = { renderProfileCard };
