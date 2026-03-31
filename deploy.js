const { REST, Routes } = require('discord.js');
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');

const commands = [];

// --- ⚠️ AJUSTE DE CAMINHO: Entrando na pasta src ---
const foldersPath = path.join(__dirname, 'src', 'commands'); 

// Verifica se a pasta existe antes de tentar ler (evita o erro ENOENT)
if (!fs.existsSync(foldersPath)) {
    console.error(`❌ ERRO: A pasta de comandos não foi encontrada em: ${foldersPath}`);
    process.exit(1);
}

const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    
    // PONTO 6: Performance e Segurança - Ignora arquivos soltos, foca em pastas
    if (!fs.lstatSync(commandsPath).isDirectory()) continue;

    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        
        if (command && 'data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
            console.log(`✅ [/${command.data.name}] identificado em ${folder}/${file}`);
        } else {
            console.log(`❌ Falha no arquivo ${folder}/${file}: Falta "data" ou "execute"`);
        }
    }
}

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        // PONTO 4: Limpeza (Fundamental para evitar lixo no cache do Discord)
        console.log("----------------------------------------");
        console.log("🧹 [1/3] Limpando comandos GLOBAIS...");
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });

        console.log("🧹 [2/3] Limpando comandos de GUILDA...");
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: [] }
        );

        // Registro Final
        console.log(`🚀 [3/3] Registrando ${commands.length} comandos na GUILDA...`);
        const data = await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );

        console.log("----------------------------------------");
        console.log(`✅ TUDO PRONTO! ${data.length} comandos ativos na guilda: ${process.env.GUILD_ID}`);

    } catch (error) {
        console.error("❌ ERRO NO DEPLOY:", error);
    }
})();