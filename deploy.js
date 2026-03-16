const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const { TOKEN, CLIENT_ID, GUILD_ID } = process.env;
const rest = new REST({ version: '10' }).setToken(TOKEN);

async function refreshCommands() {
    try {
        console.log("🧹 1. Limpando comandos antigos...");
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
        console.log("✅ Limpeza concluída.");

        console.log("🚀 2. Preparando novos comandos...");
        const commands = [];
        const commandsPath = path.join(__dirname, 'commands'); 
        
        if (fs.existsSync(commandsPath)) {
            // LER AS SUBPASTAS (config, moderation, profile)
            const commandFolders = fs.readdirSync(commandsPath);

            for (const folder of commandFolders) {
                const folderPath = path.join(commandsPath, folder);
                
                // Verifica se é uma pasta (ex: moderation)
                if (fs.lstatSync(folderPath).isDirectory()) {
                    const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
                    
                    for (const file of commandFiles) {
                        const filePath = path.join(folderPath, file);
                        const command = require(filePath);
                        
                        if ('data' in command && 'execute' in command) {
                            commands.push(command.data.toJSON());
                            console.log(`- Comando encontrado: ${command.data.name}`);
                        }
                    }
                }
            }
        }

        if (commands.length === 0) {
            console.log("⚠️ Nenhum comando encontrado nas subpastas de /commands.");
            return;
        }

        console.log(`📦 Enviando ${commands.length} comandos para o Discord...`);
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );

        console.log("✅ Sucesso! Comandos registrados.");

    } catch (error) {
        console.error("❌ Erro durante o processo:");
        console.error(error);
    }
}

refreshCommands();