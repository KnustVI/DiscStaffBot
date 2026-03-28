//const { SlashCommandBuilder } = require('discord.js');

//module.exports = {
//  data: new SlashCommandBuilder()
//    .setName('ping')
//    .setDescription('Testa se o bot está respondendo'),
    
//  async execute(interaction) {
//    await interaction.reply({ content: '🏓 Pong!', ephemeral: true });
//  }
//};


const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('teste')
        .setDescription('Teste de resposta direta'),
    async execute(interaction) {
        // Se isso aqui não responder, o problema é a conexão do Bot com o Discord
        return interaction.reply({ content: 'O bot está vivo!', ephemeral: true });
    },
};