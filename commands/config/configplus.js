const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    ChannelType
} = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('configplus')
        .setDescription('Painel central de configuração do DiscStaffBot')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('show').setDescription('Exibe as configurações atuais'))
        .addSubcommand(sub => sub.setName('canais-e-cargos').setDescription('Configura canais e cargos via menu e chat'))
        .addSubcommand(sub => sub.setName('metricas').setDescription('Ajusta os valores de punição (Níveis 1 a 5)')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        // --- LÓGICA: SHOW (PAINEL GERAL) ---
        if (sub === 'show') {
            await interaction.deferReply({ ephemeral: true });
            const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
            const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));

            const embed = new EmbedBuilder()
                .setTitle(`⚙️ Configurações Atuais | ${interaction.guild.name}`)
                .setColor(0xff2e6c)
                .addFields(
                    { name: "🛡️ Moderação", value: `Staff: ${settings.staff_role ? `<@&${settings.staff_role}>` : '❌'}\nLogs: ${settings.logs_channel ? `<#${settings.logs_channel}>` : '❌'}`, inline: true },
                    { name: "🎖️ Automod", value: `Exemplar: ${settings.exemplar_role ? `<@&${settings.exemplar_role}>` : '❌'}\nProblema: ${settings.problem_role ? `<@&${settings.problem_role}>` : '❌'}`, inline: true }
                );

            let metricasStr = "";
            for (let i = 1; i <= 5; i++) {
                metricasStr += `**Nível ${i}:** \`${settings[`punish_${i}_action`] || 'Aviso'}\` | \`${settings[`punish_${i}_time`] || '0'}m\` | \`-${settings[`punish_${i}_rep`] || '0'} pts\`\n`;
            }
            embed.addFields({ name: "📊 Métricas", value: metricasStr });

            return interaction.editReply({ embeds: [embed] });
        }

        // --- LÓGICA: CANAIS E CARGOS (SUA ESTRUTURA ORIGINAL) ---
        if (sub === 'canais-e-cargos') {
            const getSettingsEmbed = () => {
                const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
                const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));

                return new EmbedBuilder()
                    .setTitle(`⚙️ Configuração: Canais e Cargos`)
                    .setColor(0xff2e6c)
                    .setDescription('Selecione uma opção abaixo e depois mencione o cargo/canal no chat.')
                    .addFields(
                        { name: "🛡️ Staff", value: settings.staff_role ? `<@&${settings.staff_role}>` : '❌', inline: true },
                        { name: "📜 Logs", value: settings.logs_channel ? `<#${settings.logs_channel}>` : '❌', inline: true },
                        { name: "🎖️ Exemplar", value: settings.exemplar_role ? `<@&${settings.exemplar_role}>` : '❌', inline: true },
                        { name: "⚠️ Problema", value: settings.problem_role ? `<@&${settings.problem_role}>` : '❌', inline: true }
                    );
            };

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('config_menu_cc')
                    .setPlaceholder('Escolha o que configurar...')
                    .addOptions([
                        { label: 'Cargo Staff', value: 'staff_role', emoji: '🛡️' },
                        { label: 'Canal de Logs', value: 'logs_channel', emoji: '📜' },
                        { label: 'Cargo Exemplar', value: 'exemplar_role', emoji: '🎖️' },
                        { label: 'Cargo Problema', value: 'problem_role', emoji: '⚠️' },
                    ])
            );

            const response = await interaction.reply({ embeds: [getSettingsEmbed()], components: [row], ephemeral: true });

            const collector = response.createMessageComponentCollector({ time: 60000 });

            collector.on('collect', async i => {
                const selection = i.values[0];
                await i.reply({ content: `👉 Mencione agora o **${selection.includes('role') ? 'Cargo' : 'Canal'}** aqui no chat.`, ephemeral: true });

                const messageCollector = interaction.channel.createMessageCollector({ 
                    filter: m => m.author.id === interaction.user.id, 
                    time: 30000, 
                    max: 1 
                });

                messageCollector.on('collect', async m => {
                    const value = selection.includes('channel') ? m.mentions.channels.first()?.id : m.mentions.roles.first()?.id;

                    if (!value) return m.reply({ content: "❌ Inválido! Tente novamente.", ephemeral: true });

                    db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`)
                      .run(guildId, selection, value);

                    await m.delete().catch(() => null);
                    await i.editReply({ content: `✅ **${selection}** atualizado!`, ephemeral: true });
                    await interaction.editReply({ embeds: [getSettingsEmbed()] });
                });
            });
        }

        // --- LÓGICA: MÉTRICAS (SUA ESTRUTURA ORIGINAL COM PARSETIME) ---
        if (sub === 'metricas') {
            const parseTimeToMinutes = (input) => {
                const lower = input.toLowerCase().trim();
                const number = parseFloat(lower.replace(/[^\d.]/g, ''));
                if (isNaN(number)) return null;
                if (lower.endsWith('h')) return Math.round(number * 60);
                if (lower.endsWith('d')) return Math.round(number * 1440);
                if (lower.endsWith('m') || !/[a-z]/.test(lower)) return Math.round(number);
                return null;
            };

            const getMetricsEmbed = () => {
                const embed = new EmbedBuilder().setTitle("📊 Ajuste de Métricas").setColor(0xff2e6c).setDescription("Selecione o nível para editar via Modal.");
                for (let i = 1; i <= 5; i++) {
                    const row = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`);
                    embed.addFields({ 
                        name: `Nível ${i}`, 
                        value: `**Ação:** \`${row.get(guildId, `punish_${i}_action`)?.value || "Padrão"}\` | **Tempo:** \`${row.get(guildId, `punish_${i}_time`)?.value || "0"}m\`` 
                    });
                }
                return embed;
            };

            const menu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('sel_lvl_met').setPlaceholder('Escolha o nível...')
                    .addOptions([1, 2, 3, 4, 5].map(n => ({ label: `Nível ${n}`, value: `${n}`, emoji: '⚙️' })))
            );

            const resp = await interaction.reply({ embeds: [getMetricsEmbed()], components: [menu], ephemeral: true });
            const col = resp.createMessageComponentCollector({ time: 300000 });

            col.on('collect', async i => {
                const lvl = i.values[0];
                const modal = new ModalBuilder().setCustomId(`mod_${lvl}`).setTitle(`Nível ${lvl}`);
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('a').setLabel("AÇÃO").setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('t').setLabel("TEMPO (Ex: 2h, 1d)").setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('r').setLabel("REPUTAÇÃO").setStyle(TextInputStyle.Short).setRequired(true))
                );
                await i.showModal(modal);

                const sub = await i.awaitModalSubmit({ time: 60000, filter: m => m.user.id === interaction.user.id }).catch(() => null);
                if (sub) {
                    const mins = parseTimeToMinutes(sub.fields.getTextInputValue('t'));
                    if (mins === null) return sub.reply({ content: "❌ Tempo inválido!", ephemeral: true });
                    
                    const save = db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`);
                    save.run(guildId, `punish_${lvl}_action`, sub.fields.getTextInputValue('a'));
                    save.run(guildId, `punish_${lvl}_time`, mins.toString());
                    save.run(guildId, `punish_${lvl}_rep`, sub.fields.getTextInputValue('r').replace(/[^\d]/g, ''));

                    await sub.reply({ content: `✅ Nível ${lvl} salvo!`, ephemeral: true });
                    await interaction.editReply({ embeds: [getMetricsEmbed()] });
                }
            });
        }
    }
};