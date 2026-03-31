const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('repset')
        .setDescription('Ajusta manualmente os pontos de reputação.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Alvo').setRequired(true))
        .addIntegerOption(opt => opt.setName('pontos').setDescription('Nova pontuação (0-100)').setRequired(true).setMinValue(0).setMaxValue(100))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do ajuste').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     */
    async execute(interaction) {
        const { client, guild, options, user: staff, member: staffMember } = interaction;
        
        // Lookup de sistemas (RAM)
        const { emojis, config, punishment, logger } = client.systems;
        const EMOJIS = emojis || {};

        const target = options.getUser('usuario');
        const newPoints = options.getInteger('pontos');
        const reason = options.getString('motivo');

        try {
            // 1. Trava de Hierarquia (Performance: Fetch apenas se necessário)
            const targetMember = guild.members.cache.get(target.id) || await guild.members.fetch(target.id).catch(() => null);
            
            if (targetMember && targetMember.roles.highest.position >= staffMember.roles.highest.position && staff.id !== guild.ownerId) {
                return await interaction.editReply({ 
                    content: `${EMOJIS.ERRO || '❌'} Você não tem autoridade para ajustar a reputação de um cargo superior ou igual ao seu.` 
                });
            }

            // 2. Execução da Lógica (Delegada ao System)
            // Retorna { oldPoints, newPoints, diff }
            const result = await punishment.setManualReputation(guild.id, target.id, newPoints);
            const diffText = result.diff >= 0 ? `+${result.diff}` : `${result.diff}`;

            // 3. Resposta Imediata (Contrato Slash: editReply)
            await interaction.editReply({
                content: `${EMOJIS.CHECK || '✅'} Reputação de **${target.username}** definida para \`${result.newPoints} pts\` (Alteração: \`${diffText}\`).`
            });

            // 4. Fluxo de Log (Async em segundo plano para não atrasar a interação)
            const logChannelId = config.getSetting(guild.id, 'logs_channel');
            if (logChannelId) {
                const logChannel = guild.channels.cache.get(logChannelId) || await guild.channels.fetch(logChannelId).catch(() => null);
                
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor(result.diff >= 0 ? 0x00FF7F : 0xFF4500)
                        .setAuthor({ name: `Ajuste de Reputação`, iconURL: target.displayAvatarURL() })
                        .setDescription([
                            `**Alvo:** ${target} (\`${target.id}\`)`,
                            `**Moderador:** ${staff}`,
                            `**Ajuste:** \`${diffText} pts\` → Final: \`${result.newPoints}/100\``,
                            `**Motivo:** ${reason}`
                        ].join('\n'))
                        .setFooter({ text: config.getSetting(guild.id, 'footer_text') || guild.name })
                        .setTimestamp();

                    logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                }
            }

        } catch (err) {
            if (logger) logger.log('Command_RepSet_Error', err);
            
            await interaction.editReply({ 
                content: `${EMOJIS.ERRO || '❌'} Erro ao processar ajuste: \`${err.message}\`` 
            }).catch(() => null);
        }
    }
};