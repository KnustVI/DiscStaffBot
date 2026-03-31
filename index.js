require('dotenv').config(); 
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// --- 1. CENTRALIZAÇÃO DE SISTEMAS (LIMPEZA TOTAL) ---
// Note que removemos configHandler, configCache e getSettings. 
// Tudo agora é controlado pelo configSystem.
client.systems = {
    config: require('./src/systems/configSystem'), 
    punishment: require('./src/systems/punishmentSystem'), 
    logger: require('./src/systems/errorLogger'),
    sessions: require('./src/utils/sessionManager'),
    emojis: require('./src/database/emojis').EMOJIS,
    status: require('./src/systems/systemStatus') // Carregamento global de emojis
};

client.commands = new Collection();

// --- 2. CARREGAMENTO DE COMANDOS (RECURSIVO) ---
const commandsPath = path.join(__dirname, 'src/commands'); // Ajuste o caminho se necessário
if (fs.existsSync(commandsPath)) {
    const commandFolders = fs.readdirSync(commandsPath);
    for (const folder of commandFolders) {
        const folderPath = path.join(commandsPath, folder);
        if (!fs.lstatSync(folderPath).isDirectory()) continue;

        const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const command = require(path.join(folderPath, file));
            if (command.data && command.execute) {
                client.commands.set(command.data.name, command);
            }
        }
    }
}

// --- 3. CARREGAMENTO DE EVENTOS ---
const eventsPath = path.join(__dirname, 'src/events'); // Ajuste o caminho se necessário
if (fs.existsSync(eventsPath)) {
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
    for (const file of eventFiles) {
        const event = require(path.join(eventsPath, file));
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
        } else {
            client.on(event.name, (...args) => event.execute(...args, client));
        }
    }
}

// --- 4. BOOTSTRAP ---
async function bootstrap() {
    try {
        await client.login(process.env.TOKEN);

        // Inicialização pós-login
        client.once('clientReady', (c) => {
            console.log(`✅ Logado como ${client.user.tag}`);
            
            // 1. Inicia o AutoMod (Ciclo das 12:00)
            const autoMod = require('./src/systems/autoModeration');
            if (typeof autoMod === 'function') autoMod(client);

            // 2. Dashboard (Se houver)
            const loadDashboard = require('./dashboard'); // Ajuste se estiver em /src
            if (typeof loadDashboard === 'function') loadDashboard(client);

            console.log(`🚀 Todos os sistemas de integridade ativos!`);
        });

    } catch (error) {
        console.error('❌ Erro fatal no Bootstrap:', error);
        process.exit(1);
    }
}

bootstrap();