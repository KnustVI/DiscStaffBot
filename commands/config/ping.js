const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Testa se o bot está respondendo'),
    
  async execute(interaction) {
    await interaction.editReply({ content: '🏓 Pong!', ephemeral: true });
  }
};