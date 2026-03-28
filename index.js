require('dotenv').config(); 
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const loadDashboard = require('./dashboard'); // Importação do seu arquivo dashboard.js

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

client.commands = new Collection();

// ==========================================
// 2. DEBUG RAW (Opcional)
// ==========================================
client.on('raw', packet => {
    if (packet.t === 'INTERACTION_CREATE') {
        // console.log('--- [DEBUG RAW] SINAL RECEBIDO ---');
    }
});

// ==========================================
// 3. IMPORTAÇÃO DOS SISTEMAS
// ==========================================
const ConfigCache = require('./systems/configCache');
const autoModeration = require('./systems/autoModeration');
const ErrorLogger = require('./systems/errorLogger');

// =========================
// 4. CARREGAMENTO DE COMANDOS
// =========================
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFolders = fs.readdirSync(commandsPath);
    for (const folder of commandFolders) {
        const folderPath = path.join(commandsPath, folder);
        if (!fs.lstatSync(folderPath).isDirectory()) continue;

        const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const filePath = path.join(folderPath, file);
            const command = require(filePath);
            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
                console.log(`[COMANDO CARREGADO]: /${command.data.name}`);
            }
        }
    }
}

// =========================
// 5. CARREGAMENTO DE EVENTOS
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
// 6. INICIALIZAÇÃO DO BOT E DASHBOARD
// =========================
async function bootstrap() {
    try {
        console.log('🚀 Iniciando sistemas...');

        // 1. Login no Discord
        await client.login(process.env.TOKEN);
        console.log(`✅ Bot conectado como: ${client.user.tag}`);

        // 2. Iniciar o AutoMod
        if (typeof autoModeration === 'function') {
            autoModeration(client);
        }

        // 3. INICIAR O DASHBOARD (AQUI ESTÁ A CORREÇÃO)
        if (typeof loadDashboard === 'function') {
            loadDashboard(client);
            console.log('🖥️  Sistema de Dashboard inicializado.');
        } else {
            console.warn('⚠️  Aviso: Função loadDashboard não encontrada ou não é uma função.');
        }

    } catch (error) {
        if (ErrorLogger && ErrorLogger.log) {
            ErrorLogger.log('Bootstrap_Error', error);
        }
        console.error('❌ Falha crítica ao iniciar o bot:', error);
        process.exit(1);
    }
}

// Tratamento de erros globais
process.on('unhandledRejection', error => {
    console.error(' [Unhandled Rejection]:', error);
});

bootstrap();