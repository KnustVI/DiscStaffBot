require('dotenv').config(); 
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const loadDashboard = require('./dashboard');
const db = require('./src/database');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// Centralização de Sistemas (Problema 2: Evita require repetitivo)
client.systems = {
    // Caminhos baseados na sua pasta /src/systems/
    config: require('./src/systems/configHandler'),
    configSystem: require('./src/systems/configSystem'), // Importante para o Punishment ler configs
    punishment: require('./src/systems/punishmentSystem'), 
    
    // Verifique se estes dois abaixo estão na raiz ou dentro de /src/systems/
    // Se estiverem dentro de /src/systems/, use o caminho com ./src/systems/...
    cache: require('./src/systems/configCache'),
    logger: require('./src/systems/errorLogger'),
    
    // Verifique se a pasta /utils/ está na raiz ou dentro de /src/
    sessions: require('./src/utils/sessionManager') 
};

client.commands = new Collection();

// Carregamento de Comandos
const commandsPath = path.join(__dirname, 'commands');
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

// Carregamento de Eventos (Unificado)
const eventsPath = path.join(__dirname, 'events');
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

async function bootstrap() {
    try {
        await client.login(process.env.TOKEN);

        client.once('ready', () => {
    console.log(`✅ ${client.user.tag} online!`);
    
    if (client.systems.punishment && typeof client.systems.punishment.initWorker === 'function') {
        client.systems.punishment.initWorker(client);
    } else {
        console.error('❌ Erro: initWorker não encontrado no PunishmentSystem');
    }
});
        
        // Inicializa Dashboard e AutoMod após o login
        const autoModeration = require('./systems/autoModeration');
        if (typeof autoModeration === 'function') autoModeration(client);
        if (typeof loadDashboard === 'function') loadDashboard(client);

        console.log(`✅ ${client.user.tag} online e sistemas carregados!`);
    } catch (error) {
        client.systems.logger.log('Bootstrap_Error', error);
        process.exit(1);
    }
}

bootstrap();