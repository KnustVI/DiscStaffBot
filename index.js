require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// 1. CRIAR O CLIENT PRIMEIRO (Essencial para não dar o erro de initialization)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// 2. DEBUG RAW (Agora o client já existe, então funciona)
client.on('raw', packet => {
    if (packet.t === 'INTERACTION_CREATE') {
        console.log('--- [DEBUG RAW] SINAL RECEBIDO DO DISCORD ---');
    }
});

// 3. IMPORTAR SISTEMAS
const ConfigCache = require('./systems/configCache');
const autoModeration = require('./systems/autoModeration');
const ErrorLogger = require('./systems/errorLogger');

client.commands = new Collection();

// =========================
// 1. CARREGAMENTO DE COMANDOS
// =========================
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    
    // Se seus comandos estiverem em subpastas, use este bloco:
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        }
    }
    
    // Se estiverem em subpastas (Ex: commands/admin/config.js), descomente o código que enviamos antes.
}

// =========================
// 2. CARREGAMENTO DE EVENTOS
// =========================
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
    for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        const event = require(filePath); 
        console.log(`[EVENTO CARREGADO]: ${event.name}`);
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
        } else {
            client.on(event.name, (...args) => event.execute(...args, client));
        }
    }
}

// =========================
// 3. INICIALIZAÇÃO DO BOT
// =========================
async function bootstrap() {
    try {
        console.log('🚀 Iniciando sistemas...');
        await client.login(process.env.TOKEN);
        
        // Ativa o AutoMod passando o client já logado
        if (typeof autoModeration === 'function') {
            autoModeration(client);
        }

        console.log(`✅ ${client.user.tag} está online!`);

    } catch (error) {
        if (ErrorLogger && ErrorLogger.log) {
            ErrorLogger.log('Bootstrap_Error', error);
        }
        console.error('❌ Falha crítica ao iniciar o bot:', error);
        process.exit(1);
    }
}

process.on('unhandledRejection', error => {
    console.error(' [Unhandled Rejection]:', error);
});

bootstrap();