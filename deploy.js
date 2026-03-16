const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const { TOKEN, CLIENT_ID, GUILD_ID } = process.env;
const rest = new REST({ version: '10' }).setToken(TOKEN);

async function refreshCommands() {
    try {
        console.log("🧹 1. Limpando comandos antigos...");
        // Enviando um array vazio para a guilda, limpamos tudo o que existe lá
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
        console.log("✅ Limpeza concluída.");

        console.log("🚀 2. Preparando novos comandos...");
        const commands = [];
        
        // --- ABAIXO: Lógica para ler seus arquivos de comando ---
        // Ajuste o caminho 'commands' para a pasta onde seus comandos estão
        const commandsPath = path.join(__dirname, 'commands'); 
        
        if (fs.existsSync(commandsPath)) {
            const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
            
            for (const file of commandFiles) {
                const command = require(path.join(commandsPath, file));
                if ('data' in command) {
                    commands.push(command.data.toJSON());
                }
            }
        }
        // -------------------------------------------------------

        if (commands.length === 0) {
            console.log("⚠️ Nenhum comando encontrado para registrar. O bot ficou limpo.");
            return;
        }

        console.log(`📦 Enviando ${commands.length} comandos para o Discord...`);
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );

        console.log("✅ Sucesso! Comandos limpos e recolocados.");

    } catch (error) {
        console.error("❌ Erro durante o processo:");
        console.error(error);
    }
}

refreshCommands();