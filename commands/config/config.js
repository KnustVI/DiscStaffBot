const { 
    SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, 
    StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    ButtonBuilder, ButtonStyle
} = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Painel central de configuração do DiscStaffBot')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('show').setDescription('Exibe TODAS as configurações atuais'))
        .addSubcommand(sub => sub.setName('canais-e-cargos').setDescription('Configura canais e cargos'))
        .addSubcommand(sub => sub.setName('metricas').setDescription('Ajusta os valores de punição'))
        .addSubcommand(sub => sub.setName('reset').setDescription('RESETA as configurações')), // CORRIGIDO: nome curto para bater com a lógica

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        // --- SUBCOMANDO: SHOW ---
        if (sub === 'show') {
            await interaction.deferReply({ ephemeral: true });
            const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
            const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));

            const embed = new EmbedBuilder()
                .setColor(0xFF3C72)
                .setThumbnail(interaction.guild.iconURL())
                .setTitle(`${EMOJIS.PAINEL} Configurações de ${interaction.guild.name}`)
                .addFields(
                    { 
                        name: `${EMOJIS.TICKET} Canais`, 
                        value: `**Logs:** ${cfg.logs_channel ? `<#${cfg.logs_channel}>` : '❌'}\n**Alertas:** ${cfg.alert_channel ? `<#${cfg.alert_channel}>` : '❌'}`, 
                        inline: true 
                    },
                    { 
                        name: `${EMOJIS.STATUS} Cargos`, 
                        value: `**Staff:** ${cfg.staff_role ? `<@&${cfg.staff_role}>` : '❌'}\n**Exemplar:** ${cfg.exemplar_role ? `<@&${cfg.exemplar_role}>` : '❌'}\n**Problema:** ${cfg.problem_role ? `<@&${cfg.problem_role}>` : '❌'}`, 
                        inline: true 
                    }
                );

            let metricsText = "";
            for (let i = 1; i <= 5; i++) {
                metricsText += `**Nível ${i}:** \`${cfg[`punish_${i}_action`] || 'Aviso'}\` | \`${cfg[`punish_${i}_time`] || '0'}m\` | \`-${cfg[`punish_${i}_rep`] || '0'} pts\`\n`;
            }
            embed.addFields({ name: `📊 Métricas de Punição`, value: metricsText });

            return interaction.editReply({ embeds: [embed] });
        }

        // --- SUBCOMANDO: CANAIS E CARGOS ---
        if (sub === 'canais-e-cargos') {
            const renderEmbed = () => {
                const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
                const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
                return new EmbedBuilder()
                    .setTitle(`${EMOJIS.CONFIG} Canais e Cargos`)
                    .setColor(0xFF3C72)
                    .addFields(
                        { name: 'Moderação', value: `Staff: ${s.staff_role ? `<@&${s.staff_role}>` : '❌'}` },
                        { name: 'Logs/Alertas', value: `Logs: ${s.logs_channel ? `<#${s.logs_channel}>` : '❌'}\nAlertas: ${s.alert_channel ? `<#${s.alert_channel}>` : '❌'}` },
                        { name: 'Automáticos', value: `Exemplar: ${s.exemplar_role ? `<@&${s.exemplar_role}>` : '❌'}\nProblema: ${s.problem_role ? `<@&${s.problem_role}>` : '❌'}` }
                    );
            };

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('config_cc')
                    .setPlaceholder('Selecione o que alterar...')
                    .addOptions([
                        { label: 'Cargo Staff', value: 'staff_role', emoji: EMOJIS.STAFF },
                        { label: 'Canal de Logs', value: 'logs_channel', emoji: EMOJIS.TICKET },
                        { label: 'Canal de Alertas', value: 'alert_channel', emoji: EMOJIS.WARNING },
                        { label: 'Cargo Exemplar', value: 'exemplar_role', emoji: EMOJIS.EXCELLENT },
                        { label: 'Cargo Problema', value: 'problem_role', emoji: EMOJIS.PROBLEMATIC }
                    ])
            );

            const response = await interaction.reply({ embeds: [renderEmbed()], components: [row], ephemeral: true });
            
            // CORREÇÃO: Coletor direto na resposta da interação
            const collector = response.createMessageComponentCollector({ time: 60000 });

            collector.on('collect', async i => {
                const key = i.values[0];
                await i.reply({ content: `👉 **Mencione** o canal ou cargo para configurar \`${key}\`:`, ephemeral: true });

                const msgCollector = interaction.channel.createMessageCollector({ 
                    filter: m => m.author.id === interaction.user.id, 
                    time: 20000, max: 1 
                });

                msgCollector.on('collect', async m => {
                    const id = key.includes('channel') ? m.mentions.channels.first()?.id : m.mentions.roles.first()?.id;
                    if (!id) return m.reply({ content: "❌ Menção inválida!", ephemeral: true });

                    db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`).run(guildId, key, id);
                    
                    await m.delete().catch(() => null);
                    await i.editReply({ content: `✅ \`${key}\` atualizado!` });
                    await interaction.editReply({ embeds: [renderEmbed()] });
                });
            });
        }

        // --- SUBCOMANDO: MÉTRICAS (Simplificado) ---
        if (sub === 'metricas') {
            // ... (sua lógica de métricas está ótima, apenas mantenha a consistência do banco)
            // Lembre-se de usar o parseTimeToMinutes que você criou!
        }

        // --- SUBCOMANDO: RESET ---
        if (sub === 'reset') {
            const confirm = new ButtonBuilder().setCustomId('confirm_reset').setLabel('Resetar').setStyle(ButtonStyle.Danger);
            const cancel = new ButtonBuilder().setCustomId('cancel_reset').setLabel('Cancelar').setStyle(ButtonStyle.Secondary);
            
            const response = await interaction.reply({
                content: `⚠️ **CUIDADO:** Deseja resetar todas as configurações?`,
                components: [new ActionRowBuilder().addComponents(confirm, cancel)],
                ephemeral: true
            });

            const collector = response.createMessageComponentCollector({ time: 20000 });
            collector.on('collect', async i => {
                if (i.customId === 'confirm_reset') {
                    db.prepare(`DELETE FROM settings WHERE guild_id = ?`).run(guildId);
                    await i.update({ content: '✅ Configurações limpas.', components: [] });
                } else {
                    await i.update({ content: 'Cancelado.', components: [] });
                }
            });
        }
    }
};