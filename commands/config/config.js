const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Painel de configurações do sistema de integridade.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('staff-role').setDescription('Define o cargo que pode usar os comandos de moderação')
            .addRoleOption(opt => opt.setName('cargo').setDescription('Selecione o cargo da staff').setRequired(true)))
        .addSubcommand(sub => sub.setName('show').setDescription('Exibe as configurações atuais do servidor'))
        .addSubcommand(sub => sub.setName('logs-channel').setDescription('Define onde os registros de punição serão enviados')
            .addChannelOption(opt => opt.setName('canal').setDescription('Selecione o canal de texto').setRequired(true).addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('alert-channel').setDescription('Define o canal de alertas de baixa reputação')
            .addChannelOption(opt => opt.setName('canal').setDescription('Selecione o canal de texto').setRequired(true).addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('problem-role').setDescription('Cargo para usuários com reputação crítica')
            .addRoleOption(opt => opt.setName('cargo').setDescription('Selecione o cargo').setRequired(true)))
        .addSubcommand(sub => sub.setName('exemplar-role').setDescription('Cargo para usuários com reputação exemplar')
            .addRoleOption(opt => opt.setName('cargo').setDescription('Selecione o cargo').setRequired(true))),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        try {
            if (sub === 'show') {
                const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
                const config = Object.fromEntries(rows.map(r => [r.key, r.value]));

                const embed = new EmbedBuilder()
                    .setTitle(`⚙️ Configurações | ${interaction.guild.name}`)
                    .setColor(0x5865F2)
                    .addFields(
                        { 
                            name: "👮 Permissões",
                            value: `Staff: ${config.staff_role ? `<@&${config.staff_role}>` : "❌ Não definido"}`,
                            inline: false
                        },
                        { 
                            name: "📢 Canais", 
                            value: `Logs: ${config.logs_channel ? `<#${config.logs_channel}>` : "❌ Não definido"}\n` +
                                   `Alertas: ${config.alert_channel ? `<#${config.alert_channel}>` : "❌ Não definido"}`,
                            inline: true 
                        },
                        { 
                            name: "🎭 Cargos Automáticos", 
                            value: `Exemplar: ${config.exemplar_role ? `<@&${config.exemplar_role}>` : "❌ Não definido"}\n` +
                                   `Problemático: ${config.problem_role ? `<@&${config.problem_role}>` : "❌ Não definido"}`,
                            inline: true 
                        }
                    )
                    .setFooter({ text: "Use /config [subcomando] para alterar." });

                return interaction.editReply({ embeds: [embed] });
            }

            // Lógica para Salvar
            let key = sub.replace('-', '_');
            let value;
            let displayValue;

            if (sub.includes('channel')) {
                const channel = interaction.options.getChannel('canal');
                value = channel.id;
                displayValue = `${channel}`;
            } else {
                const role = interaction.options.getRole('cargo');
                value = role.id;
                displayValue = `${role}`;
            }

            db.prepare(`
                INSERT OR REPLACE INTO settings (guild_id, key, value)
                VALUES (?, ?, ?)
            `).run(guildId, key, value);

            return interaction.editReply({ 
                content: `✅ **Configuração atualizada!**\nO parâmetro \`${key}\` agora é ${displayValue}.` 
            });

        } catch (error) {
            console.error(error);
            return interaction.editReply("❌ Erro ao salvar no banco de dados.");
        }
    }
};