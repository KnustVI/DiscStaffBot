const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Configuração do client com intents necessárias
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

// Coleção de comandos
client.commands = new Collection();

// ==================== CARREGAR COMANDOS ====================
const commandsPath = path.join(__dirname, 'src/commands');
const commandFolders = fs.readdirSync(commandsPath);

let loadedCommands = 0;

for (const folder of commandFolders) {
    const folderPath = path.join(commandsPath, folder);
    // Verificar se é uma pasta
    if (!fs.statSync(folderPath).isDirectory()) continue;
    
    const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
    
    for (const file of commandFiles) {
        try {
            const command = require(path.join(folderPath, file));
            
            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
                loadedCommands++;
            } else {
                console.warn(`⚠️ Comando em ${folder}/${file} está faltando "data" ou "execute"`);
            }
        } catch (error) {
            console.error(`❌ Erro ao carregar comando ${folder}/${file}:`, error.message);
        }
    }
}

console.log(`📋 ${loadedCommands} comandos carregados`);

// ==================== CARREGAR EVENTOS ====================
const eventsPath = path.join(__dirname, 'src/events');
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

// ==================== TRATAMENTO DE ERROS GLOBAIS ====================
process.on('unhandledRejection', (error) => {
    console.error('❌ Promise rejeitada não tratada:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Exceção não capturada:', error);
});

// ==================== LOGIN DO BOT ====================
const TOKEN = process.env.TOKEN || require('./config.json').token;

client.login(TOKEN).catch(error => {
    console.error('❌ Erro ao fazer login:', error);
    process.exit(1);
});

// Exportar client para uso em outros módulos (ex: dashboard)
module.exports = client;