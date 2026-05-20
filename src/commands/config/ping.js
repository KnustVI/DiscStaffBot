// /home/ubuntu/DiscStaffBot/src/commands/config/ping.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Testa se o bot está respondendo'),
    
    async execute(interaction, client) {
        try {
            const ping = client.ws.ping;
            
            await interaction.reply({ 
                content: `🏓 Pong!\n📡 Latência: ${ping}ms\n💻 API: ${Math.round(client.ws.ping)}ms`,
                flags: 64
            });
            
        } catch (error) {
            console.error('❌ Erro no comando ping:', error);
            if (!interaction.replied) {
                await interaction.reply({ content: '❌ Erro ao executar o comando.', flags: 64 });
            }
        }
    }
};