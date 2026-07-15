require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const commands = [];
// Comandos de src/commands/developer/*.js vão pro bot PRIVADO (Application
// separada — ver src/systems/core/devBot.js), nunca pro bot principal.
const devCommands = [];

// --- CONFIGURAÇÃO DOS SERVIDORES ---
// Adicione aqui os IDs dos servidores onde quer registrar os comandos
const GUILD_IDS = [
    '430534418818400266',  // Servidor principal (KnustVI Productions)
    '1470636597929050255'  // Atlas Brasil
];

// --- 1. LOCALIZAÇÃO DOS COMANDOS ---
const foldersPath = path.join(__dirname, 'src', 'commands');

if (!fs.existsSync(foldersPath)) {
    console.error(`\x1b[41m\x1b[37m[FATAL]\x1b[0m Pasta não encontrada: ${foldersPath}`);
    process.exit(1);
}

// --- 2. VARREDURA RECURSIVA ---
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);

    if (!fs.lstatSync(commandsPath).isDirectory()) continue;

    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);

        try {
            const command = require(filePath);

            if (command && 'data' in command && 'execute' in command) {
                const json = command.data.toJSON();
                const target = folder === 'developer' ? devCommands : commands;
                target.push(json);
                console.log(`\x1b[32m✅ [/${command.data.name}]\x1b[0m carregado de ${folder}/${file}${folder === 'developer' ? ' \x1b[36m(bot developer)\x1b[0m' : ''}`);
            } else {
                console.warn(`\x1b[33m⚠️ [AVISO]\x1b[0m O arquivo em ${filePath} está incompleto.`);
            }
        } catch (err) {
            console.error(`\x1b[31m❌ [ERRO]\x1b[0m Falha ao carregar ${file}: ${err.message}`);
        }
    }
}

// --- 3. COMUNICAÇÃO COM A API DO DISCORD ---
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log("\n\x1b[34m[DEPLOY]\x1b[0m Iniciando atualização de comandos (bot principal)...");

        // Limpeza Global (opcional - comentar se não quiser limpar)
        // await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });

        // Registrar comandos para CADA servidor na lista
        for (const guildId of GUILD_IDS) {
            console.log(`\x1b[34m[DEPLOY]\x1b[0m Registrando ${commands.length} comandos no servidor: ${guildId}`);

            const data = await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
                { body: commands }
            );

            console.log(`\x1b[32m✅ SUCESSO!\x1b[0m ${data.length} comandos sincronizados com o servidor ${guildId}\n`);
        }

    } catch (error) {
        console.error("\n\x1b[41m\x1b[37m[ERRO DE DEPLOY]\x1b[0m (bot principal)");
        console.error(error);
    }

    // --- BOT DE DEVELOPER (Application separada, privada) ---
    // Opcional: sem DEV_TOKEN/DEV_CLIENT_ID configurados, pula esta parte
    // sem quebrar o deploy do bot principal acima.
    if (!process.env.DEV_TOKEN || !process.env.DEV_CLIENT_ID) {
        console.log('\nℹ️ [DEPLOY] DEV_TOKEN/DEV_CLIENT_ID não configurados — pulando deploy do bot developer.');
        return;
    }

    // Sem DEV_GUILD_ID explícito, cai no mesmo servidor principal já usado
    // acima (GUILD_IDS[0]) — é lá que fica o bot developer hoje.
    const devGuildId = process.env.DEV_GUILD_ID || GUILD_IDS[0];

    try {
        const devRest = new REST({ version: '10' }).setToken(process.env.DEV_TOKEN);
        console.log(`\n\x1b[34m[DEPLOY]\x1b[0m Registrando ${devCommands.length} comandos de developer no servidor privado: ${devGuildId}`);

        const data = await devRest.put(
            Routes.applicationGuildCommands(process.env.DEV_CLIENT_ID, devGuildId),
            { body: devCommands }
        );

        console.log(`\x1b[32m✅ SUCESSO!\x1b[0m ${data.length} comandos de developer sincronizados (bot privado)\n`);
    } catch (error) {
        console.error("\n\x1b[41m\x1b[37m[ERRO DE DEPLOY]\x1b[0m (bot developer)");
        console.error(error);
    }
})();
