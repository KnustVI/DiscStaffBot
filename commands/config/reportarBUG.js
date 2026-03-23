const { SlashCommandBuilder, EmbedBuilder, WebhookClient } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');

// CONFIGURAÇÃO GLOBAL
const SEU_CANAL_DE_REPORTS_ID = '1485403522395672717'; 

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reportarbug')
        .setDescription('Envia uma sugestão ou reporta um bug diretamente para o desenvolvedor.')
        .addStringOption(opt => 
            opt.setName('tipo')
                .setDescription('Selecione o tipo de feedback')
                .setRequired(true)
                .addChoices(
                    { name: 'Sugerir Melhoria', value: 'SUGESTÃO' },
                    { name: 'Reportar Bug/Erro', value: 'BUG' }
                ))
        .addStringOption(opt => 
            opt.setName('mensagem')
                .setDescription('Detalhe sua sugestão ou o erro encontrado')
                .setRequired(true)),

    async execute(interaction) {
        const tipo = interaction.options.getString('tipo');
        const msg = interaction.options.getString('mensagem');
        const user = interaction.user;
        const guild = interaction.guild;

        // 1. Embed que chega para VOCÊ no seu servidor
        const devEmbed = new EmbedBuilder()
            .setTitle(`${tipo === 'BUG' ? '🐞 Novo Bug Reportado' : '💡 Nova Sugestão'}`)
            .setColor(tipo === 'BUG' ? 0xEF4444 : 0x3B82F6)
            .addFields(
                { name: 'Enviado por:', value: `${user.tag} (\`${user.id}\`)`, inline: true },
                { name: 'Servidor:', value: `${guild.name} (\`${guild.id}\`)`, inline: true },
                { name: 'Mensagem:', value: `\`\`\`${msg}\`\`\`` }
            )
            .setThumbnail(user.displayAvatarURL())
            .setFooter({ text: `✧ Sistema de Feedback Centralizado`, iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' })
            .setTimestamp();

        try {
            // Tenta buscar o canal globalmente pelo ID
            const devChannel = await interaction.client.channels.fetch(SEU_CANAL_DE_REPORTS_ID).catch(() => null);

            if (devChannel) {
                await devChannel.send({ embeds: [devEmbed] });
                
                // Resposta para o usuário que enviou
                await interaction.reply({ 
                    content: `${EMOJIS.EXCELLENT} **Obrigado!** Seu feedback foi enviado diretamente para o desenvolvedor (KnustVI).`, 
                    ephemeral: true 
                });
            } else {
                await interaction.reply({ 
                    content: `${EMOJIS.ERRO} Erro ao contatar a central de suporte. Tente novamente mais tarde.`, 
                    ephemeral: true 
                });
            }

        } catch (error) {
            console.error("Erro ao enviar feedback:", error);
            await interaction.reply({ content: 'Houve um erro interno ao processar seu envio.', ephemeral: true });
        }
    }
};