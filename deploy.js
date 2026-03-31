require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const commands = [];

// --- 1. LOCALIZAÇÃO DOS COMANDOS ---
// O script assume que está na raiz e os comandos em /src/commands
const foldersPath = path.join(__dirname, 'src', 'commands'); 

if (!fs.existsSync(foldersPath)) {
    console.error(`\x1b[41m\x1b[37m[FATAL]\x1b[0m Pasta não encontrada: ${foldersPath}`);
    process.exit(1);
}

// --- 2. VARREDURA RECURSIVA ---
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    
    // Ignora arquivos soltos na raiz da pasta commands, foca apenas em subpastas (categorias)
    if (!fs.lstatSync(commandsPath).isDirectory()) continue;

    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        
        try {
            const command = require(filePath);
            
            if (command && 'data' in command && 'execute' in command) {
                // Converte o SlashCommandBuilder para o JSON que o Discord entende
                commands.push(command.data.toJSON());
                console.log(`\x1b[32m✅ [/${command.data.name}]\x1b[0m carregado de ${folder}/${file}`);
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
        console.log("\n\x1b[34m[DEPLOY]\x1b[0m Iniciando atualização de comandos...");

        /**
         * PONTO DE SEGURANÇA: Limpeza de Cache
         * Removemos comandos globais e de guilda antigos para evitar 
         * que comandos deletados continuem aparecendo no menu do Discord.
         */
        
        // Limpeza Global (Pode levar até 1h para propagar, por isso usamos Guild para testes)
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });

        // Registro na Guilda de Testes (Instantâneo)
        console.log(`\x1b[34m[DEPLOY]\x1b[0m Registrando ${commands.length} comandos na Guilda: ${process.env.GUILD_ID}`);
        
        const data = await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );

        console.log(`\x1b[32m\x1b[1m✅ SUCESSO!\x1b[0m ${data.length} comandos sincronizados com o Discord.\n`);

    } catch (error) {
        console.error("\n\x1b[41m\x1b[37m[ERRO DE DEPLOY]\x1b[0m");
        console.error(error);
    }
})();