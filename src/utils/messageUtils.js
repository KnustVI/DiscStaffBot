async function replyAndDelete(interaction, content, options = {}) {
    const { ephemeral = true, delay = 10000, type = 'reply' } = options;
    
    try {
        let message;
        
        if (type === 'reply') {
            message = await interaction.reply({ content, ephemeral, fetchReply: true });
        } else if (type === 'edit') {
            message = await interaction.editReply({ content });
        } else if (type === 'followUp') {
            message = await interaction.followUp({ content, ephemeral, fetchReply: true });
        }
        
        if (message && ephemeral) {
            setTimeout(async () => {
                try {
                    await message.delete();
                } catch (err) {
                    // Ignora erro se já foi deletada
                }
            }, delay);
        }
        
        return message;
    } catch (error) {
        console.error('❌ Erro ao enviar resposta:', error);
        return null;
    }
}