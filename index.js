require('dotenv').config(); 
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

/**
 * INICIALIZAÇÃO DO CLIENT
 * Configurado com intents essenciais para moderação e leitura de mensagens.
 */
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// --- 1. CENTRALIZAÇÃO DE SISTEMAS ---
// Injetamos os módulos no client para que fiquem disponíveis em interaction.client
client.systems = {
    config: require('./src/systems/configSystem'), 
    punishment: require('./src/systems/punishmentSystem'), 
    logger: require('./src/systems/errorLogger'),
    sessions: require('./src/utils/sessionManager'),
    status: require('./src/systems/systemStatus'),
    emojis: require('./src/database/emojis').EMOJIS
};

client.commands = new Collection();

// --- 2. CARREGAMENTO DINÂMICO DE COMANDOS ---
const commandsPath = path.join(__dirname, 'src/commands');
if (fs.existsSync(commandsPath)) {
    const commandFolders = fs.readdirSync(commandsPath);
    for (const folder of commandFolders) {
        const folderPath = path.join(commandsPath, folder);
        if (!fs.lstatSync(folderPath).isDirectory()) continue;

        const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const filePath = path.join(folderPath, file);
            const command = require(filePath);
            
            if (command.data && command.execute) {
                client.commands.set(command.data.name, command);
            }
        }
    }
}

// --- 3. CARREGAMENTO DINÂMICO DE EVENTOS ---
const eventsPath = path.join(__dirname, 'src/events');
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

// --- 4. BOOTSTRAP (INICIALIZAÇÃO) ---
async function bootstrap() {
    try {
        // Conexão com o Discord
        await client.login(process.env.TOKEN);

        // Evento Ready Nativo
        client.once('ready', (c) => {
            console.log(`\x1b[32m✅ Logado com sucesso como ${c.user.tag}\x1b[0m`);
            
            // 1. Inicializa o Ciclo de AutoModeração (12h BRT)
            try {
                const autoMod = require('./src/systems/autoModeration');
                if (typeof autoMod === 'function') autoMod(client);
                console.log(`\x1b[34m[SYSTEM]\x1b[0m Ciclo AutoMod agendado.`);
            } catch (e) {
                console.warn("⚠️ Módulo AutoMod não encontrado ou com erro.");
            }

            // 2. Inicializa Dashboard (Opcional)
            const dashboardPath = path.join(__dirname, 'src/dashboard/server.js');
            if (fs.existsSync(dashboardPath)) {
                const loadDashboard = require(dashboardPath);
                if (typeof loadDashboard === 'function') loadDashboard(client);
                console.log(`\x1b[34m[SYSTEM]\x1b[0m Interface Web online.`);
            }

            console.log(`🚀 \x1b[1mROBIN INTEGRITY\x1b[0m está 100% operacional!`);
        });

    } catch (error) {
        console.error('\x1b[41m\x1b[37m[FATAL ERROR]\x1b[0m Falha no Bootstrap:', error);
        process.exit(1);
    }
}

// Gerenciamento de Erros Não Tratados (Prevenção de Crash na VPS)
process.on('unhandledRejection', error => {
    client.systems.logger.log('Unhandled_Rejection', error);
});

bootstrap();