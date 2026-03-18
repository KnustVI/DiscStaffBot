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
        .setDescription('Ajusta os valores de punição, tempos e perda de reputação.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        // Função para gerar o Embed com os dados atuais
        const getMetricsEmbed = () => {
            const embed = new EmbedBuilder()
                .setTitle(`📊 Ajuste de Métricas: ${interaction.guild.name}`)
                .setColor(0xff2e6c)
                .setDescription('Selecione um nível no menu abaixo para editar. Você pode editar vários níveis seguidos.')
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
                    .setCustomId(`modal_metrics_${level}_${Date.now()}`) // ID único para evitar conflitos
                    .setTitle(`Configurar Nível ${level}`);

                const actionInput = new TextInputBuilder()
                    .setCustomId('action_name')
                    .setLabel("NOME DA AÇÃO (Ex: Aviso, Timeout)")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const timeInput = new TextInputBuilder()
                    .setCustomId('time_value')
                    .setLabel("TEMPO EM MINUTOS (0 para avisos)")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const repInput = new TextInputBuilder()
                    .setCustomId('rep_value')
                    .setLabel("PERDA DE REPUTAÇÃO (Apenas números)")
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
                        const actionName = submitted.fields.getTextInputValue('action_name');
                        const timeValue = submitted.fields.getTextInputValue('time_value');
                        const repValue = submitted.fields.getTextInputValue('rep_value');

                        // Salvar no Banco
                        const stmt = db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = ?`);
                        stmt.run(guildId, `punish_${level}_action`, actionName, actionName);
                        stmt.run(guildId, `punish_${level}_time`, timeValue, timeValue);
                        stmt.run(guildId, `punish_${level}_rep`, repValue, repValue);

                        // Confirmar submissão com resposta silenciosa
                        await submitted.reply({ content: `✅ Nível **${level}** configurado!`, ephemeral: true });

                        // Atualiza o menu principal sem fechar o comando
                        await interaction.editReply({ embeds: [getMetricsEmbed()], components: [row] });
                    }
                } catch (err) {
                    // O erro geralmente é o timeout do modal (usuário demorou > 1min)
                    console.log("Tempo esgotado para preencher o modal.");
                }
            }
        });

        collector.on('end', () => {
            interaction.editReply({ components: [] }).catch(() => null);
        });
    }
};