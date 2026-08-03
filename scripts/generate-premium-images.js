// scripts/generate-premium-images.js
// Gera as duas imagens estáticas do painel /premium — VIEW PLAYER PREMIUM
// (Player Premium: Free/Compy/Raptor) e TABELA SERVER PREMIUM (Server
// Premium: Free/Rastreador/Caçador, 6 categorias) — via @napi-rs/canvas +
// sharp, mesma stack já usada por src/utils/profileCardRenderer.js pros
// cards de /perfil. Roda direto (`npm run generate-premium-images`) e
// escreve por cima dos dois arquivos em assets/images/.
//
// Conteúdo (bullets/preços/categorias) fica hardcoded aqui de propósito —
// mesmo texto já usado nos cards de preço de web/views/hero.ejs (seções
// PLAYER PREMIUM/SERVER PREMIUM) e em PREMIUM.txt. Sempre que esse texto
// mudar (preço, benefício novo, tier renomeado), atualiza os 3 lugares
// juntos e roda este script de novo pra gerar as imagens combinando.
//
// Uso: node scripts/generate-premium-images.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

const PROJECT_ROOT = path.join(__dirname, '..');
const FONTS_DIR = path.join(PROJECT_ROOT, 'assets', 'fonts');
const OUT_DIR = path.join(PROJECT_ROOT, 'assets', 'images');

GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'TiltWarp.ttf'), 'Tilt Warp');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Poppins-Regular.ttf'), 'Poppins Regular');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Poppins-Medium.ttf'), 'Poppins Medium');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Poppins-SemiBold.ttf'), 'Poppins SemiBold');

// ==================== helpers ====================

function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Aproxima o radial-gradient(225.25% 94.36% at 0% 86.37%, #111111 0%,
// #1F1D20 57.07%, #29272A 91.53%) usado em TODO card escuro do site —
// não é matematicamente idêntico ao CSS (canvas não faz elipse deslocada
// do mesmo jeito), mas mesma sensação: mais claro/quente perto do canto
// inferior esquerdo, escurecendo pro resto. Confirmado visualmente OK.
function bgGradient(ctx, w, h) {
    const cx = 0, cy = h * 0.8637;
    const r = Math.max(w, h) * 1.35;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, '#111111');
    g.addColorStop(0.57, '#1F1D20');
    g.addColorStop(0.92, '#29272A');
    g.addColorStop(1, '#29272A');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
}

function wrapText(ctx, text, maxWidth) {
    const words = String(text).split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && current) {
            lines.push(current);
            current = word;
        } else {
            current = test;
        }
    }
    if (current) lines.push(current);
    return lines;
}

function drawMultiline(ctx, text, x, y, maxWidth, lineHeight, align = 'left') {
    const lines = wrapText(ctx, text, maxWidth);
    const prevAlign = ctx.textAlign;
    ctx.textAlign = align;
    lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
    ctx.textAlign = prevAlign;
    return lines.length;
}

// Poppins não tem o glifo de "✓" (U+2713) — vira um tofu-box quadrado no
// render real (confirmado visualmente na 1ª versão). Desenha um check
// vetorial em vez de depender de glifo nenhum.
function drawCheck(ctx, cx, cy, size, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, size * 0.16);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.5, cy);
    ctx.lineTo(cx - size * 0.12, cy + size * 0.38);
    ctx.lineTo(cx + size * 0.55, cy - size * 0.4);
    ctx.stroke();
    ctx.restore();
}

async function saveWebp(canvas, filename) {
    const pngBuffer = canvas.toBuffer('image/png');
    const outPath = path.join(OUT_DIR, filename);
    await sharp(pngBuffer).webp({ quality: 92 }).toFile(outPath);
    console.log('✅ wrote', outPath);
}

// ==================== VIEW PLAYER PREMIUM (1480x685) ====================

async function buildPlayerPremium() {
    const W = 1480, H = 685;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    roundRectPath(ctx, 0, 0, W, H, 32);
    ctx.save();
    ctx.clip();
    bgGradient(ctx, W, H);
    ctx.restore();

    const padX = 56, padTop = 40;
    let y = padTop;

    ctx.fillStyle = '#DCA15E';
    ctx.font = '40px "Tilt Warp"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('P L A Y E R   P R E M I U M', W / 2, y + 40);
    y += 40 + 44;

    const gap = 28;
    const colW = (W - padX * 2 - gap * 2) / 3;
    const colTop = y;
    const colH = H - colTop - 36;

    // Mesmo texto dos cards de preço em web/views/hero.ejs (seção PLAYER
    // PREMIUM) — atualizar os dois juntos se um mudar.
    const tiers = [
        {
            name: 'FREE', nameColor: '#F8DCC0', featured: false, price: null, inherits: null,
            bullets: [
                'Perfil sincronizado com o Discord',
                'Badges de missões',
                'Títulos de missões',
                'Ganhe Hunt por hora de jogo',
            ],
        },
        {
            name: 'COMPY', nameColor: '#DCA15E', featured: true, price: 'R$10/mês', inherits: 'Tudo do Free +',
            bullets: [
                'Perfil personalizável pela loja',
                'Badge exclusivo',
                'Títulos exclusivos',
                'Ganho extra de Hunt por missão concluída',
            ],
        },
        {
            name: 'RAPTOR', nameColor: '#FF4E3B', featured: false, price: 'R$25/mês', inherits: 'Tudo do Compy +',
            bullets: [
                'Perfil 100% personalizável com suas próprias imagens',
                'Ganho extra de Hunt por Missão Titan concluída',
            ],
        },
    ];

    tiers.forEach((tier, i) => {
        const cx = padX + i * (colW + gap);

        roundRectPath(ctx, cx, colTop, colW, colH, 18);
        ctx.fillStyle = '#1A1A1A';
        ctx.fill();
        ctx.lineWidth = tier.featured ? 2 : 1;
        ctx.strokeStyle = tier.featured ? '#803E30' : '#3E3D38';
        ctx.stroke();

        const innerPad = 26;
        let cy = colTop + innerPad;
        const textX = cx + innerPad;
        const textMaxW = colW - innerPad * 2;

        ctx.textAlign = 'left';
        ctx.fillStyle = tier.nameColor;
        ctx.font = '24px "Tilt Warp"';
        ctx.fillText(tier.name, textX, cy + 22);
        cy += 22 + 14;

        if (tier.price) {
            ctx.font = '26px "Tilt Warp"';
            ctx.fillStyle = tier.nameColor;
            ctx.fillText(tier.price, textX, cy + 20);
            cy += 20 + 16;
        } else {
            cy += 20 + 16;
        }

        if (tier.inherits) {
            ctx.font = '13px "Poppins Regular"';
            ctx.fillStyle = 'rgba(248,220,192,0.6)';
            ctx.fillText(tier.inherits, textX, cy + 12);
            cy += 12 + 18;
        } else {
            cy += 6;
        }

        ctx.font = '15px "Poppins Regular"';
        const lineH = 20;
        for (const bullet of tier.bullets) {
            const checkW = 20;
            drawCheck(ctx, textX + 6, cy + 9, 11, '#F8DCC0');
            ctx.fillStyle = 'rgba(248,220,192,0.95)';
            const linesUsed = drawMultiline(ctx, bullet, textX + checkW, cy + 14, textMaxW - checkW, lineH, 'left');
            cy += linesUsed * lineH + 8;
        }
    });

    ctx.textAlign = 'center';
    ctx.font = '12px "Poppins Regular"';
    ctx.fillStyle = 'rgba(248,220,192,0.4)';
    ctx.fillText('BY: KNUST SEIER VI', W / 2, H - 16);

    await saveWebp(canvas, 'VIEW PLAYER PREMIUM.webp');
}

// ==================== TABELA SERVER PREMIUM (1328x921) ====================

async function buildServerPremium() {
    const W = 1328, H = 921;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    roundRectPath(ctx, 0, 0, W, H, 32);
    ctx.save();
    ctx.clip();
    bgGradient(ctx, W, H);
    ctx.restore();

    const padX = 48, padTop = 36;
    let y = padTop;

    ctx.textAlign = 'center';
    ctx.fillStyle = '#DCA15E';
    ctx.font = '34px "Tilt Warp"';
    ctx.fillText('S E R V E R   P R E M I U M', W / 2, y + 34);
    y += 34 + 30;

    const tableTop = y;
    const tableBottom = H - 56;
    const tableH = tableBottom - tableTop;
    const tableW = W - padX * 2;
    const labelColW = tableW * 0.30;
    const tierColW = (tableW - labelColW) / 3;
    const headH = 74;
    // Condensado a partir de web/views/hero.ejs (serverRows/serverTiers,
    // seção SERVER PREMIUM) — frases inteiras viram 1 linha curta por
    // célula (a versão completa mora no site/PREMIUM.txt).
    const rows = [
        { label: 'MISSÕES', free: 'Mensais do bot (em breve)', rast: '+1 exclusiva do servidor (em breve)', cac: '+2 exclusivas do servidor (em breve)' },
        { label: 'REPORTES', free: '1 chat + 1 revisão, cooldown 6h', rast: '3 chats + 3 revisões, sem cooldown', cac: 'Ilimitado, sem cooldown + personalização' },
        { label: 'MODERAÇÃO', free: 'Registro de punições', rast: 'Reputação + até 4 níveis + histórico', cac: 'Até 10 níveis + cargos automáticos + análise' },
        { label: 'EVENTOS', free: 'Postagem em fórum', rast: 'Evento nativo do Discord + marcação', cac: 'Anúncios automáticos + análise de staff' },
        { label: 'INTEGRAÇÃO PATH OF TITANS', free: 'Logs de jogo via webhook', rast: 'RCON automático + avisos em jogo + TP', cac: 'Catálogo RCON completo + buffs + filtro de chat' },
        { label: 'BÔNUS', free: '—', rast: 'Player Premium Compy grátis pro dono', cac: 'Player Premium Raptor grátis pro dono' },
    ];
    const rowH = (tableH - headH) / rows.length;

    roundRectPath(ctx, padX, tableTop, tableW, tableH, 14);
    ctx.save();
    ctx.clip();

    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(padX, tableTop, tableW, headH);

    const tierCols = [
        { x: padX + labelColW, name: 'FREE', color: '#F8DCC0', price: 'R$0' },
        { x: padX + labelColW + tierColW, name: 'RASTREADOR', color: '#DCA15E', price: 'R$25/mês' },
        { x: padX + labelColW + tierColW * 2, name: 'CAÇADOR', color: '#FF4E3B', price: 'R$40/mês' },
    ];
    ctx.textAlign = 'left';
    tierCols.forEach(col => {
        const tx = col.x + 18;
        ctx.fillStyle = col.color;
        ctx.font = '19px "Tilt Warp"';
        ctx.fillText(col.name, tx, tableTop + 30);
        ctx.font = '13px "Poppins SemiBold"';
        ctx.globalAlpha = 0.8;
        ctx.fillText(col.price, tx, tableTop + 52);
        ctx.globalAlpha = 1;
    });

    let ry = tableTop + headH;
    rows.forEach((row, i) => {
        if (i % 2 === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.02)';
            ctx.fillRect(padX, ry, tableW, rowH);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(padX, ry, labelColW, rowH);
        ctx.fillStyle = '#F8DCC0';
        ctx.font = '13px "Poppins SemiBold"';
        ctx.textAlign = 'left';
        drawMultiline(ctx, row.label, padX + 16, ry + rowH / 2 - 4, labelColW - 32, 16, 'left');

        const cellText = (text, x, colorAlpha) => {
            ctx.font = '13px "Poppins Regular"';
            ctx.fillStyle = colorAlpha;
            const maxW = tierColW - 36;
            const lineH = 17;
            const lines = wrapText(ctx, text, maxW);
            const startY = ry + rowH / 2 - ((lines.length - 1) * lineH) / 2 + 4;
            lines.forEach((line, li) => ctx.fillText(line, x + 18, startY + li * lineH));
        };
        cellText(row.free, tierCols[0].x, 'rgba(248,220,192,0.92)');
        cellText(row.rast, tierCols[1].x, 'rgba(240,217,184,0.92)');
        cellText(row.cac, tierCols[2].x, 'rgba(248,201,192,0.92)');

        ctx.strokeStyle = '#2A2A2A';
        ctx.lineWidth = 1;
        [tierCols[0].x, tierCols[1].x, tierCols[2].x].forEach(vx => {
            ctx.beginPath();
            ctx.moveTo(vx, ry);
            ctx.lineTo(vx, ry + rowH);
            ctx.stroke();
        });
        if (i > 0) {
            ctx.beginPath();
            ctx.moveTo(padX, ry);
            ctx.lineTo(padX + tableW, ry);
            ctx.stroke();
        }

        ry += rowH;
    });

    ctx.restore();
    roundRectPath(ctx, padX, tableTop, tableW, tableH, 14);
    ctx.strokeStyle = '#3E3D38';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(padX, tableTop + headH);
    ctx.lineTo(padX + tableW, tableTop + headH);
    ctx.strokeStyle = '#3E3D38';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = '11px "Poppins Regular"';
    ctx.fillStyle = 'rgba(248,220,192,0.4)';
    ctx.fillText('NECESSÁRIO SER UM HOST DE PATH OF TITANS · CADA TIER INCLUI TUDO DO ANTERIOR · BY: KNUST SEIER VI', W / 2, H - 24);

    await saveWebp(canvas, 'TABELA SERVER PREMIUM.webp');
}

(async () => {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    await buildPlayerPremium();
    await buildServerPremium();
})();
