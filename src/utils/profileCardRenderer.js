// src/utils/profileCardRenderer.js
/**
 * Gera o card de perfil (banner do /perfil) a partir dos SVGs reais
 * exportados do Figma em assets/cards/{tier}.svg — moldura, sombra e badges
 * vêm 100% desses arquivos, sem redesenho (a fileira de 6 ícones de missão
 * do Figma é removida do render — ver stripMissionIcons — até o sistema de
 * emblemas/missões existir de verdade). Este módulo só substitui as partes
 * que precisam ser dinâmicas por jogador:
 *
 *  - a foto (recortada exatamente na moldura recortada do card);
 *  - as 5 estrelas de honra (troca cheia/vazia pela contagem real);
 *  - os textos das 3 badges (Título/Nível/Espécie) e do nome/identificação,
 *    que no Figma saem como texto convertido em vetor (não editável).
 *
 * O texto original do Figma é removido do SVG e redesenhado com
 * @napi-rs/canvas nas MESMAS posições/cores, extraídas do próprio arquivo —
 * nada de coordenada fixa "no olho": ver extractCardMeta().
 *
 * O gradiente dourado das estrelas do Figma usa um truque (foreignObject +
 * mix-blend-mode) que o librsvg (usado pelo sharp pra rasterizar o SVG) não
 * suporta — por isso as estrelas têm arte própria em assets/cards/star-*.svg
 * (mesmo formato, gradiente reconstruído com um <linearGradient> padrão).
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const FONTS_DIR = path.join(PROJECT_ROOT, 'assets', 'fonts');
const CARDS_DIR = path.join(PROJECT_ROOT, 'assets', 'cards');

GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'TiltWarp.ttf'), 'Tilt Warp');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Poppins-Medium.ttf'), 'Poppins Medium');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Poppins-SemiBold.ttf'), 'Poppins SemiBold');

const TIER_FILES = {
    free: 'free.svg',
    compy: 'compy.svg',
    raptor: 'raptor.svg',
};

const SCALE = 2; // upscala o SVG (rasterizado em escala nativa) pra sair nítido
const STAR_SIZE = 46; // em unidades do card (716 de largura), antes do SCALE

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

// ==================== extração de metadados do SVG do Figma ====================

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

async function extractCardMeta(svg) {
    const [, viewW, viewH] = svg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/) || [null, 716, 458];
    const frameMatch = svg.match(/<path d="(M[^"]+)" fill="black" fill-opacity="0\.01"/);
    const solidPaths = [...svg.matchAll(/<path d="([^"]+)" fill="(#[0-9A-Fa-f]{6})"\/>/g)];
    // Ordem estável no arquivo: 0,1,2 = textos das badges (Título/Nível/Espécie);
    // 3 = nome do jogador; 4,5 = as 2 linhas de identificação (Alderon/Discord).
    const badgeRectMatch = [...svg.matchAll(/<rect x="([0-9.]+)" y="([0-9.]+)" width="309" height="43" rx="9.5" fill=/g)];
    const iconRectMatch = [...svg.matchAll(/<rect x="([0-9.]+)" y="([0-9.]+)" width="3[23]" height="33" fill="url\(#pattern/g)];
    const starTopMatch = [...svg.matchAll(/<path d="M([0-9.]+) ([0-9.]+)(?:[LH][0-9.]+(?: [0-9.]+)?)+Z" data-figma-gradient-fill/g)];

    if (!frameMatch) throw new Error('profileCardRenderer: moldura (frame path) não encontrada no SVG');
    if (solidPaths.length < 6) throw new Error(`profileCardRenderer: esperava 6 textos vetorizados, achei ${solidPaths.length}`);
    if (badgeRectMatch.length < 3) throw new Error(`profileCardRenderer: esperava 3 badges, achei ${badgeRectMatch.length}`);
    if (iconRectMatch.length < 2) throw new Error(`profileCardRenderer: esperava 2 ícones de identificação, achei ${iconRectMatch.length}`);
    if (starTopMatch.length < 5) throw new Error(`profileCardRenderer: esperava 5 estrelas, achei ${starTopMatch.length}`);

    const bboxes = [];
    for (const p of solidPaths) bboxes.push({ color: p[2], bbox: await bboxOfPath(p[1], viewW, viewH) });

    return {
        viewW: Number(viewW),
        viewH: Number(viewH),
        frameD: frameMatch[1],
        solidPaths,
        bboxes,
        badgeBoxes: badgeRectMatch.map(m => ({ x: Number(m[1]), y: Number(m[2]), w: 309, h: 43 })),
        iconBoxes: iconRectMatch.map(m => ({ x: Number(m[1]), y: Number(m[2]), w: 32, h: 33 })),
        starTops: starTopMatch.map(m => ({ x: Number(m[1]), y: Number(m[2]) })),
    };
}

// ==================== edição cirúrgica do SVG (remove o que vira dinâmico) ====================

function stripStarGroup(svg, filterIndex) {
    const marker = svg.match(new RegExp(`<g filter="url\\(#filter${filterIndex}_dd_\\d+_\\d+\\)">`));
    if (!marker) return svg; // já removido / não encontrado — segue sem quebrar
    const start = svg.indexOf(marker[0]);
    let cursor = start;
    // grupo = <g filter><g clip-path><g transform><foreignObject/></g></g><path/><path/><path/></g>
    // 3 ocorrências de "</g>" fecham (nessa ordem) o transform-g, o clip-path-g e o próprio filter-g.
    for (let i = 0; i < 3; i++) cursor = svg.indexOf('</g>', cursor) + 4;
    return svg.slice(0, start) + svg.slice(cursor);
}

function stripPathByPrefix(svg, dPrefix) {
    const needle = `<path d="${dPrefix}`;
    const start = svg.indexOf(needle);
    if (start === -1) throw new Error('profileCardRenderer: path não encontrado pra remover: ' + dPrefix.slice(0, 40));
    const end = svg.indexOf('/>', start);
    return svg.slice(0, start) + svg.slice(end + 2);
}

// Fileira de 6 ícones (troféu/espada/etc) abaixo da foto — placeholder de um
// futuro sistema de emblemas/missões que ainda não existe. Removida do
// render por enquanto (pedido explícito: "remova dos perfis por hora").
//
// BUG CORRIGIDO: filtrar só pelo traço compartilhado (cor+espessura) não
// bastava — o SVG do Raptor usa o MESMO estilo de traço nos 3 ícones
// dentro das badges (Título/Nível/Espécie, ~20x20px, y≈39/92/143), então
// o replace por regex também apagava esses por engano (Free/Compy nunca
// tiveram ícone nenhum ali, só texto — por isso só o Raptor mostrava esse
// sintoma: "aparece sem ícones nas badges de missão/nível/dinossauro").
// Confirmado com bounding box real (rasterizado via sharp, não regex de
// coordenada — paths com curva/H/V não dão pra medir por regex ingênuo):
// a fileira de 6 ícones sempre cai em y≈264-287 (logo abaixo da foto, que
// vai até y=294); os ícones das badges ficam em y≈39-176. ICON_ROW_MIN_Y
// fica bem no meio dessas duas faixas.
const ICON_ROW_MIN_Y = 220;
async function stripMissionIcons(svg, viewW, viewH) {
    const matches = [...svg.matchAll(/<path d="([^"]+)" stroke="#DCA15E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"\/>/g)];
    let result = svg;
    for (const m of matches) {
        const bbox = await bboxOfPath(m[1], viewW, viewH, 'fill="none" stroke="#000" stroke-width="2"');
        if (bbox.y >= ICON_ROW_MIN_Y) {
            result = result.replace(m[0], '');
        }
    }
    return result;
}

// ==================== render principal ====================

/**
 * @param {object} opts
 * @param {'free'|'compy'|'raptor'} opts.tier
 * @param {Buffer} opts.photoBuffer - bytes da foto (qualquer formato que o sharp leia)
 * @param {Buffer|null} [opts.backgroundBuffer] - bytes do plano de fundo (opcional).
 *   Quando presente, o CARD é desenhado na resolução NATIVA (sem encolher)
 *   e o canvas final é esse tamanho multiplicado por CARD_PADDING_FACTOR
 *   (1.3) nas duas dimensões — preserva exatamente a proporção do card
 *   (716:458 ≈ 1.56:1), a mesma comprovada sendo exibida em largura cheia
 *   pelo Discord. O plano de fundo é recortado (cover fit) pra cobrir esse
 *   canvas maior, com uma sombra projetada (drop shadow) no card pra se
 *   destacar dele. Sobra plano de fundo visível à direita e embaixo do
 *   card.
 * @param {string} opts.nickname
 * @param {string} opts.alderonId
 * @param {string} opts.discordUsername
 * @param {string} opts.titleLabel
 * @param {string} opts.levelLabel
 * @param {string} opts.speciesLabel
 * @param {number} opts.honorStars - 0 a 5
 * @returns {Promise<Buffer>} PNG pronto (card, ou card+plano de fundo compostos)
 */
async function renderProfileCard({ tier, photoBuffer, backgroundBuffer, nickname, alderonId, discordUsername, titleLabel, levelLabel, speciesLabel, honorStars }) {
    const svgPath = path.join(CARDS_DIR, TIER_FILES[tier] || TIER_FILES.free);
    let svg = fs.readFileSync(svgPath, 'utf8');
    const meta = await extractCardMeta(svg);

    for (let i = 1; i <= 5; i++) svg = stripStarGroup(svg, i);
    for (const p of meta.solidPaths) svg = stripPathByPrefix(svg, p[1].slice(0, 60));
    svg = await stripMissionIcons(svg, meta.viewW, meta.viewH);

    // .rotate() sem argumento = auto-orienta pela tag EXIF antes de virar PNG
    // — defesa extra além da já aplicada no upload (imageStorage.js): fotos
    // vindas do banner do próprio Discord ou de uploads antigos (antes dessa
    // correção) podem chegar aqui sem já terem passado por lá.
    const photoPng = await sharp(photoBuffer).rotate().png().toBuffer();
    const clipInsert = `
<clipPath id="profileCardPortraitClip"><path d="${meta.frameD}"/></clipPath>
<g clip-path="url(#profileCardPortraitClip)">
<image href="data:image/png;base64,${photoPng.toString('base64')}" x="20" y="26" width="356" height="268" preserveAspectRatio="xMidYMid slice"/>
</g>
`;
    const frameGroupStart = svg.indexOf('<g filter="url(#filter0_ddi');
    const frameCloseIdx = svg.indexOf('</g>', frameGroupStart) + 4;
    svg = svg.slice(0, frameCloseIdx) + clipInsert + svg.slice(frameCloseIdx);

    // Rasteriza em escala nativa (density/filter em escalas diferentes geram
    // artefatos de antialiasing) e só depois amplia o bitmap resultante.
    const nativePng = await sharp(Buffer.from(svg)).png().toBuffer();
    const nativeMeta = await sharp(nativePng).metadata();
    const basePng = await sharp(nativePng)
        .resize(nativeMeta.width * SCALE, nativeMeta.height * SCALE)
        .png()
        .toBuffer();
    const base = await loadImage(basePng);

    const canvas = createCanvas(base.width, base.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(base, 0, 0);

    // Sombra atrás dos ícones de identificação (Alderon/Discord) — pedido
    // do dono pra melhorar a legibilidade agora que esse trecho do card
    // pode sentar sobre um plano de fundo (foto), não só o fundo escuro
    // padrão. Os ícones já vêm RASTERIZADOS dentro de `base` (fill="url(#
    // pattern...)" no SVG de origem, não desenhados à parte pelo canvas),
    // então não dá pra só ligar sombra antes de "desenhar o ícone" como se
    // faz com texto — em vez disso, recorta exatamente a caixa de cada
    // ícone (meta.iconBoxes, já teve a mesma imagem `base` como origem) e
    // redesenha esse recorte por cima, na MESMA posição, com sombra ativada
    // — o canvas calcula a sombra a partir do canal alfa do que for
    // desenhado, então funciona sem precisar saber o desenho exato do
    // ícone.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 8 * SCALE;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2 * SCALE;
    for (const box of meta.iconBoxes) {
        const sx = box.x * SCALE;
        const sy = box.y * SCALE;
        const sw = box.w * SCALE;
        const sh = box.h * SCALE;
        ctx.drawImage(base, sx, sy, sw, sh, sx, sy, sw, sh);
    }
    ctx.restore();

    const [starFull, starEmpty] = await loadStarImages();
    const starSize = STAR_SIZE * SCALE;
    for (let i = 0; i < meta.starTops.length; i++) {
        const top = meta.starTops[i];
        const cx = top.x * SCALE;
        const cy = (top.y + 13.5) * SCALE; // centro aproximado abaixo da ponta superior
        const img = i < honorStars ? starFull : starEmpty;
        ctx.drawImage(img, cx - starSize / 2, cy - starSize / 2, starSize, starSize);
    }

    // Texto das badges — baseline ancorada na geometria da pílula (não na caixa
    // do texto original), porque a caixa varia com descendentes ("y", "g"...)
    // e desalinha o texto de reposição conforme a palavra.
    ctx.textBaseline = 'alphabetic';
    const badgeLabels = [titleLabel, levelLabel, speciesLabel];
    const BADGE_FONT = 18;
    const BADGE_BASELINE_OFFSET = 6;
    for (let i = 0; i < 3; i++) {
        const { color, bbox } = meta.bboxes[i];
        const pill = meta.badgeBoxes[i];
        ctx.fillStyle = color;
        ctx.font = `${BADGE_FONT * SCALE}px "Poppins SemiBold"`;
        ctx.fillText(badgeLabels[i], bbox.x * SCALE, (pill.y + pill.h / 2 + BADGE_BASELINE_OFFSET) * SCALE);
    }

    // Nome + linhas de identificação ganham sombra própria (pedido do
    // dono) — mesmo motivo dos ícones acima: esse trecho do card fica fora
    // da moldura preenchida, então quando há plano de fundo (foto) atrás
    // dele, precisa de mais contraste pra continuar legível. Badges (acima)
    // já sentam num fundo de pílula opaco, não precisam disso.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 8 * SCALE;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2 * SCALE;

    // Nome (Tilt Warp, sempre caixa alta) — ancorado acima do primeiro ícone de identificação.
    const nickBox = meta.bboxes[3];
    ctx.fillStyle = nickBox.color;
    ctx.font = `${46 * SCALE}px "Tilt Warp"`;
    ctx.fillText(nickname.toUpperCase(), nickBox.bbox.x * SCALE, (meta.iconBoxes[0].y - 6) * SCALE);

    // Linhas de identificação — mesma lógica de âncora geométrica das badges.
    const IDENTITY_FONT = 17;
    const IDENTITY_BASELINE_OFFSET = 6;
    ctx.font = `${IDENTITY_FONT * SCALE}px "Poppins Medium"`;
    const line1 = meta.bboxes[4];
    ctx.fillStyle = line1.color;
    ctx.fillText(alderonId, line1.bbox.x * SCALE, (meta.iconBoxes[0].y + meta.iconBoxes[0].h / 2 + IDENTITY_BASELINE_OFFSET) * SCALE);
    const line2 = meta.bboxes[5];
    ctx.fillStyle = line2.color;
    ctx.fillText(discordUsername, line2.bbox.x * SCALE, (meta.iconBoxes[1].y + meta.iconBoxes[1].h / 2 + IDENTITY_BASELINE_OFFSET) * SCALE);
    ctx.restore();

    if (!backgroundBuffer) {
        return canvas.toBuffer('image/png');
    }

    // ── Plano de fundo full-bleed atrás do card inteiro ────────────────────
    // Voltou a usar o card na resolução NATIVA (sem encolher pra caber numa
    // caixa fixa pequena, como nos testes anteriores de 750x550...1000x550)
    // — pedido do dono: manter a imagem geral grande/nítida, só que com MAIS
    // plano de fundo visível ao redor. O canvas final é o card nativo
    // multiplicado por CARD_PADDING_FACTOR nas DUAS dimensões — isso
    // preserva EXATAMENTE a mesma proporção do card (716:458 ≈ 1.56:1), a
    // mesma já comprovada sendo exibida em largura cheia pelo Discord
    // (diferente de só somar altura sem somar largura proporcional, que foi
    // o que encolheu a imagem inteira na rodada de testes anterior).
    const CARD_PADDING_FACTOR = 1.3;
    const FINAL_W = Math.round(canvas.width * CARD_PADDING_FACTOR);
    const FINAL_H = Math.round(canvas.height * CARD_PADDING_FACTOR);
    const cardScaledW = canvas.width;
    const cardScaledH = canvas.height;

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
    fctx.drawImage(bgImage, 0, 0);
    // Leve escurecida — sem isso, um plano de fundo muito claro/colorido
    // compete visualmente com o card por cima (mesmo o card tendo seu
    // próprio contraste interno, a MOLDURA em si fica menos destacada).
    fctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    fctx.fillRect(0, 0, FINAL_W, FINAL_H);

    // Sombra projetada em cima do CONTORNO real do card (moldura+badges+
    // texto, via canal alfa do canvas do card) — não uma sombra "no olho"
    // desenhada por cima de uma forma fixa, então acompanha automaticamente
    // qualquer ajuste futuro de layout do card. drawImage com dWidth/dHeight
    // escala o card MANTENDO a proporção (cardScaledH calculado acima a
    // partir da mesma razão largura:altura do canvas original) — sem isso
    // distorceria/esticaria o card, o mesmo problema já corrigido na foto.
    fctx.save();
    fctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    fctx.shadowBlur = 22 * SCALE;
    fctx.shadowOffsetX = 0;
    fctx.shadowOffsetY = 6 * SCALE;
    fctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, cardScaledW, cardScaledH);
    fctx.restore();

    return finalCanvas.toBuffer('image/png');
}

module.exports = { renderProfileCard };
