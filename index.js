require('dotenv').config(); // Carrega o TOKEN do .env
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Importação dos Sistemas Centrais
const ConfigCache = require('./systems/configCache');
const autoModeration = require('./systems/autoModeration');
const ErrorLogger = require('./systems/errorLogger');

// Configuração do Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// Coleções para comandos e handlers
client.commands = new Collection();

// =========================
// 1. CARREGAMENTO DE COMANDOS
// =========================
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        }
    }
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

        // Passo B: Login no Discord
        await client.login(process.env.TOKEN);

        // Passo C: Iniciar o Cron do AutoMod (Agora que o client está pronto)
        autoModeration(client);

        console.log(`✅ ${client.user.tag} está online e sistemas agendados!`);

    } catch (error) {
        ErrorLogger.log('Bootstrap_Error', error);
        console.error('❌ Falha crítica ao iniciar o bot:', error);
        process.exit(1);
    }
}

// Tratamento de erros globais para evitar crashes na VPS
process.on('unhandledRejection', error => {
    ErrorLogger.log('Unhandled_Rejection', error);
    console.error(' [Unhandled Rejection]:', error);
});

bootstrap();