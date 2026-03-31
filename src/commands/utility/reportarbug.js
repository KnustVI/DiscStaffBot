const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// CONFIGURAÇÃO GLOBAL - ID do seu canal de suporte/bugs
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
        const { client, options, user, guild } = interaction;
        
        // PONTO 2: Acesso centralizado aos Emojis que definimos na index.js
        const EMOJIS = client.systems.emojis || {};

        const tipo = options.getString('tipo');
        const msg = options.getString('mensagem');

        // 1. Embed que chega para VOCÊ no seu servidor de suporte
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
            // 2. Busca o canal central de logs do desenvolvedor
            const devChannel = await client.channels.fetch(SEU_CANAL_DE_REPORTS_ID).catch(() => null);

            if (devChannel) {
                await devChannel.send({ embeds: [devEmbed] });
                
                await interaction.editReply({ 
                    content: `${EMOJIS.CHECK || '✅'} **Obrigado!** Seu feedback foi enviado diretamente para o desenvolvedor.`
                });
            } else {
                await interaction.editReply({ 
                    content: `❌ Erro ao contatar a central de suporte. Avise um administrador.`
                });
            }

        } catch (error) {
            console.error("Erro ao enviar feedback:", error);
            await interaction.editReply({ 
                content: `❌ Houve um erro interno ao processar seu envio.` 
            });
        }
    }
};