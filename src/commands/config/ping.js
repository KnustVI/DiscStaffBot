// src/commands/utility/ping.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Testa se o bot está respondendo'),
    
    async execute(interaction, client) {
        try {
            await interaction.deferReply();
            
            const sent = await interaction.fetchReply();
            const ping = sent.createdTimestamp - interaction.createdTimestamp;
            
            await interaction.editReply({ 
                content: `🏓 Pong!\n📡 Latência: ${ping}ms\n💻 API: ${Math.round(client.ws.ping)}ms` 
            });
            
        } catch (error) {
            console.error('❌ Erro no comando ping:', error);
            
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '❌ Ocorreu um erro ao executar o comando ping.', flags: 64 });
                } else if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply({ content: '❌ Ocorreu um erro ao executar o comando ping.' });
                }
            } catch (err) {
                console.error('❌ Erro ao responder fallback:', err);
            }
        }
    }
};