const { REST, Routes } = require('discord.js');
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');

const commands = [];
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    
    // --- AJUSTE AQUI: Verifica se é realmente uma pasta antes de dar readdirSync ---
    if (!fs.lstatSync(commandsPath).isDirectory()) continue;

    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        
        console.log(`----------------------------------------`);
        console.log(`📁 Arquivo: ${folder}/${file}`); // Mostra a pasta para facilitar o debug

        if (command && 'data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
            console.log(`✅ Comando /${command.data.name} identificado!`);
        } else {
            console.log(`❌ Falha no arquivo ${file}: Verifique o module.exports`);
        }
    }
}

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log("🧹 [1/3] Limpando comandos GLOBAIS...");
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });

        console.log("🧹 [2/3] Limpando comandos de GUILDA...");
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: [] }
        );

        console.log(`🚀 [3/3] Registrando ${commands.length} comandos na GUILDA...`);
        const data = await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );

        console.log(`✅ TUDO PRONTO! ${data.length} comandos ativos.`);

    } catch (error) {
        // Se o erro de "DUPLICATE NAME" persistir, o erro vai aparecer aqui com detalhes
        console.error("❌ ERRO NO DEPLOY:", error);
    }
})();