require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const db = require('./database/database'); 
const autoModeration = require('./systems/autoModeration');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers 
    ] 
});

client.commands = new Collection();

// --- CARREGAMENTO DE COMANDOS ---
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
console.log(`✅ Comandos carregados: ${client.commands.size}`);

// --- EVENTO READY ---
client.once('ready', () => {
    console.log(`🚀 Bot online: ${client.user.tag}`);
    
    // Inicia o sistema de automoderação
    if (typeof autoModeration === 'function') {
        autoModeration(client);
    }

    // --- SISTEMA DE REPUTAÇÃO PASSIVA ---
    // Roda a cada 24 horas para dar +1 de reputação
    setInterval(() => {
        console.log("🔄 Processando recuperação de reputação diária...");
        const umDiaEmMs = 24 * 60 * 60 * 1000;
        const agora = Date.now();

        try {
            const info = db.prepare(`
                UPDATE users 
                SET reputation = MIN(100, reputation + 1)
                WHERE (last_penalty IS NULL OR (? - last_penalty) > ?)
                AND reputation < 100
            `).run(agora, umDiaEmMs);
            
            console.log(`📈 Recuperação concluída. ${info.changes} usuários recuperaram pontos.`);
        } catch (err) {
            console.error("❌ Erro na recuperação passiva:", err);
        }
    }, 24 * 60 * 60 * 1000); 
});

// --- INTERACTION CREATE ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error("Erro na execução do comando:", error);
        const errorMsg = { content: '❌ Ocorreu um erro interno ao executar este comando.', ephemeral: true };
        
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(errorMsg);
        } else {
            await interaction.reply(errorMsg);
        }
    }
});

client.login(process.env.TOKEN);