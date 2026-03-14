const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config-logs')
    .setDescription('Definir canal de logs do servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    .addChannelOption(option =>
      option.setName('canal')
        .setDescription('Canal onde as punições serão registradas')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.options.getChannel('canal');
    const guildId = interaction.guild.id;

    try {
      // Atualizar ou inserir canal de logs
      db.prepare(`
        INSERT INTO guild_config (guild_id, logs_channel)
        VALUES (?, ?)
        ON CONFLICT(guild_id)
        DO UPDATE SET logs_channel = excluded.logs_channel
      `).run(guildId, channel.id);

      const embed = new EmbedBuilder()
        .setTitle("✅ Canal de logs configurado")
        .setDescription(`As punições serão registradas no canal ${channel}`)
        .setColor(0x00ff00)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      await interaction.editReply({ content: "❌ Ocorreu um erro ao configurar o canal de logs." });
    }
  }
};