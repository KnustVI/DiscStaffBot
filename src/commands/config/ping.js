// /home/ubuntu/DiscStaffBot/src/commands/config/ping.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Testa se o bot está respondendo'),
    
    async execute(interaction, client) {
        try {
            // O handler já fez deferReply, então usamos editReply
            const ping = client.ws.ping;
            
            await interaction.editReply({ 
                content: `🏓 Pong!\n📡 Latência: ${ping}ms\n💻 API: ${Math.round(client.ws.ping)}ms`
            });
            
        } catch (error) {
            console.error('❌ Erro no comando ping:', error);
            
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '❌ Ocorreu um erro ao executar o comando ping.', flags: 64 });
                } else {
                    await interaction.editReply({ content: '❌ Ocorreu um erro ao executar o comando ping.' });
                }
            } catch (err) {
                console.error('❌ Erro ao responder:', err);
            }
        }
    }
};