const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ChannelType, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle 
} = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('configplus')
        .setDescription('Painel central de configurações do bot.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        
        .addSubcommand(sub => sub.setName('show').setDescription('Exibe todas as configurações atuais'))
        
        .addSubcommand(sub => sub.setName('set')
            .setDescription('Define canais ou cargos do sistema')
            .addStringOption(opt => opt.setName('parametro')
                .setDescription('O que deseja configurar?')
                .setRequired(true)
                .addChoices(
                    { name: 'Cargo Staff', value: 'staff-role' }, // Mantido com hífen
                    { name: 'Canal de Logs', value: 'logs-channel' },
                    { name: 'Canal de Alertas', value: 'alert-channel' },
                    { name: 'Cargo Exemplar', value: 'exemplar-role' },
                    { name: 'Cargo Problema', value: 'problem-role' }
                ))
            .addRoleOption(opt => opt.setName('cargo').setDescription('Selecione o cargo (se aplicável)'))
            .addChannelOption(opt => opt.setName('canal').setDescription('Selecione o canal (se aplicável)').addChannelTypes(ChannelType.GuildText)))
        
        .addSubcommand(sub => sub.setName('metricas').setDescription('Ajusta os valores de punição (Níveis 1 a 5)')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        // --- LÓGICA: SHOW ---
        if (sub === 'show') {
            await interaction.deferReply({ ephemeral: true });
            const rows = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
            const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));

            const embed = new EmbedBuilder()
                .setTitle(`⚙️ Configurações: ${interaction.guild.name}`)
                .setColor(0xff2e6c)
                .addFields(
                    { 
                        name: "🛡️ Moderação & Canais", 
                        value: `Staff: ${cfg['staff-role'] ? `<@&${cfg['staff-role']}>` : '❌'}\n` +
                               `Logs: ${cfg['logs-channel'] ? `<#${cfg['logs-channel']}>` : '❌'}\n` +
                               `Alertas: ${cfg['alert-channel'] ? `<#${cfg['alert-channel']}>` : '❌'}`, 
                        inline: true 
                    },
                    { 
                        name: "🎭 Cargos Automáticos", 
                        value: `Exemplar: ${cfg['exemplar-role'] ? `<@&${cfg['exemplar-role']}>` : '❌'}\n` +
                               `Problema: ${cfg['problem-role'] ? `<@&${cfg['problem-role']}>` : '❌'}`, 
                        inline: true 
                    }
                );

            let mText = "";
            for (let i = 1; i <= 5; i++) {
                // Mantendo as chaves das métricas como você já usava (punish_X_...)
                mText += `**Nível ${i}:** \`${cfg[`punish_${i}_action`] || 'Aviso'}\` | \`${cfg[`punish_${i}_time`] || '0'}m\` | \`-${cfg[`punish_${i}_rep`] || '0'} pts\`\n`;
            }
            embed.addFields({ name: "📊 Métricas de Punição", value: mText });

            return interaction.editReply({ embeds: [embed] });
        }

        // --- LÓGICA: SET (Canais/Cargos) ---
        if (sub === 'set') {
            await interaction.deferReply({ ephemeral: true });
            const key = interaction.options.getString('parametro');
            const role = interaction.options.getRole('cargo');
            const channel = interaction.options.getChannel('canal');

            // Verifica se o usuário enviou o tipo correto para a chave escolhida
            const isRoleKey = key.includes('role');
            const value = isRoleKey ? role?.id : channel?.id;

            if (!value) {
                return interaction.editReply(`❌ Erro: O parâmetro \`${key}\` exige que você selecione um **${isRoleKey ? 'Cargo' : 'Canal'}**.`);
            }

            db.prepare(`
                INSERT INTO settings (guild_id, key, value) 
                VALUES (?, ?, ?) 
                ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
            `).run(guildId, key, value);

            return interaction.editReply(`✅ Configuração **${key}** atualizada com sucesso para ${isRoleKey ? role : channel}!`);
        }

        // --- LÓGICA: MÉTRICAS (Menu + Modal) ---
        if (sub === 'metricas') {
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('sel_lvl')
                    .setPlaceholder('Selecione o nível para configurar...')
                    .addOptions([1, 2, 3, 4, 5].map(n => ({ label: `Nível ${n}`, value: `${n}`, emoji: '⚙️' })))
            );

            const response = await interaction.reply({ 
                content: "Selecione o nível desejado para abrir o painel de métricas:", 
                components: [row], 
                ephemeral: true 
            });
            
            const collector = response.createMessageComponentCollector({ time: 300000 });

            collector.on('collect', async i => {
                if (i.customId === 'sel_lvl') {
                    const level = i.values[0];
                    const modal = new ModalBuilder()
                        .setCustomId(`mod_lvl_${level}_${Date.now()}`)
                        .setTitle(`Métricas do Nível ${level}`);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('a').setLabel("AÇÃO (Ex: Aviso, Timeout)").setStyle(TextInputStyle.Short).setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('t').setLabel("TEMPO (Ex: 30, 2h, 1d)").setStyle(TextInputStyle.Short).setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('r').setLabel("PERDA DE REPUTAÇÃO").setStyle(TextInputStyle.Short).setRequired(true))
                    );

                    await i.showModal(modal);

                    try {
                        const submitted = await i.awaitModalSubmit({ time: 60000, filter: m => m.user.id === interaction.user.id });
                        
                        if (submitted) {
                            const rawT = submitted.fields.getTextInputValue('t');
                            
                            // Função de conversão
                            const parseTime = (input) => {
                                const l = input.toLowerCase().trim();
                                const n = parseFloat(l.replace(/[^\d.]/g, ''));
                                if (isNaN(n)) return null;
                                if (l.endsWith('h')) return Math.round(n * 60);
                                if (l.endsWith('d')) return Math.round(n * 1440);
                                return Math.round(n);
                            };

                            const mins = parseTime(rawT);
                            if (mins === null) return submitted.reply({ content: "❌ Formato de tempo inválido! Use números, 'h' ou 'd'.", ephemeral: true });

                            const act = submitted.fields.getTextInputValue('a');
                            const rep = submitted.fields.getTextInputValue('r').replace(/[^\d]/g, '');

                            const save = db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`);
                            save.run(guildId, `punish_${level}_action`, act);
                            save.run(guildId, `punish_${level}_time`, mins.toString());
                            save.run(guildId, `punish_${level}_rep`, rep);

                            await submitted.reply({ content: `✅ **Nível ${level}** configurado: \`${act}\` | \`${mins}m\` | \`-${rep} pts\``, ephemeral: true });
                        }
                    } catch (e) { /* Modal ignorado */ }
                }
            });
        }
    }
};