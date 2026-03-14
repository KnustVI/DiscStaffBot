const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('punir')
    .setDescription('Aplicar punição em um usuário')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)

    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Usuário punido')
        .setRequired(true)
    )

    .addIntegerOption(option =>
      option.setName('gravidade')
        .setDescription('Nível de gravidade')
        .setRequired(true)
        .addChoices(
          { name: '1 - Aviso', value: 1 },
          { name: '2 - Advertência', value: 2 },
          { name: '3 - Timeout', value: 3 },
          { name: '4 - Kick', value: 4 },
          { name: '5 - Ban', value: 5 }
        )
    )

    .addStringOption(option =>
      option.setName('motivo')
        .setDescription('Motivo da punição')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('usuario');
    const severity = interaction.options.getInteger('gravidade');
    const reason = interaction.options.getString('motivo');
    const guildId = interaction.guild.id;
    const moderatorId = interaction.user.id;

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.editReply({ content: "❌ Usuário não encontrado no servidor." });
    }

    let action = severity === 1 ? 'Aviso' :
                 severity === 2 ? 'Advertência' : 'Nenhuma';

    try {
      if (severity === 3) {
        await member.timeout(10 * 60 * 1000, reason);
        action = "Timeout (10 min)";
      }
      if (severity === 4) {
        await member.kick(reason);
        action = "Kick";
      }
      if (severity === 5) {
        await member.ban({ reason });
        action = "Ban";
      }
    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: "❌ Não foi possível aplicar a punição. Verifique minhas permissões." });
    }

    // Registrar no banco de dados
    db.prepare(`
      INSERT INTO punishments 
      (guild_id, user_id, moderator_id, reason, severity, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(guildId, user.id, moderatorId, reason, severity);

    // Buscar canal de logs
    const logSetting = db.prepare(`
      SELECT value FROM settings
      WHERE guild_id = ? AND key = 'logs_channel'
    `).get(guildId);

    if (logSetting) {
      const logChannel = interaction.guild.channels.cache.get(logSetting.value);
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle("📜 Nova punição registrada")
          .addFields(
            { name: "Usuário", value: `<@${user.id}>`, inline: true },
            { name: "Moderador", value: `<@${moderatorId}>`, inline: true },
            { name: "Gravidade", value: severity.toString(), inline: true },
            { name: "Ação", value: action, inline: true },
            { name: "Motivo", value: reason }
          )
          .setColor(0xff0000)
          .setTimestamp();

        logChannel.send({ embeds: [logEmbed] });
      }
    }

    // Resposta ao moderador
    const replyEmbed = new EmbedBuilder()
      .setTitle("✅ Punição registrada")
      .addFields(
        { name: "Usuário", value: `<@${user.id}>`, inline: true },
        { name: "Moderador", value: `<@${moderatorId}>`, inline: true },
        { name: "Gravidade", value: severity.toString(), inline: true },
        { name: "Ação", value: action, inline: true },
        { name: "Motivo", value: reason }
      )
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.editReply({ embeds: [replyEmbed] });
  }
};