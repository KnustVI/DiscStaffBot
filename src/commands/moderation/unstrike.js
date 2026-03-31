const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unstrike')
        .setDescription('Anula uma punição e devolve os pontos ao usuário.')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID único da punição no banco').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da anulação').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     */
    async execute(interaction) {
        const { client, guild, options, user: staff } = interaction;
        
        // 1. Lookup de Sistemas (RAM)
        const { emojis, punishment, logger, config } = client.systems;
        const EMOJIS = emojis || {};

        const punishmentId = options.getInteger('id');
        const reason = options.getString('motivo');

        try {
            // 2. Execução da Lógica (Delegada ao System)
            // O system deve retornar { success, targetId, pointsRestored, message }
            const result = await punishment.executeUnstrike({
                guildId: guild.id,
                punishmentId,
                moderatorId: staff.id,
                reason
            });

            // 3. Validação de Resultado
            if (!result || !result.success) {
                return await interaction.editReply({
                    content: `${EMOJIS.ERRO || '❌'} **Erro ao anular:** ${result?.message || 'ID de punição não encontrado ou já anulado.'}`
                });
            }

            // 4. Resposta Final (Contrato Slash: editReply)
            await interaction.editReply({
                content: [
                    `${EMOJIS.CHECK || '✅'} **Punição #${punishmentId} Anulada!**`,
                    `👤 **Alvo:** <@${result.targetId}>`,
                    `📊 **Pontos Devolvidos:** \`+${result.pointsRestored}\``,
                    `📝 **Motivo da Anulação:** ${reason}`
                ].join('\n')
            });

            // 5. Log de Auditoria (Async - Background)
            punishment.dispatchUnstrikeLogs({
                guild,
                punishmentId,
                targetId: result.targetId,
                moderator: staff,
                reason,
                footer: config.getSetting(guild.id, 'footer_text')
            }).catch(e => logger?.log('Unstrike_Log_Error', e));

        } catch (err) {
            if (logger) logger.log('Command_Unstrike_Error', err);
            
            await interaction.editReply({
                content: `${EMOJIS.ERRO || '❌'} **Falha crítica ao processar anulação:** \`${err.message}\``
            }).catch(() => null);
        }
    }
};