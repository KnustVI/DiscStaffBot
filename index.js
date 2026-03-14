require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');

require('./database/database');
const autoModeration = require('./systems/autoModeration'); // mover require para cima

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();

const commandFolders = fs.readdirSync('./commands');

for (const folder of commandFolders) {

    const commandFiles = fs
        .readdirSync(`./commands/${folder}`)
        .filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {

        const command = require(`./commands/${folder}/${file}`);

        if (command.data && command.execute) {
            client.commands.set(command.data.name, command);
        }

    }
}

console.log(`Comandos carregados: ${client.commands.size}`);


// Evento READY correto
client.once('clientReady', () => {
    console.log(`Bot online: ${client.user.tag}`);
    autoModeration(client);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: '❌ Erro ao executar comando.' });
        } else {
            await interaction.reply({ content: '❌ Erro ao executar comando.', ephemeral: true });
        }
    }
});

client.login(process.env.TOKEN);
