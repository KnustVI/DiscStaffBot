// migrate-fotos-banner.js
/**
 * Migração ÚNICA (rodar uma vez, direto no servidor onde o bot roda de
 * verdade — precisa do TOKEN e do BANNER_STORAGE_CHANNEL_ID reais do .env):
 * envia as 12 fotos genéricas já existentes (assets/images/FOTO PERFIL
 * 01..12.webp) pro pool DINÂMICO de BANNER (profile_image_pool, tipo
 * 'banner' — ver src/systems/pot/profileImagePool.js), que alimenta a
 * galeria de banner de /config personalizar (Strike/Unstrike/Report-Chat).
 *
 * Cópia de migrate-fotos-plano-fundo.js (mesma receita, só troca o tipo do
 * pool de 'background' pra 'banner' e o texto da mensagem de auditoria) —
 * pedido do dono: unificar a galeria de banner com o pool dinâmico em vez
 * do array estático que existia antes (PLAYER_PHOTO_OPTIONS, removido de
 * configSystem.js). Usa os MESMOS nomes já usados nesse array antigo
 * (Planeta Âmbar, Suchomimus, etc.), sem inventar nome novo.
 *
 * Usa a REST API direto (mesmo padrão já usado em deploy.js), sem precisar
 * logar um Client/Gateway inteiro — só precisa enviar uma mensagem com
 * anexo pro canal de armazenamento e ler o ID de volta, exatamente o que
 * /perfil-pool add faz na hora de um upload manual.
 *
 * Idempotente na checagem: se já existir uma entrada 'banner' com o mesmo
 * nome, pula (não duplica) — seguro rodar de novo sem querer.
 */
require('dotenv').config();
const fs = require('fs');
const { REST, Routes } = require('discord.js');
const imageManager = require('./src/utils/imageManager');
const ProfileImagePool = require('./src/systems/pot/profileImagePool');

// Owner (DEVELOPER_ID) já usado em todos os comandos de developer.
const DEVELOPER_ID = '203676076189286412';

// Mesmos nomes já usados no antigo PLAYER_PHOTO_OPTIONS (configSystem.js,
// removido nesta mudança) — pedido do dono: manter o nome de cada foto,
// não inventar nomes novos.
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
    const jaExistentes = ProfileImagePool.listImages('banner').map(row => row.label);

    let migradas = 0;
    let puladas = 0;

    for (const photo of PHOTOS) {
        if (jaExistentes.includes(photo.label)) {
            console.log(`⏭️  "${photo.label}" já está no pool de banner — pulei.`);
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
                body: { content: `Banner (pool) — "${photo.label}" (migrado de assets/images/${photo.key})` },
                files: [{ name: 'imagem.webp', data: buffer }],
            });

            ProfileImagePool.addImage('banner', photo.label, sent.id, DEVELOPER_ID);
            console.log(`✅ "${photo.label}" (${photo.key}) migrada — message_id ${sent.id}`);
            migradas++;
        } catch (error) {
            console.error(`❌ Erro ao migrar "${photo.label}" (${photo.key}):`, error.message || error);
        }
    }

    console.log(`\nConcluído: ${migradas} migrada(s), ${puladas} já existiam. Pool de banner agora tem ${ProfileImagePool.listImages('banner').length} imagem(ns).`);
    process.exit(0);
})().catch(err => {
    console.error('❌ Erro na migração:', err);
    process.exit(1);
});
