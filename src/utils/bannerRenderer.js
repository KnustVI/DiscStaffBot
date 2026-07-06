// src/utils/bannerRenderer.js
/**
 * Gera o banner de perfil personalizado (Player Premium Raptor): compõe a
 * imagem de fundo enviada pelo jogador com o nickname em destaque, seguindo
 * a identidade visual do bot (fontes Tilt Warp/Poppins + paleta de marca).
 * Sempre devolve um PNG estático de tamanho fixo, mesmo que o fundo enviado
 * tenha outra proporção (recorte "cover", centralizado).
 */
const path = require('path');
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');

const FONTS_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'TiltWarp.ttf'), 'Tilt Warp');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Poppins-Regular.ttf'), 'Poppins');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Poppins-Medium.ttf'), 'Poppins Medium');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Poppins-SemiBold.ttf'), 'Poppins SemiBold');

const WIDTH = 1200;
const HEIGHT = 400;

const PALETTE = {
    heading: '#F8DCC0', // Light
    subtitle: '#A89986', // Neutro
    accent: '#DCA15E', // Mostarda (cor padrão do bot)
    badgeText: '#1F1D20', // Dark
    overlayDark: '31,29,32', // Dark, em rgb pra gradiente com alpha
    divider: '#3E3D38', // Giz
};

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/**
 * @param {Buffer} backgroundBuffer - bytes da imagem enviada pelo jogador
 * @param {string} nickname - nome de exibição (vai pra caixa alta automaticamente)
 * @param {string} subtitle - linha de apoio, menor, abaixo do nickname
 * @param {string} [badgeLabel] - selo opcional no canto (ex: "RAPTOR")
 * @returns {Promise<Buffer>} PNG resultante
 */
async function renderProfileBanner({ backgroundBuffer, nickname, subtitle, badgeLabel }) {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    const bg = await loadImage(backgroundBuffer);
    const scale = Math.max(WIDTH / bg.width, HEIGHT / bg.height);
    const dw = bg.width * scale;
    const dh = bg.height * scale;
    ctx.drawImage(bg, (WIDTH - dw) / 2, (HEIGHT - dh) / 2, dw, dh);

    const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    grad.addColorStop(0, `rgba(${PALETTE.overlayDark},0.15)`);
    grad.addColorStop(0.55, `rgba(${PALETTE.overlayDark},0.55)`);
    grad.addColorStop(1, `rgba(${PALETTE.overlayDark},0.92)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = PALETTE.accent;
    ctx.fillRect(0, 0, 10, HEIGHT);

    const padX = 56;

    if (badgeLabel) {
        ctx.font = '28px "Poppins SemiBold"';
        const badgeText = badgeLabel.toUpperCase();
        const bw = ctx.measureText(badgeText).width + 48;
        const bx = padX;
        const by = HEIGHT - 220;
        const bh = 46;
        ctx.fillStyle = PALETTE.accent;
        roundRect(ctx, bx, by, bw, bh, 23);
        ctx.fill();
        ctx.fillStyle = PALETTE.badgeText;
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, bx + 24, by + bh / 2 + 2);
    }

    ctx.textBaseline = 'alphabetic';
    ctx.font = '86px "Tilt Warp"';
    ctx.fillStyle = PALETTE.heading;
    ctx.fillText((nickname || '').toUpperCase(), padX, HEIGHT - 120);

    if (subtitle) {
        ctx.font = '32px "Poppins Medium"';
        ctx.fillStyle = PALETTE.subtitle;
        ctx.fillText(subtitle, padX, HEIGHT - 70);
    }

    ctx.fillStyle = PALETTE.divider;
    ctx.fillRect(padX, HEIGHT - 50, 200, 3);
    ctx.fillStyle = PALETTE.accent;
    ctx.fillRect(padX, HEIGHT - 50, 60, 3);

    return canvas.toBuffer('image/png');
}

module.exports = { renderProfileBanner, WIDTH, HEIGHT };
