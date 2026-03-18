const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder 
} = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-canais-e-cargos')
        .setDescription('Painel de configuração do DiscStaffBot')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        // Função para buscar as configurações atuais e montar o Embed
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

        // Criando o Menu de Seleção
        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('config_menu')
                    .setPlaceholder('Escolha o que deseja configurar...')
                    .addOptions([
                        {
                            label: 'Cargo Staff',
                            description: 'Define quem pode usar comandos de moderação.',
                            value: 'staff_role',
                            emoji: '🛡️',
                        },
                        {
                            label: 'Canal de Logs',
                            description: 'Define onde as punições serão registradas.',
                            value: 'logs_channel',
                            emoji: '📜',
                        },
                        {
                            label: 'Cargo Exemplar',
                            description: 'Cargo para jogadores com conduta excelente.',
                            value: 'exemplar_role',
                            emoji: '🎖️',
                        },
                        {
                            label: 'Cargo Problema',
                            description: 'Cargo para jogadores com muitas punições.',
                            value: 'problem_role',
                            emoji: '⚠️',
                        },
                    ]),
            );

        await interaction.reply({ embeds: [getSettingsEmbed()], components: [row], ephemeral: true });

        // Coletor para processar a escolha do menu
        const collector = interaction.channel.createMessageComponentCollector({
            filter: i => i.customId === 'config_menu' && i.user.id === interaction.user.id,
            time: 60000
        });

        collector.on('collect', async i => {
            const selection = i.values[0];
            
            // Texto de instrução baseado na escolha
            const instructions = {
                staff_role: "Mencione o **Cargo** que terá permissão de moderador (ex: @Staff).",
                logs_channel: "Mencione o **Canal** onde as punições serão logadas (ex: #logs-punicoes).",
                exemplar_role: "Mencione o **Cargo** que os jogadores exemplares ganharão.",
                problem_role: "Mencione o **Cargo** que os jogadores problemáticos receberão."
            };

            await i.reply({ content: `👉 **Configurando ${selection}:** ${instructions[selection]}`, ephemeral: true });

            const filter = m => m.author.id === interaction.user.id;
            const messageCollector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });

            messageCollector.on('collect', async m => {
                let value;
                if (selection.includes('channel')) {
                    value = m.mentions.channels.first()?.id;
                } else {
                    value = m.mentions.roles.first()?.id;
                }

                if (!value) {
                    return m.reply({ content: "❌ Menção inválida. Tente novamente o comando `/config`.", ephemeral: true });
                }

                // Salva no banco de dados
                db.prepare(`
                    INSERT INTO settings (guild_id, key, value) 
                    VALUES (?, ?, ?) 
                    ON CONFLICT(guild_id, key) DO UPDATE SET value = ?
                `).run(guildId, selection, value, value);

                await m.delete().catch(() => null); // Limpa a mensagem do chat para manter organizado
                await i.editReply({ content: `✅ **Sucesso!** O valor de \`${selection}\` foi atualizado.`, ephemeral: true });
                
                // Atualiza o painel principal
                await interaction.editReply({ embeds: [getSettingsEmbed()] });
            });
        });
    }
};