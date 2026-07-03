// /home/ubuntu/DiscStaffBot/src/commands/config/ping.js
const { SlashCommandBuilder } = require('discord.js');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

let emojis = {};
try {
    emojis = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    emojis = {};
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Testa se o bot está respondendo'),
    
    async execute(interaction, client) {
        try {
            // O handler já fez deferReply, então usamos editReply
            const ping = client.ws.ping;

            // Determinar cor baseada na latência
            let statusEmoji = '🟢';
            let statusText = 'Excelente';
            let accentColor = COLORS.SUCCESS;
            if (ping > 200) {
                accentColor = COLORS.ERROR;
                statusEmoji = '🔴';
                statusText = 'Crítico';
            } else if (ping > 100) {
                accentColor = COLORS.DEFAULT;
                statusEmoji = '🟡';
                statusText = 'Moderado';
            }

            // Criar container com AdvancedContainerBuilder
            const builder = new AdvancedContainerBuilder({ accentColor });

            builder.title('🏓 Pong!', 1);
            builder.separator();
            builder.text(`${emojis.wifi || '📡'} **Latência:** \`${ping}ms\``);
            builder.text(`${emojis.terminal || '💻'} **API:** \`${Math.round(client.ws.ping)}ms\``);
            builder.text(`${emojis.gauge || '📊'} **Status:** ${statusEmoji} ${statusText}`);
            builder.separator();
            builder.text(`${emojis.robo || '🤖'} **Bot:** ${client.user?.tag || 'Desconhecido'}`);
            builder.text(`${emojis.calendar || '📅'} **Uptime:** ${Math.floor(client.uptime / 1000 / 60)} minutos`);
            builder.footer(interaction.guild?.name, `Solicitado por ${interaction.user.tag}`);
            
            const { components, flags } = builder.build();
            
            await interaction.editReply({ 
                components,
                flags: [flags]
            });
            
        } catch (error) {
            console.error('❌ Erro no comando ping:', error);
            
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: `${emojis.circlealert || '❌'} Ocorreu um erro ao executar o comando ping.`, flags: 64 });
                } else {
                    await interaction.editReply({ content: `${emojis.circlealert || '❌'} Ocorreu um erro ao executar o comando ping.` });
                }
            } catch (err) {
                console.error('❌ Erro ao responder:', err);
            }
        }
    }
};