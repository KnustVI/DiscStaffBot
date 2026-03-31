const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-rep')
        .setDescription('⚙️ Configura o sistema de Reputação e Punições.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('cargos')
            .setDescription('Define os cargos vinculados aos níveis de reputação.')
            .addRoleOption(opt => opt.setName('exemplar').setDescription('Cargo para bons jogadores (Reputação Alta)'))
            .addRoleOption(opt => opt.setName('problematico').setDescription('Cargo para infratores (Reputação Baixa)'))
            .addRoleOption(opt => opt.setName('strike').setDescription('Cargo temporário aplicado durante punições')))
        .addSubcommand(sub => sub.setName('limites')
            .setDescription('Define os gatilhos de pontos para a troca automática de cargos.')
            .addIntegerOption(opt => opt.setName('meta_exemplar').setDescription('Mínimo para ser Exemplar (Sugerido: 95)').setMinValue(50).setMaxValue(100))
            .addIntegerOption(opt => opt.setName('alerta_ruim').setDescription('Máximo para ser Problemático (Sugerido: 30)').setMinValue(0).setMaxValue(50))),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     */
    async execute(interaction) {
        const { client, guild, options } = interaction;
        
        // Lookup de Sistemas (RAM)
        const { config, emojis, logger } = client.systems;
        const EMOJIS = emojis || {};
        const sub = options.getSubcommand();

        try {
            let changes = [];

            // --- SUBCOMANDO: CARGOS ---
            if (sub === 'cargos') {
                const rolesToSet = [
                    { key: 'role_exemplar', role: options.getRole('exemplar') },
                    { key: 'role_problematico', role: options.getRole('problematico') },
                    { key: 'role_strike', role: options.getRole('strike') }
                ];

                for (const item of rolesToSet) {
                    if (item.role) {
                        // Persistência síncrona no Cache + SQLite
                        config.setSetting(guild.id, item.key, item.role.id);
                        changes.push(`${EMOJIS.CHECK || '✅'} **${item.key.replace('role_', '').toUpperCase()}:** ${item.role}`);
                    }
                }
            }

            // --- SUBCOMANDO: LIMITES ---
            if (sub === 'limites') {
                const limitsToSet = [
                    { key: 'limit_exemplar', val: options.getInteger('meta_exemplar') },
                    { key: 'limit_problematico', val: options.getInteger('alerta_ruim') }
                ];

                for (const item of limitsToSet) {
                    if (item.val !== null) {
                        // Importante: Guardar como string no banco, o AutoMod faz o parseInt
                        config.setSetting(guild.id, item.key, item.val.toString());
                        changes.push(`${EMOJIS.CHECK || '✅'} **${item.key.replace('limit_', '').toUpperCase()}:** \`${item.val} pontos\``);
                    }
                }
            }

            // --- RESPOSTA VISUAL ---
            if (changes.length === 0) {
                return await interaction.editReply({ 
                    content: `${EMOJIS.WARNING || '⚠️'} Nenhuma alteração foi especificada. Selecione pelo menos uma opção.` 
                });
            }

            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.SETTINGS || '⚙️'} Reputação: Regras Atualizadas`)
                .setColor('#5865F2')
                .setDescription(`As novas diretrizes foram aplicadas e o **AutoMod** passará a utilizá-las no próximo ciclo.\n\n${changes.join('\n')}`)
                .setFooter(config.getFooter(guild.name))
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            if (logger) logger.log('ConfigRep_Cmd_Error', err);
            console.error("❌ Erro no config-rep:", err);
            
            await interaction.editReply({ 
                content: `${EMOJIS.ERRO || '❌'} Erro crítico ao salvar diretrizes: \`${err.message}\`` 
            }).catch(() => null);
        }
    }
};