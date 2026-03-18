const { REST, Routes } = require('discord.js');
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');

// Carregando as pastas de comandos automaticamente
const commands = [];
const foldersPath = path.join(__dirname, 'commands'); // Verifique se sua pasta chama 'commands'
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    
    for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    
    console.log(`----------------------------------------`);
    console.log(`📁 Arquivo: ${file}`);
    console.log(`📦 Conteúdo exportado:`, Object.keys(command)); 
    // Se aparecer [] (vazio), o seu module.exports no arquivo de comando está errado.

    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
        console.log(`✅ Identificado com sucesso!`);
    } else {
        console.log(`❌ Falha: Data? ${'data' in command} | Execute? ${'execute' in command}`);
    }
    }
}

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log("🧹 [1/3] Limpando comandos GLOBAIS (pode levar um tempo para sumir)...");
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });

        console.log("🧹 [2/3] Limpando comandos de GUILDA (servidor específico)...");
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: [] }
        );

        console.log(`🚀 [3/3] Registrando ${commands.length} comandos novos na GUILDA...`);
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );

        console.log("✅ TUDO PRONTO! Reinicie seu Discord (CTRL + R) para ver as mudanças.");

    } catch (error) {
        console.error("❌ ERRO NO DEPLOY:", error);
    }
})();