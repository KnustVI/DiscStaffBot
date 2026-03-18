const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle 
} = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Painel central de configuração do DiscStaffBot')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('show').setDescription('Exibe o resumo das configurações atuais'))
        .addSubcommand(sub => sub.setName('canais-e-cargos').setDescription('Configura canais e cargos (Menu + Chat)'))
        .addSubcommand(sub => sub.setName('metricas').setDescription('Ajusta os valores de punição (Menu + Modal)')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        // ==========================================
        // LÓGICA: SHOW (RESUMO RÁPIDO)
        // ==========================================
        if (sub === 'show') {
            await interaction.deferReply({ ephemeral: true });
            const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
            const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));

            const embed = new EmbedBuilder()
                .setTitle(`⚙️ Status: ${interaction.guild.name}`)
                .setColor(0xff2e6c)
                .addFields(
                    { name: "🛡️ Moderação", value: `Staff: ${cfg.staff_role ? `<@&${cfg.staff_role}>` : '❌'}\nLogs: ${cfg.logs_channel ? `<#${cfg.logs_channel}>` : '❌'}`, inline: true },
                    { name: "🎖️ Automod", value: `Exemplar: ${cfg.exemplar_role ? `<@&${cfg.exemplar_role}>` : '❌'}\nProblema: ${cfg.problem_role ? `<@&${cfg.problem_role}>` : '❌'}`, inline: true }
                );

            return interaction.editReply({ embeds: [embed] });
        }

        // ==========================================
        // LÓGICA: CANAIS E CARGOS (SUA ESTRUTURA ORIGINAL)
        // ==========================================
        if (sub === 'canais-e-cargos') {
            const getSettingsEmbed = () => {
                const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
                const settings = {};
                rows.forEach(row => settings[row.key] = row.value);

                return new EmbedBuilder()
                    .setTitle(`⚙️ Configurações: ${interaction.guild.name}`)
                    .setColor(0xff2e6c)
                    .setDescription('Selecione uma opção no menu abaixo para configurar as funções do bot.')
                    .addFields(
                        { 
                            name: "🛡️ Sistema de Moderação", 
                            value: `**Cargo Staff:** ${settings.staff_role ? `<@&${settings.staff_role}>` : '❌ *Não definido*'}\n` +
                                   `> *Necessário para usar comandos como /punir e /delpunir.*`, 
                            inline: false 
                        },
                        { 
                            name: "📜 Registro de Auditoria", 
                            value: `**Canal de Logs:** ${settings.logs_channel ? `<#${settings.logs_channel}>` : '❌ *Não definido*'}\n` +
                                   `> *Onde todas as punições e anulações serão registradas.*`, 
                            inline: false 
                        },
                        { 
                            name: "🎖️ Cargos de Comportamento (Automod)", 
                            value: `**Cargo Exemplar:** ${settings.exemplar_role ? `<@&${settings.exemplar_role}>` : '❌ *Não definido*'}\n` +
                                   `**Cargo Problema:** ${settings.problem_role ? `<@&${settings.problem_role}>` : '❌ *Não definido*'}`, 
                            inline: false 
                        }
                    )
                    .setFooter({ text: "Apenas Administradores podem alterar estas definições." })
                    .setTimestamp();
            };

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('config_menu_cc')
                    .setPlaceholder('Escolha o que deseja configurar...')
                    .addOptions([
                        { label: 'Cargo Staff', description: 'Define quem pode usar comandos de moderação.', value: 'staff_role', emoji: '🛡️' },
                        { label: 'Canal de Logs', description: 'Define onde as punições serão registradas.', value: 'logs_channel', emoji: '📜' },
                        { label: 'Cargo Exemplar', description: 'Cargo para jogadores com conduta excelente.', value: 'exemplar_role', emoji: '🎖️' },
                        { label: 'Cargo Problema', description: 'Cargo para jogadores com muitas punições.', value: 'problem_role', emoji: '⚠️' },
                    ])
            );

            await interaction.reply({ embeds: [getSettingsEmbed()], components: [row], ephemeral: true });

            const collector = interaction.channel.createMessageComponentCollector({
                filter: i => i.customId === 'config_menu_cc' && i.user.id === interaction.user.id,
                time: 60000
            });

            collector.on('collect', async i => {
                const selection = i.values[0];
                const instructions = {
                    staff_role: "Mencione o **Cargo** que terá permissão de moderador (ex: @Staff).",
                    logs_channel: "Mencione o **Canal** onde as punições serão logadas (ex: #logs-punicoes).",
                    exemplar_role: "Mencione o **Cargo** que os jogadores exemplares ganharão.",
                    problem_role: "Mencione o **Cargo** que os jogadores problemáticos receberão."
                };

                await i.reply({ content: `👉 **Configurando ${selection}:** ${instructions[selection]}`, ephemeral: true });

                const messageCollector = interaction.channel.createMessageCollector({ 
                    filter: m => m.author.id === interaction.user.id, 
                    time: 30000, 
                    max: 1 
                });

                messageCollector.on('collect', async m => {
                    let value = selection.includes('channel') ? m.mentions.channels.first()?.id : m.mentions.roles.first()?.id;

                    if (!value) return m.reply({ content: "❌ Menção inválida. Tente novamente o comando.", ephemeral: true });

                    db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`)
                      .run(guildId, selection, value);

                    await m.delete().catch(() => null);
                    await i.editReply({ content: `✅ **Sucesso!** O valor de \`${selection}\` foi atualizado.`, ephemeral: true });
                    await interaction.editReply({ embeds: [getSettingsEmbed()] });
                });
            });
        }

        // ==========================================
        // LÓGICA: MÉTRICAS (SUA ESTRUTURA ORIGINAL)
        // ==========================================
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
                const embed = new EmbedBuilder()
                    .setTitle(`📊 Ajuste de Métricas: ${interaction.guild.name}`)
                    .setColor(0xff2e6c)
                    .setDescription('Selecione um nível abaixo para editar. Formatos: `30`, `2h`, `1d`.');

                for (let i = 1; i <= 5; i++) {
                    const action = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, `punish_${i}_action`)?.value || "Padrão";
                    const time = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, `punish_${i}_time`)?.value || "0";
                    const rep = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, `punish_${i}_rep`)?.value || "0";
                    embed.addFields({ name: `Nível ${i}`, value: `**Ação:** \`${action}\` | **Tempo:** \`${time}m\` | **Rep:** \`-${rep} pts\`` });
                }
                return embed;
            };

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_level')
                    .setPlaceholder('Escolha o nível para editar...')
                    .addOptions([1,2,3,4,5].map(n => ({ label: `Nível ${n}`, value: `${n}`, emoji: '⚙️' })))
            );

            const resp = await interaction.reply({ embeds: [getMetricsEmbed()], components: [row], ephemeral: true });
            const col = resp.createMessageComponentCollector({ time: 300000 });

            col.on('collect', async i => {
                if (i.customId === 'select_level') {
                    const level = i.values[0];
                    const modal = new ModalBuilder().setCustomId(`modal_${level}_${Date.now()}`).setTitle(`Configurar Nível ${level}`);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('action_name').setLabel("NOME DA AÇÃO").setStyle(TextInputStyle.Short).setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('time_value').setLabel("TEMPO (Ex: 30, 2h, 1d)").setStyle(TextInputStyle.Short).setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rep_value').setLabel("PERDA DE REPUTAÇÃO").setStyle(TextInputStyle.Short).setRequired(true))
                    );

                    await i.showModal(modal);

                    try {
                        const submitted = await i.awaitModalSubmit({ time: 60000, filter: m => m.user.id === interaction.user.id });
                        if (submitted) {
                            const rawTime = submitted.fields.getTextInputValue('time_value');
                            const convertedTime = parseTimeToMinutes(rawTime);

                            if (convertedTime === null) return submitted.reply({ content: "❌ Formato de tempo inválido!", ephemeral: true });

                            db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`).run(guildId, `punish_${level}_action`, submitted.fields.getTextInputValue('action_name'));
                            db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`).run(guildId, `punish_${level}_time`, convertedTime.toString());
                            db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`).run(guildId, `punish_${level}_rep`, submitted.fields.getTextInputValue('rep_value').replace(/[^\d]/g, ''));

                            await submitted.reply({ content: `✅ Nível ${level} atualizado!`, ephemeral: true });
                            await interaction.editReply({ embeds: [getMetricsEmbed()] });
                        }
                    } catch (e) { /* timeout */ }
                }
            });
        }
    }
};