const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-rep')
        .setDescription('⚙️ Configura o sistema de Reputação e Punições.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        // Sub-comando para os Cargos
        .addSubcommand(sub => sub.setName('cargos')
            .setDescription('Define os cargos de reputação.')
            .addRoleOption(opt => opt.setName('exemplar').setDescription('Cargo para bons jogadores (Rep > Limit)'))
            .addRoleOption(opt => opt.setName('problematico').setDescription('Cargo para infratores (Rep < Limit)'))
            .addRoleOption(opt => opt.setName('strike').setDescription('Cargo temporário aplicado no /strike')))
        // Sub-comando para os Limites (Métricas)
        .addSubcommand(sub => sub.setName('limites')
            .setDescription('Define as métricas de pontos para troca de cargos.')
            .addIntegerOption(opt => opt.setName('meta_exemplar').setDescription('Pontos mínimos para ser Exemplar (Ex: 90)').setMinValue(50).setMaxValue(100))
            .addIntegerOption(opt => opt.setName('alerta_ruim').setDescription('Pontos máximos para ser Problemático (Ex: 40)').setMinValue(0).setMaxValue(50))),

    async execute(interaction) {
        const { client, guild, options } = interaction;
        const Config = client.systems.config;
        const EMOJIS = client.systems.emojis || {};
        const sub = options.getSubcommand();

        try {
            let desc = [];

            if (sub === 'cargos') {
                const roles = {
                    role_exemplar: options.getRole('exemplar'),
                    role_problematico: options.getRole('problematico'),
                    role_strike: options.getRole('strike')
                };

                for (const [key, role] of Object.entries(roles)) {
                    if (role) {
                        await Config.setSetting(guild.id, key, role.id);
                        desc.push(`- **${key.replace('role_', '').toUpperCase()}:** ${role}`);
                    }
                }
            }

            if (sub === 'limites') {
                const limits = {
                    limit_exemplar: options.getInteger('meta_exemplar'),
                    limit_problematico: options.getInteger('alerta_ruim')
                };

                for (const [key, val] of Object.entries(limits)) {
                    if (val !== null) {
                        await Config.setSetting(guild.id, key, val.toString());
                        desc.push(`- **${key.replace('limit_', '').toUpperCase()}:** \`${val} pts\``);
                    }
                }
            }

            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.SETTINGS || '⚙️'} Configuração Atualizada`)
                .setColor('#5865F2')
                .setDescription(desc.join('\n') || 'Nenhuma alteração feita.')
                .setFooter(Config.getFooter(guild.name));

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            if (client.systems.logger) client.systems.logger.log('ConfigRep_Error', err);
            await interaction.editReply({ content: `❌ Erro ao salvar configurações: ${err.message}` });
        }
    }
};