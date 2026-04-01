// Carregar variáveis de ambiente do arquivo .env
require('dotenv').config();

const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Configuração do client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

client.commands = new Collection();

// ==================== CARREGAR COMANDOS ====================
const commandsPath = path.join(__dirname, 'src', 'commands');
console.log(`📂 Carregando comandos de: ${commandsPath}`);

if (fs.existsSync(commandsPath)) {
    const commandFolders = fs.readdirSync(commandsPath);
    let loadedCommands = 0;

    for (const folder of commandFolders) {
        const folderPath = path.join(commandsPath, folder);
        if (!fs.statSync(folderPath).isDirectory()) continue;
        
        const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
        
        for (const file of commandFiles) {
            try {
                const command = require(path.join(folderPath, file));
                if ('data' in command && 'execute' in command) {
                    client.commands.set(command.data.name, command);
                    loadedCommands++;
                }
            } catch (error) {
                console.error(`❌ Erro ao carregar comando ${folder}/${file}:`, error.message);
            }
        }
    }
    console.log(`📋 ${loadedCommands} comandos carregados`);
} else {
    console.error(`❌ Diretório de comandos não encontrado: ${commandsPath}`);
}

// ==================== CARREGAR EVENTOS ====================
const eventsPath = path.join(__dirname, 'src', 'events');
console.log(`📂 Carregando eventos de: ${eventsPath}`);

if (fs.existsSync(eventsPath)) {
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
    let loadedEvents = 0;

    for (const file of eventFiles) {
        try {
            const event = require(path.join(eventsPath, file));
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args, client));
            } else {
                client.on(event.name, (...args) => event.execute(...args, client));
            }
            loadedEvents++;
        } catch (error) {
            console.error(`❌ Erro ao carregar evento ${file}:`, error.message);
        }
    }
    console.log(`🎧 ${loadedEvents} eventos carregados`);
} else {
    console.error(`❌ Diretório de eventos não encontrado: ${eventsPath}`);
}

// ==================== TRATAMENTO DE ERROS GLOBAIS ====================
process.on('unhandledRejection', (error) => {
    console.error('❌ Promise rejeitada não tratada:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Exceção não capturada:', error);
});

// ==================== LOGIN DO BOT ====================
// Pega o token do .env
const TOKEN = process.env.TOKEN;

if (!TOKEN) {
    console.error('❌ TOKEN não encontrado no arquivo .env!');
    console.error('   Verifique se o arquivo .env existe e contém: TOKEN=seu_token_aqui');
    process.exit(1);
}

console.log('🔑 Token encontrado, iniciando login...');

client.login(TOKEN).catch(error => {
    console.error('❌ Erro ao fazer login:', error);
    process.exit(1);
});

module.exports = client;