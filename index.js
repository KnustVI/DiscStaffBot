require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./database/database');
const cron = require('node-cron');

const session = require('../../utils/sessionManager');
const ConfigCache = require('./systems/configCache');
const loadDashboard = require('./dashboard.js');

// ==========================
// LIMPEZA DE SESSÕES
// ==========================
setInterval(() => {
    session.clearExpired();
}, 60000);

// ==========================
// CLIENT
// ==========================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

client.commands = new Collection();

// ==========================
// HANDLER DE COMANDOS
// ==========================
const commandsPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(commandsPath);

for (const folder of commandFolders) {
    const folderPath = path.join(commandsPath, folder);
    const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(folderPath, file);
        const command = require(filePath);

        if (command.data && command.execute) {
            client.commands.set(command.data.name, command);
        } else {
            console.warn(`[AVISO] Comando inválido em ${file}`);
        }
    }
}

// ==========================
// HANDLER DE EVENTOS
// ==========================
const eventsPath = path.join(__dirname, 'events');
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

// ==========================
// CRON JOBS
// ==========================

// Recuperação de reputação diária
cron.schedule('0 3 * * *', () => {
    console.log("🔄 [Cron] Iniciando recuperação de reputação diária...");

    const umDiaEmMs = 24 * 60 * 60 * 1000;
    const agora = Date.now();

    try {
        const info = db.prepare(`
            UPDATE users 
            SET reputation = MIN(100, reputation + 1)
            WHERE (last_penalty IS NULL OR (? - last_penalty) > ?)
            AND reputation < 100
        `).run(agora, umDiaEmMs);

        console.log(`📈 [Cron] Recuperação concluída. ${info.changes} usuários afetados.`);
    } catch (err) {
        console.error("❌ [Cron] Erro na recuperação passiva:", err);
    }
});

// Backup quinzenal
cron.schedule('0 0 1,15 * *', () => {
    console.log('📦 [Cron] Iniciando backup para Google Sheets...');
    const { exportToSheets } = require('./utils/googleSheets');
    exportToSheets();
});

// ==========================
// READY (UNIFICADO)
// ==========================
client.once('ready', async () => {
    try {
        await ConfigCache.loadAll();
        console.log(`🚀 Bot online: ${client.user.tag}`);

        loadDashboard(client);

    } catch (err) {
        console.error("❌ Erro no ready:", err);
    }
});

// ==========================
// TRATAMENTO GLOBAL DE ERROS
// ==========================
process.on('unhandledRejection', (err) => {
    console.error('❌ Unhandled Rejection:', err);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

// ==========================
// LOGIN
// ==========================
client.login(process.env.TOKEN);