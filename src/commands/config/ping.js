// /home/ubuntu/DiscStaffBot/src/commands/config/ping.js
const { SlashCommandBuilder } = require('discord.js');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Testa se o bot está respondendo'),
    
    async execute(interaction, client) {
        try {
            // O handler já fez deferReply, então usamos editReply
            const ping = client.ws.ping;
            
            // Criar container com AdvancedContainerBuilder
            const builder = new AdvancedContainerBuilder({ accentColor: 0x57F287 });
            
            // Determinar cor baseada na latência
            let statusEmoji = '🟢';
            let statusText = 'Excelente';
            if (ping > 200) {
                builder.accentColor = 0xED4245;
                statusEmoji = '🔴';
                statusText = 'Crítico';
            } else if (ping > 100) {
                builder.accentColor = 0xFEE75C;
                statusEmoji = '🟡';
                statusText = 'Moderado';
            }
            
            builder.title('🏓 Pong!', 1);
            builder.separator();
            builder.text(`📡 **Latência:** \`${ping}ms\``);
            builder.text(`💻 **API:** \`${Math.round(client.ws.ping)}ms\``);
            builder.text(`📊 **Status:** ${statusEmoji} ${statusText}`);
            builder.separator();
            builder.text(`🤖 **Bot:** ${client.user?.tag || 'Desconhecido'}`);
            builder.text(`📅 **Uptime:** ${Math.floor(client.uptime / 1000 / 60)} minutos`);
            builder.footer(`Solicitado por ${interaction.user.tag}`);
            
            const { components, flags } = builder.build();
            
            await interaction.editReply({ 
                components,
                flags: [flags]
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