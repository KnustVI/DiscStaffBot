require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const db = require('./database/database'); 
const cron = require('node-cron'); // Certifique-se de ter instalado: npm install node-cron

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers 
    ] 
});

client.commands = new Collection();

// --- HANDLER DE COMANDOS (Otimizado) ---
const commandFolders = fs.readdirSync('./commands');
for (const folder of commandFolders) {
    const commandFiles = fs.readdirSync(`./commands/${folder}`).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const command = require(`./commands/${folder}/${file}`);
        if (command.data && command.execute) {
            client.commands.set(command.data.name, command);
        }
    }
}

// --- HANDLER DE EVENTOS (Otimização Real) ---
// Isso remove a lógica do interactionCreate do index, deixando-o limpo.
const eventFiles = fs.readdirSync('./events').filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
    const event = require(`./events/${file}`);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
    } else {
        client.on(event.name, (...args) => event.execute(...args));
    }
}

// --- TAREFAS AGENDADAS (CRON) ---
// Em vez de setInterval, o cron é muito mais estável para VPS.
// Recuperação de Reputação: Todo dia às 03:00 da manhã (horário de baixo tráfego)
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

// Backup quinzenal (Google Sheets)
cron.schedule('0 0 1,15 * *', () => {
    console.log('📦 [Cron] Iniciando backup para Google Sheets...');
    const { exportToSheets } = require('./utils/googleSheets'); // Lazy Load: só carrega o script na hora de usar
    exportToSheets();
});

const ConfigCache = require('./systems/configCache');

// Carrega as configurações na RAM para acesso rápido
client.once('ready', async () => {
    await ConfigCache.loadAll(); // Carrega tudo na RAM assim que o bot liga
    console.log(`🚀 Bot online: ${client.user.tag}`);
});

client.login(process.env.TOKEN);