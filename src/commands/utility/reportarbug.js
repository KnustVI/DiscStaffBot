const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// ID Centralizado de Suporte (Pode ser movido para o ConfigSystem futuramente)
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

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     */
    async execute(interaction) {
        const { client, options, user, guild } = interaction;
        
        // 1. Lookup de Sistemas (RAM)
        const { emojis, logger } = client.systems;
        const EMOJIS = emojis || {};

        const tipo = options.getString('tipo');
        const msg = options.getString('mensagem');

        try {
            // 2. Busca o canal central (Primeiro no Cache, depois Fetch)
            // Otimização: Evita I/O de rede desnecessário se o canal já estiver mapeado
            const devChannel = client.channels.cache.get(SEU_CANAL_DE_REPORTS_ID) || 
                               await client.channels.fetch(SEU_CANAL_DE_REPORTS_ID).catch(() => null);

            if (!devChannel) {
                return await interaction.editReply({ 
                    content: `${EMOJIS.ERRO || '❌'} A central de suporte está temporariamente offline. Tente novamente mais tarde.` 
                });
            }

            // 3. Construção da Embed para o Desenvolvedor
            const devEmbed = new EmbedBuilder()
                .setAuthor({ name: `Feedback: ${tipo}`, iconURL: user.displayAvatarURL() })
                .setColor(tipo === 'BUG' ? 0xEF4444 : 0x3B82F6)
                .addFields(
                    { name: '👤 Enviado por:', value: `${user.tag} (\`${user.id}\`)`, inline: true },
                    { name: '🌐 Servidor:', value: `${guild.name} (\`${guild.id}\`)`, inline: true },
                    { name: '📝 Mensagem:', value: `\`\`\`text\n${msg}\n\`\`\`` }
                )
                .setFooter({ text: `Sistema Robin Feedback`, iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            // 4. Envio Externo e Resposta ao Usuário
            // Usamos Promise.all se quiséssemos disparar vários envios, 
            // mas aqui priorizamos a confirmação do envio externo primeiro.
            await devChannel.send({ embeds: [devEmbed] });

            // Resposta Final (Contrato Slash: editReply)
            await interaction.editReply({ 
                content: `${EMOJIS.CHECK || '✅'} **Sucesso!** Seu feedback foi enviado para minha central de suporte. Obrigado por contribuir!`
            });

        } catch (error) {
            if (logger) logger.log('Command_ReportarBug_Error', error);
            
            await interaction.editReply({ 
                content: `${EMOJIS.ERRO || '❌'} Houve um erro interno ao processar seu envio.` 
            }).catch(() => null);
        }
    }
};