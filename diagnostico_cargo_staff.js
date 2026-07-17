// diagnostico_cargo_staff.js — rodar na VPS (dentro de ~/DiscStaffBot): node diagnostico_cargo_staff.js
//
// Confirma, direto pela API do Discord (sem depender de inspeção visual),
// se as pessoas com 0 crédito de modo espectador (ver diagnostico_espectador.js
// Seção 6) realmente têm ou não o cargo configurado como staff neste servidor
// (staff_role/supervisor_role/event_role — hoje os 3 apontam pro MESMO ID,
// 1471697157802164286). Usa a REST API direto (mesmo padrão de
// migrate-fotos-plano-fundo.js), sem precisar logar um Client/Gateway inteiro.
require('dotenv').config();
const { REST, Routes } = require('discord.js');

const GUILD_ID = '1470636597929050255';
const TARGET_ROLE_ID = '1471697157802164286';
const PEOPLE = [
    { name: 'Kaffel', userId: '1280022134516748374' },
    { name: 'Kazekage_Katsu', userId: '815044168325922836' },
    { name: 'MestreShifu', userId: '1239648262550589501' },
];

(async () => {
    if (!process.env.TOKEN) {
        console.error('❌ TOKEN não configurado neste .env — rode este script no servidor onde o bot roda de verdade.');
        process.exit(1);
    }

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    const roles = await rest.get(Routes.guildRoles(GUILD_ID));
    const targetRole = roles.find(r => r.id === TARGET_ROLE_ID);
    console.log(`Cargo configurado como staff: ${targetRole ? `"${targetRole.name}"` : '(NÃO ENCONTRADO NO SERVIDOR — o cargo pode ter sido deletado!)'} (id=${TARGET_ROLE_ID})\n`);

    for (const person of PEOPLE) {
        try {
            const member = await rest.get(Routes.guildMember(GUILD_ID, person.userId));
            const hasRole = (member.roles || []).includes(TARGET_ROLE_ID);
            const roleNames = (member.roles || []).map(id => roles.find(r => r.id === id)?.name || id);
            console.log(`${hasRole ? '✅ TEM' : '❌ NÃO TEM'} o cargo | ${person.name} (discord=${person.userId})`);
            console.log(`   Cargos atuais: ${roleNames.length ? roleNames.join(', ') : '(nenhum)'}`);
        } catch (err) {
            console.log(`⚠️  ${person.name} (discord=${person.userId}) — erro ao buscar membro: ${err.message} (pode ter saído do servidor)`);
        }
    }

    process.exit(0);
})();
