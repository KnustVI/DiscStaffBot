// Converte todas as imagens .png/.jpg/.jpeg de assets/images para .webp
// e remove os arquivos originais. Rodar com: npm run convert-images
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const QUALITY = 90;
const SOURCE_EXTENSIONS = ['.png', '.jpg', '.jpeg'];
const imagesDir = path.join(__dirname, '..', 'assets', 'images');

(async () => {
    const files = fs.readdirSync(imagesDir)
        .filter(file => SOURCE_EXTENSIONS.includes(path.extname(file).toLowerCase()));

    if (files.length === 0) {
        console.log('Nenhuma imagem .png/.jpg/.jpeg encontrada em assets/images — nada para converter.');
        return;
    }

    let totalBefore = 0;
    let totalAfter = 0;

    for (const file of files) {
        const srcPath = path.join(imagesDir, file);
        const destPath = path.join(imagesDir, `${path.parse(file).name}.webp`);

        const before = fs.statSync(srcPath).size;
        await sharp(srcPath).webp({ quality: QUALITY }).toFile(destPath);
        const after = fs.statSync(destPath).size;

        fs.unlinkSync(srcPath);

        totalBefore += before;
        totalAfter += after;
        console.log(`${file} -> ${path.basename(destPath)} | ${(before / 1024).toFixed(1)}KB -> ${(after / 1024).toFixed(1)}KB`);
    }

    const savedPct = (100 - (totalAfter / totalBefore) * 100).toFixed(1);
    console.log(`\n${files.length} imagem(ns) convertida(s). Total: ${(totalBefore / 1024).toFixed(1)}KB -> ${(totalAfter / 1024).toFixed(1)}KB (${savedPct}% menor)`);
})();
