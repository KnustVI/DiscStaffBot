const { SlashCommandBuilder } = require('discord.js');
const ConfigSystem = require('../../systems/configSystem');
const PunishmentSystem = require('../../systems/punishmentSystem');
const { EMOJIS } = require('../../database/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unstrike')
        .setDescription('Remove uma punição específica pelo ID.')
        .addIntegerOption(opt => opt.setName('id').setDescription('O ID que aparece no histórico (Ex: 12)').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('O motivo da anulação').setRequired(true)),

    async execute(interaction) {
        // 1. Sinaliza o processamento imediatamente (Seguro anti-timeout)
        await interaction.deferReply({ ephemeral: true });

        // 2. Verificação de Autorização (Padrão Novo)
        const auth = await ConfigSystem.checkAuth(interaction);
        if (!auth.authorized) {
            return await interaction.editReply({ content: auth.message });
        }

        const pId = interaction.options.getInteger('id');
        const motivo = interaction.options.getString('motivo');
        
        try {
            // 3. Execução da Anulação no Motor (PunishmentSystem)
            const success = await PunishmentSystem.executeUnstrike({
                guild: interaction.guild,
                punishmentId: pId,
                moderator: interaction.user,
                reason: motivo 
            });

            if (!success) {
                return await interaction.editReply({
                    content: `${EMOJIS.ERRO || '❌'} **Erro:** Punição não encontrada ou ID inválido para este servidor.`
                });
            }

            // 4. Resposta de Sucesso
            await interaction.editReply({
                content: `${EMOJIS.CHECK || '✅'} **Sucesso!** A punição **#${pId}** foi anulada, os pontos foram devolvidos e o log foi gerado.`
            });

        } catch (err) {
            console.error(`[Unstrike Error]`, err);
            await interaction.editReply({
                content: `${EMOJIS.ERRO || '❌'} **Falha crítica ao anular:**\n\`${err.message}\``
            });
        }
    }
};