// Busca os emojis de aplicação do bot (upload feito no Discord Developer
// Portal, em Application > Emojis) direto pela API do Discord e regenera
// src/database/emojis.js automaticamente. Rodar com: npm run sync-emojis
//
// Depois de regenerar o arquivo, também commita e dá push automaticamente
// (só de src/database/emojis.js) caso o conteúdo tenha realmente mudado —
// ver commitAndPush() no fim do arquivo.
//
// Precisa de TOKEN e CLIENT_ID no .env (os mesmos usados pelo bot/deploy.js).
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const repoRoot = path.join(__dirname, '..');
const outPath = path.join(repoRoot, 'src', 'database', 'emojis.js');
const relPath = 'src/database/emojis.js';

if (!TOKEN || !CLIENT_ID) {
    console.error('❌ TOKEN e/ou CLIENT_ID não encontrados no .env — não é possível consultar a API do Discord.');
    process.exit(1);
}

// Nome usado como chave em EMOJIS[...]: mantém o nome do emoji tal como
// cadastrado no Developer Portal quando já é um identificador JS válido;
// caso contrário (começa com número, tem espaço/traço etc.) usa uma versão
// sanitizada só para a chave, mas o nome real do emoji fica preservado no
// <:nome:id> — é o que o Discord usa para renderizar.
function toKey(name) {
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return name;
    const sanitized = name.replace(/[^A-Za-z0-9_$]/g, '_');
    return /^[0-9]/.test(sanitized) ? `_${sanitized}` : sanitized;
}

(async () => {
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    let emojis;
    try {
        const res = await rest.get(Routes.applicationEmojis(CLIENT_ID));
        emojis = res.items || res; // a API retorna { items: [...] }
    } catch (error) {
        console.error('❌ Erro ao buscar emojis da aplicação:', error.message);
        process.exit(1);
    }

    if (!Array.isArray(emojis) || emojis.length === 0) {
        console.log('Nenhum emoji de aplicação encontrado (Discord Developer Portal > Application > Emojis).');
        return;
    }

    // Ordena por nome para manter o arquivo gerado estável/legível.
    emojis.sort((a, b) => a.name.localeCompare(b.name));

    const usedKeys = new Set();
    const lines = emojis.map((e) => {
        let key = toKey(e.name);
        while (usedKeys.has(key)) key = `${key}_`;
        usedKeys.add(key);
        return `    ${key}: formatEmoji('${e.id}', '${e.name}', ${e.animated ? 'true' : 'false'}),`;
    });

    const content = `/**
 * Arquivo de emojis personalizados do bot
 * Gerado automaticamente via \`npm run sync-emojis\` a partir dos emojis de
 * aplicação cadastrados no Discord Developer Portal (Application > Emojis).
 * NÃO editar os IDs manualmente — rode o script de novo após adicionar/
 * remover emojis por lá.
 */

// Função para formatar emoji com ID (animated = true gera <a:nome:id>)
const formatEmoji = (id, name, animated = false) => {
    if (!id) return \`:\${name}:\`;
    return \`<\${animated ? 'a' : ''}:\${name}:\${id}>\`;
};

// Objeto com todos os emojis
const EMOJIS = {
${lines.join('\n')}
};

// Exportar também a função utilitária
const getEmoji = (name) => {
    return EMOJIS[name] || \`:\${name}:\`;
};

module.exports = {
    EMOJIS,
    getEmoji,
    formatEmoji
};
`;

    fs.writeFileSync(outPath, content, 'utf8');
    console.log(`✅ ${emojis.length} emoji(s) sincronizado(s) em src/database/emojis.js`);

    commitAndPush();
})();

// Commita e envia SOMENTE src/database/emojis.js — nunca mexe em outros
// arquivos que possam estar pendentes no repositório (ex: alterações locais
// não relacionadas rodando em produção). Se não houver diferença real no
// arquivo (emojis já sincronizados), não cria commit vazio. Qualquer falha
// aqui (sem git, sem remoto, push rejeitado etc.) só avisa no console — o
// arquivo já foi gravado no disco de qualquer forma.
function commitAndPush() {
    const git = (cmd) => execSync(cmd, { cwd: repoRoot, stdio: 'pipe' }).toString().trim();

    try {
        git('git rev-parse --is-inside-work-tree');
    } catch {
        console.log('ℹ️ Não é um repositório git — pulei o commit automático.');
        return;
    }

    const diff = (() => {
        try {
            return git(`git status --porcelain -- ${relPath}`);
        } catch (error) {
            console.warn('⚠️ Não consegui checar o status do git:', error.message);
            return null;
        }
    })();

    if (diff === null) return;
    if (diff === '') {
        console.log('ℹ️ Nenhuma mudança em src/database/emojis.js — nada para commitar.');
        return;
    }

    try {
        git(`git add ${relPath}`);
        git(`git commit -m "Sync emojis de aplicacao"`);
        console.log('✅ Commit criado.');
    } catch (error) {
        console.error('❌ Erro ao commitar src/database/emojis.js:', error.message);
        return;
    }

    try {
        git('git push');
        console.log('✅ Push enviado.');
    } catch (error) {
        console.error('❌ Commit criado, mas o push falhou (rode "git push" manualmente):', error.message);
    }
}
