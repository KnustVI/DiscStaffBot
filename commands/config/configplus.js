const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Painel central de configuração do DiscStaffBot')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('show').setDescription('Exibe TODAS as configurações atuais do bot'))
        .addSubcommand(sub => sub.setName('canais-e-cargos').setDescription('Configura canais e cargos (Menu + Chat)'))
        .addSubcommand(sub => sub.setName('metricas').setDescription('Ajusta os valores de punição (Menu + Modal)'))
        .addSubcommand(sub => sub.setName('configreset').setDescription('RESETA as configurações (Canais, Cargos e Métricas)')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        // ==========================================
        // LÓGICA: SHOW (EXIBE TUDO EM UM EMBED)
        // ==========================================
        if (sub === 'show') {
            await interaction.deferReply({ ephemeral: true });
            const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
            const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));

            const embed = new EmbedBuilder()
                .setColor(0xff2e6c)
                .setThumbnail(interaction.guild.iconURL())
                .setDescription(`# ⚙️ Painel de Controle: ${interaction.guild.name}\n` +
                    'Aqui estão todas as definições salvas no banco de dados.\n'+
                    `Use /config [subcomando] para alterar algo.`
                )
                .addFields(
                    { 
                        name: "🛡️ Sistema & Canais", 
                        value: `**Cargo Staff:** ${cfg.staff_role ? `<@&${cfg.staff_role}>` : '❌'}\n` +
                               `**Canal de Logs:** ${cfg.logs_channel ? `<#${cfg.logs_channel}>` : '❌'}\n` +
                               `**Canal Alertas:** ${cfg.alert_channel ? `<#${cfg.alert_channel}>` : '❌'}`, 
                        inline: true 
                    },
                    { 
                        name: "🎖️ Cargos Automáticos", 
                        value: `**Exemplar:** ${cfg.exemplar_role ? `<@&${cfg.exemplar_role}>` : '❌'}\n` +
                               `**Problema:** ${cfg.problem_role ? `<@&${cfg.problem_role}>` : '❌'}`, 
                        inline: true 
                    }
                )
                .setFooter({ 
                text: interaction.guild.name, 
                iconURL: interaction.guild
                .iconURL({ dynamic: true })})
                .setTimestamp()

            let metricsText = "";
            for (let i = 1; i <= 5; i++) {
                const action = cfg[`punish_${i}_action`] || "Não definido";
                const time = cfg[`punish_${i}_time`] || "0";
                const rep = cfg[`punish_${i}_rep`] || "0";
                metricsText += `**Nível ${i}:** \`${action}\` | \`${time}m\` | \`-${rep} pts\`\n`;
            }

            embed.addFields({ name: "📊 Métricas de Punição", value: metricsText, inline: false });
            embed.setFooter({ 
                text: interaction.guild.name, 
                iconURL: interaction.guild
                .iconURL({ dynamic: true })})
                .setTimestamp()
                

            return interaction.editReply({ embeds: [embed] });
        }

        // ==========================================
        // LÓGICA: CANAIS E CARGOS
        // ==========================================
        if (sub === 'canais-e-cargos') {
            const getSettingsEmbed = () => {
                const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
                const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));

                return new EmbedBuilder()
                    .setColor(0xff2e6c)
                    .setDescription(`# ⚙️ Configurações: ${interaction.guild.name}\n` +
                        'Selecione uma opção no menu abaixo para configurar as funções do bot.')
                    .addFields(
                        { 
                            name: "🛡️ Sistema de Moderação", 
                            value: `**Cargo Staff:** ${settings.staff_role ? `<@&${settings.staff_role}>` : '❌ *Não definido*'}\n> *Necessário para usar comandos como /punir.*`, 
                            inline: false 
                        },
                        { 
                            name: "📜 Registros e Alertas", 
                            value: `**Canal de Logs:** ${settings.logs_channel ? `<#${settings.logs_channel}>` : '❌ *Não definido*'}\n` +
                                   `**Canal de Alertas:** ${settings.alert_channel ? `<#${settings.alert_channel}>` : '❌ *Não definido*'}\n` +
                                   `> *Canais onde punições, auditoria de staff e alertas críticos serão enviados.*`, 
                            inline: false 
                        },
                        { 
                            name: "🎖️ Cargos de Comportamento", 
                            value: `**Cargo Exemplar:** ${settings.exemplar_role ? `<@&${settings.exemplar_role}>` : '❌ *Não definido*'}\n**Cargo Problema:** ${settings.problem_role ? `<@&${settings.problem_role}>` : '❌ *Não definido*'}`, 
                            inline: false 
                        }
                    )
                    .setFooter({ text: "Apenas Administradores podem alterar estas definições." }).setTimestamp();
            };

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('config_menu_cc')
                    .setPlaceholder('Escolha o que deseja configurar...')
                    .addOptions([
                        { label: 'Cargo Staff', description: 'Define quem pode usar comandos de moderação.', value: 'staff_role', emoji: '🛡️' },
                        { label: 'Canal de Logs', description: 'Onde todas as punições serão registradas.', value: 'logs_channel', emoji: '📜' },
                        { label: 'Canal de Alertas', description: 'Para monitoramento de usuários críticos e staff.', value: 'alert_channel', emoji: '⚠️' },
                        { label: 'Cargo Exemplar', description: 'Cargo para jogadores com conduta excelente.', value: 'exemplar_role', emoji: '🎖️' },
                        { label: 'Cargo Problema', description: 'Cargo para jogadores com muitas punições.', value: 'problem_role', emoji: '🚨' },
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
                    alert_channel: "Mencione o **Canal** onde o bot enviará alertas críticos (ex: #alertas-staff).",
                    exemplar_role: "Mencione o **Cargo** que os jogadores exemplares ganharão.",
                    problem_role: "Mencione o **Cargo** que os jogadores problemáticos receberão."
                };

                await i.reply({ content: `👉 **Configurando ${selection.replace('_', ' ')}:** ${instructions[selection]}`, ephemeral: true });

                const messageCollector = interaction.channel.createMessageCollector({ 
                    filter: m => m.author.id === interaction.user.id, 
                    time: 30000, 
                    max: 1 
                });

                messageCollector.on('collect', async m => {
                    const value = selection.includes('channel') ? m.mentions.channels.first()?.id : m.mentions.roles.first()?.id;
                    if (!value) return m.reply({ content: "❌ Menção inválida. Tente novamente o comando.", ephemeral: true });

                    db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`).run(guildId, selection, value);
                    await m.delete().catch(() => null);
                    await i.editReply({ content: `✅ **Sucesso!** O canal/cargo de \`${selection}\` foi atualizado.`, ephemeral: true });
                    await interaction.editReply({ embeds: [getSettingsEmbed()] });
                });
            });
        }

        // ==========================================
        // LÓGICA: MÉTRICAS
        // ==========================================
        if (sub === 'metricas') {
            const parseTimeToMinutes = (input) => {
                const lowerInput = input.toLowerCase().trim();
                const number = parseFloat(lowerInput.replace(/[^\d.]/g, ''));
                if (isNaN(number)) return null;
                if (lowerInput.endsWith('h')) return Math.round(number * 60);
                if (lowerInput.endsWith('d')) return Math.round(number * 1440);
                if (lowerInput.endsWith('m') || !/[a-z]/.test(lowerInput)) return Math.round(number);
                return null;
            };

            const getMetricsEmbed = () => {
                const embed = new EmbedBuilder()
                    .setColor(0xff2e6c)
                    .setDescription(`# 📊 Ajuste de Métricas: ${interaction.guild.name}\n` +
                        'Selecione um nível abaixo para editar via Modal.')
                    .setFooter({ 
                        text: interaction.guild.name, 
                        iconURL: interaction.guild
                        .iconURL({ dynamic: true })}) 
                        .setTimestamp()

                for (let i = 1; i <= 5; i++) {
                    const action = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, `punish_${i}_action`)?.value || "Aviso";
                    const time = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, `punish_${i}_time`)?.value || "0";
                    const rep = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, `punish_${i}_rep`)?.value || "0";
                    embed.addFields({ name: `Nível ${i}`, value: `**Ação:** \`${action}\` | **Tempo:** \`${time}m\` | **Rep:** \`-${rep} pts\`` });
                }
                return embed;
            };

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('select_level').setPlaceholder('Escolha o nível para editar...')
                    .addOptions([1, 2, 3, 4, 5].map(n => ({ label: `Nível ${n}`, value: `${n}`, emoji: '⚙️' })))
            );

            const response = await interaction.reply({ embeds: [getMetricsEmbed()], components: [row], ephemeral: true });
            const collector = response.createMessageComponentCollector({ time: 300000 });

            collector.on('collect', async i => {
                const level = i.values[0];
                const modal = new ModalBuilder().setCustomId(`modal_${level}_${Date.now()}`).setTitle(`Configurar Nível ${level}`);
                
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('action_name')
                            .setLabel("PUNIÇÃO (Aviso, Timeout ou Ban)")
                            .setPlaceholder("Ex: Timeout")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('time_value')
                            .setLabel("TEMPO DE DURAÇÃO (Sufixos: h(horas), d(dias)")
                            .setPlaceholder("Ex: 30 (minutos), 2h (horas), 1d (dia). Use 0 para nenhum tempo de punição")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('rep_value')
                            .setLabel("PERDA DE REPUTAÇÃO (APENAS NÚMEROS)")
                            .setPlaceholder("Ex: 10 (isso removerá 10 pontos do jogador).")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    )
                );

                await i.showModal(modal);

                try {
                    const submitted = await i.awaitModalSubmit({ time: 60000, filter: m => m.user.id === interaction.user.id });
                    if (submitted) {
                        const rawAction = submitted.fields.getTextInputValue('action_name').toLowerCase().trim();
                        
                        // Validação para garantir que o bot consiga executar a punição depois
                        const validActions = ['aviso', 'timeout', 'ban', 'kick'];
                        // Pequeno "mapeador" caso o ADM digite termos comuns
                        let actionFinal = "aviso";
                        if (rawAction.includes('time') || rawAction.includes('muto')) actionFinal = 'timeout';
                        else if (rawAction.includes('ban')) actionFinal = 'ban';
                        else if (rawAction.includes('kick') || rawAction.includes('expul')) actionFinal = 'kick';

                        const mins = parseTimeToMinutes(submitted.fields.getTextInputValue('time_value'));
                        if (mins === null) return submitted.reply({ content: "❌ Tempo inválido!", ephemeral: true });

                        db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`).run(guildId, `punish_${level}_action`, actionFinal);
                        db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`).run(guildId, `punish_${level}_time`, mins.toString());
                        db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`).run(guildId, `punish_${level}_rep`, submitted.fields.getTextInputValue('rep_value').replace(/[^\d]/g, ''));

                        await submitted.reply({ content: `✅ Nível ${level} atualizado para a ação: **${actionFinal}**!`, ephemeral: true });
                        await interaction.editReply({ embeds: [getMetricsEmbed()] });
                    }
                } catch (e) { /* timeout */ }
            });
        }

        // ==========================================
        // LÓGICA: CONFIGRESET
        // ==========================================
        if (sub === 'reset') {
            const confirm = new ButtonBuilder().setCustomId('confirm_reset').setLabel('Sim, resetar tudo').setStyle(ButtonStyle.Danger);
            const cancel = new ButtonBuilder().setCustomId('cancel_reset').setLabel('Cancelar').setStyle(ButtonStyle.Secondary);
            const row = new ActionRowBuilder().addComponents(confirm, cancel);

            const response = await interaction.reply({
                content: '⚠️ **ATENÇÃO:** Você está prestes a apagar todas as configurações (canais, cargos e métricas) deste servidor. As punições existentes não serão afetadas. Deseja continuar?',
                components: [row],
                ephemeral: true
            });

            const collector = response.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: 30000 });

            collector.on('collect', async i => {
                if (i.customId === 'confirm_reset') {
                    db.prepare(`DELETE FROM settings WHERE guild_id = ?`).run(guildId);
                    await i.update({ content: '✅ **Configurações resetadas!** O servidor voltou ao estado inicial.', components: [] });
                } else {
                    await i.update({ content: '❌ Reset cancelado.', components: [] });
                }
            });
        }
    }
};