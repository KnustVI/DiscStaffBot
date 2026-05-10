const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Testa se o bot está respondendo'),
    
    async execute(interaction, client) {
        try {
            // 🔧 IMPORTANTE: Deferir a resposta primeiro
            await interaction.deferReply();
            
            // Calcula o ping real
            const sent = await interaction.fetchReply();
            const ping = sent.createdTimestamp - interaction.createdTimestamp;
            
            // Resposta com informações de latência
            await interaction.editReply({ 
                content: `🏓 Pong!\n📡 Latência: ${ping}ms\n💻 API: ${Math.round(client.ws.ping)}ms` 
            });
            
        } catch (error) {
            console.error('❌ Erro no comando ping:', error);
            
            // Fallback em caso de erro
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