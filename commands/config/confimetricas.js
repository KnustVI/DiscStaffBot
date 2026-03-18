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
        .setName('config-metricas')
        .setDescription('Ajusta os valores de punição e converte horas/dias automaticamente.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        // --- FUNÇÃO DE CONVERSÃO INTELIGENTE ---
        // Transforma "2h" em 120, "1d" em 1440, etc.
        const parseTimeToMinutes = (input) => {
            const lowerInput = input.toLowerCase().trim();
            const number = parseFloat(lowerInput.replace(/[^\d.]/g, ''));
            
            if (isNaN(number)) return null;

            if (lowerInput.endsWith('h')) return Math.round(number * 60);
            if (lowerInput.endsWith('d')) return Math.round(number * 1440);
            // Se terminar com 'm' ou for apenas o número puro, considera minutos
            if (lowerInput.endsWith('m') || !/[a-z]/.test(lowerInput)) return Math.round(number);
            
            return null; // Formato não identificado
        };

        // Função para gerar o Embed com os dados atuais
        const getMetricsEmbed = () => {
            const embed = new EmbedBuilder()
                .setTitle(`📊 Ajuste de Métricas: ${interaction.guild.name}`)
                .setColor(0xff2e6c)
                .setDescription('Selecione um nível abaixo para editar. Você pode usar: `30` (min), `2h` (horas) ou `1d` (dias).')
                .setFooter({ text: 'O menu expira após 5 minutos de inatividade.' });

            for (let i = 1; i <= 5; i++) {
                const action = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, `punish_${i}_action`)?.value || "Padrão";
                const time = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, `punish_${i}_time`)?.value || "0";
                const rep = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, `punish_${i}_rep`)?.value || "0";
                
                embed.addFields({ 
                    name: `Nível ${i}`, 
                    value: `**Ação:** \`${action}\` | **Tempo:** \`${time}m\` | **Rep:** \`-${rep} pts\``, 
                    inline: false 
                });
            }
            return embed;
        };

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select_level')
                .setPlaceholder('Escolha o nível para editar...')
                .addOptions([
                    { label: 'Nível 1', value: '1', emoji: '1️⃣' },
                    { label: 'Nível 2', value: '2', emoji: '2️⃣' },
                    { label: 'Nível 3', value: '3', emoji: '3️⃣' },
                    { label: 'Nível 4', value: '4', emoji: '4️⃣' },
                    { label: 'Nível 5', value: '5', emoji: '5️⃣' },
                ])
        );

        const response = await interaction.reply({ 
            embeds: [getMetricsEmbed()], 
            components: [row], 
            ephemeral: true 
        });

        // Coletor de 5 minutos (300000ms)
        const collector = response.createMessageComponentCollector({ time: 300000 });

        collector.on('collect', async i => {
            if (i.customId === 'select_level') {
                const level = i.values[0];

                // Criar o Modal
                const modal = new ModalBuilder()
                    .setCustomId(`modal_metrics_${level}_${Date.now()}`)
                    .setTitle(`Configurar Nível ${level}`);

                const actionInput = new TextInputBuilder()
                    .setCustomId('action_name')
                    .setLabel("NOME DA AÇÃO (Ex: Aviso, Timeout)")
                    .setPlaceholder("Ex: Banimento Temporário")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const timeInput = new TextInputBuilder()
                    .setCustomId('time_value')
                    .setLabel("TEMPO (Ex: 30, 2h, 1d)")
                    .setPlaceholder("Ex: 2h será convertido para 120 minutos")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const repInput = new TextInputBuilder()
                    .setCustomId('rep_value')
                    .setLabel("PERDA DE REPUTAÇÃO (Apenas números)")
                    .setPlaceholder("Ex: 15")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(actionInput),
                    new ActionRowBuilder().addComponents(timeInput),
                    new ActionRowBuilder().addComponents(repInput)
                );

                await i.showModal(modal);

                // Coletor de submissão do modal
                try {
                    const submitted = await i.awaitModalSubmit({
                        time: 60000,
                        filter: m => m.user.id === interaction.user.id,
                    });

                    if (submitted) {
                        const rawTime = submitted.fields.getTextInputValue('time_value');
                        const convertedTime = parseTimeToMinutes(rawTime);

                        // --- VALIDAÇÃO DE TEMPO ---
                        if (convertedTime === null) {
                            return await submitted.reply({ 
                                content: `❌ **Erro de Formato:** Não consegui entender o tempo \`${rawTime}\`.\n\n**Como usar:**\n• Apenas números: \`60\` (60 minutos)\n• Com **h**: \`2h\` (120 minutos)\n• Com **d**: \`1d\` (1440 minutos)`, 
                                ephemeral: true 
                            });
                        }

                        const actionName = submitted.fields.getTextInputValue('action_name');
                        const repValue = submitted.fields.getTextInputValue('rep_value').replace(/[^\d]/g, '');

                        // Salvar no Banco (Usando excluded para garantir o valor correto no conflito)
                        const stmt = db.prepare(`
                            INSERT INTO settings (guild_id, key, value) 
                            VALUES (?, ?, ?) 
                            ON CONFLICT(guild_id, key) 
                            DO UPDATE SET value = excluded.value
                        `);

                        stmt.run(guildId, `punish_${level}_action`, actionName);
                        stmt.run(guildId, `punish_${level}_time`, convertedTime.toString());
                        stmt.run(guildId, `punish_${level}_rep`, repValue);

                        // Confirmar submissão
                        await submitted.reply({ 
                            content: `✅ **Nível ${level}** atualizado!\n⏱️ Tempo definido: \`${rawTime}\` → **${convertedTime} minutos.**`, 
                            ephemeral: true 
                        });

                        // Atualiza o menu principal
                        await interaction.editReply({ embeds: [getMetricsEmbed()], components: [row] });
                    }
                } catch (err) {
                    console.log(`Tempo esgotado ou erro no modal do nível ${level}`);
                }
            }
        });

        collector.on('end', () => {
            interaction.editReply({ components: [] }).catch(() => null);
        });
    }
};