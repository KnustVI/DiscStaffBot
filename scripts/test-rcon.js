// scripts/test-rcon.js
//
// Testa a conexão RCON isolada da aplicação — usa a mesma lib (rcon-client)
// que o bot usa de verdade (src/integrations/pathoftitans/rconClient.js),
// pra diagnosticar se um problema é de rede/credenciais ou do próprio bot.
//
// Uso:
//   node scripts/test-rcon.js <GUILD_ID>   → usa a config real salva no
//                                            banco pra essa guild (mesmos
//                                            dados que /potserver usa)
//   node scripts/test-rcon.js              → usa RCON_HOST/RCON_PORT/
//                                            RCON_PASSWORD do .env
//
// O primeiro modo é o mais útil pra achar bug no bot: se ele falhar mas o
// segundo modo (com os mesmos dados digitados manualmente) funcionar, o
// problema está em como o bot lê/usa a configuração — não na rede.

require('dotenv').config();
const { Rcon } = require('rcon-client');

(async () => {
    const guildId = process.argv[2];

    let host, port, password, source;

    if (guildId) {
        const PoTConfigSystem = require('../src/systems/pot/potConfigSystem');
        const config = PoTConfigSystem.getServerConfig(guildId);

        if (!config) {
            console.log(`❌ Nenhuma configuração de servidor PoT encontrada para a guild ${guildId}.`);
            console.log('   Rode "/potserver setup" nessa guild primeiro, ou confira o ID.');
            process.exit(1);
        }

        host = config.server_ip;
        port = Number(config.rcon_port);
        password = config.rcon_password;
        source = `banco de dados (guild ${guildId})`;
    } else {
        host = process.env.RCON_HOST;
        port = Number(process.env.RCON_PORT);
        password = process.env.RCON_PASSWORD;
        source = '.env (RCON_HOST / RCON_PORT / RCON_PASSWORD)';
    }

    console.log('=== Teste de conexão RCON ===');
    console.log(`Fonte dos dados: ${source}`);
    console.log(`Host: ${host || 'não definido'}`);
    console.log(`Porta: ${port || 'não definido'}`);
    console.log(`Senha: ${password ? 'configurada' : 'não definida'}`);

    if (!host || !port || !password) {
        console.log('❌ Falha: faltam dados de conexão.');
        process.exit(1);
    }

    try {
        const client = await Rcon.connect({
            host,
            port,
            password,
            timeout: 5000,
        });

        console.log('✅ Conexão RCON estabelecida');

        const response = await client.send('status');
        console.log('✅ Comando enviado com sucesso');
        console.log('Resposta:', response || '(sem resposta)');

        await client.end();
        console.log('✅ Conexão encerrada');
    } catch (error) {
        console.log('❌ Falha na conexão RCON');
        console.log(error && error.message ? error.message : String(error));
        process.exit(1);
    }
})();
