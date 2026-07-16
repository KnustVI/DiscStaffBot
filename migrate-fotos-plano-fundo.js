// migrate-fotos-plano-fundo.js
/**
 * Migração ÚNICA (rodar uma vez, direto no servidor onde o bot roda de
 * verdade — precisa do TOKEN e do BANNER_STORAGE_CHANNEL_ID reais do .env):
 * envia as 12 fotos genéricas já existentes (assets/images/FOTO PERFIL
 * 01..12.webp, hoje só usadas como PLAYER_PHOTO_OPTIONS em configSystem.js,
 * pros banners de /config reportchat/strike/unstrike) pro pool DINÂMICO de
 * PLANO DE FUNDO (profile_image_pool, tipo 'background' — ver
 * src/systems/pot/profileImagePool.js).
 *
 * Pedido do dono: essas 12 fotos passam a ser SÓ plano de fundo — saem do
 * pool de avatar (que volta a ficar vazio até novas fotos serem adicionadas
 * via /perfil-pool add avatar) e usam os MESMOS nomes já definidos em
 * PLAYER_PHOTO_OPTIONS (Planeta Âmbar, Suchomimus, etc.), sem inventar nome
 * novo nenhum.
 *
 * Usa a REST API direto (mesmo padrão já usado em deploy.js), sem precisar
 * logar um Client/Gateway inteiro — só precisa enviar uma mensagem com
 * anexo pro canal de armazenamento e ler o ID de volta, exatamente o que
 * /perfil-pool add faz na hora de um upload manual.
 *
 * Idempotente na checagem: se já existir uma entrada 'background' com o
 * mesmo nome, pula (não duplica) — seguro rodar de novo sem querer.
 */
require('dotenv').config();
const fs = require('fs');
const { REST, Routes } = require('discord.js');
const imageManager = require('./src/utils/imageManager');
const ProfileImagePool = require('./src/systems/pot/profileImagePool');

// Owner (DEVELOPER_ID) já usado em todos os comandos de developer.
const DEVELOPER_ID = '203676076189286412';

// Mesmos nomes já usados em PLAYER_PHOTO_OPTIONS (configSystem.js) — pedido
// do dono: manter o nome de cada foto, não inventar nomes novos.
const PHOTOS = [
    { key: 'foto_perfil_01', label: 'Planeta Âmbar' },
    { key: 'foto_perfil_02', label: 'Suchomimus' },
    { key: 'foto_perfil_03', label: 'Desert Hunt' },
    { key: 'foto_perfil_04', label: 'Rex Beach' },
    { key: 'foto_perfil_05', label: 'Green Trike' },
    { key: 'foto_perfil_06', label: 'Yuty Look' },
    { key: 'foto_perfil_07', label: 'Yuty Snow' },
    { key: 'foto_perfil_08', label: "Parassaur's Forest" },
    { key: 'foto_perfil_09', label: 'Desert Migration' },
    { key: 'foto_perfil_10', label: 'Family Hunt' },
    { key: 'foto_perfil_11', label: 'Forest Lurker' },
    { key: 'foto_perfil_12', label: 'Trike Family' },
];

(async () => {
    if (!process.env.TOKEN) {
        console.error('❌ TOKEN não configurado neste .env — rode este script no servidor onde o bot roda de verdade.');
        process.exit(1);
    }
    const storageChannelId = process.env.BANNER_STORAGE_CHANNEL_ID;
    if (!storageChannelId) {
        console.error('❌ BANNER_STORAGE_CHANNEL_ID não configurado neste .env.');
        process.exit(1);
    }

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const jaExistentes = ProfileImagePool.listImages('background').map(row => row.label);

    let migradas = 0;
    let puladas = 0;

    for (const photo of PHOTOS) {
        if (jaExistentes.includes(photo.label)) {
            console.log(`⏭️  "${photo.label}" já está no pool de plano de fundo — pulei.`);
            puladas++;
            continue;
        }

        if (!imageManager.hasImage(photo.key)) {
            console.warn(`⚠️  ${photo.key} não encontrada no imageManager — pulei.`);
            continue;
        }

        const localPath = imageManager.getPath(photo.key);
        const buffer = fs.readFileSync(localPath);

        try {
            const sent = await rest.post(Routes.channelMessages(storageChannelId), {
                body: { content: `Plano de fundo (pool) — "${photo.label}" (migrado de assets/images/${photo.key})` },
                files: [{ name: 'imagem.webp', data: buffer }],
            });

            ProfileImagePool.addImage('background', photo.label, sent.id, DEVELOPER_ID);
            console.log(`✅ "${photo.label}" (${photo.key}) migrada — message_id ${sent.id}`);
            migradas++;
        } catch (error) {
            console.error(`❌ Erro ao migrar "${photo.label}" (${photo.key}):`, error.message || error);
        }
    }

    console.log(`\nConcluído: ${migradas} migrada(s), ${puladas} já existiam. Pool de plano de fundo agora tem ${ProfileImagePool.listImages('background').length} imagem(ns).`);
    process.exit(0);
})().catch(err => {
    console.error('❌ Erro na migração:', err);
    process.exit(1);
});
