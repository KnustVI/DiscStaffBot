const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js')
const db = require('../../database/database')

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
          { name: '3 - Timeout leve', value: 3 },
          { name: '4 - Timeout médio', value: 4 },
          { name: '5 - Timeout severo', value: 5 }
        )
    )

    .addStringOption(option =>
      option.setName('motivo')
        .setDescription('Motivo da punição')
        .setRequired(true)
    ),

  async execute(interaction) {

    await interaction.deferReply({ ephemeral: true })

    const user = interaction.options.getUser('usuario')
    const severity = interaction.options.getInteger('gravidade')
    const reason = interaction.options.getString('motivo')

    const guildId = interaction.guild.id
    const moderatorId = interaction.user.id

    const member = await interaction.guild.members.fetch(user.id).catch(() => null)

    if (!member) {
      return interaction.editReply({ content: "❌ Usuário não encontrado no servidor." })
    }

    let timeoutDuration = 0
    let action = "Aviso"

    switch (severity) {

      case 2:
        timeoutDuration = 5 * 60 * 1000
        action = "Timeout (5 min)"
        break

      case 3:
        timeoutDuration = 30 * 60 * 1000
        action = "Timeout (30 min)"
        break

      case 4:
        timeoutDuration = 2 * 60 * 60 * 1000
        action = "Timeout (2 horas)"
        break

      case 5:
        timeoutDuration = 24 * 60 * 60 * 1000
        action = "Timeout (24 horas)"
        break

    }

    try {

      if (timeoutDuration > 0) {
        await member.timeout(timeoutDuration, reason)
      }

    } catch (err) {

      console.error(err)

      return interaction.editReply({
        content: "❌ Não foi possível aplicar a punição. Verifique minhas permissões."
      })

    }

    // salvar no banco

    db.prepare(`
      INSERT INTO punishments
      (guild_id, user_id, moderator_id, reason, severity, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(guildId, user.id, moderatorId, reason, severity)

    // buscar canal de logs

    const logSetting = db.prepare(`
      SELECT value FROM settings
      WHERE guild_id = ? AND key = 'logs_channel'
    `).get(guildId)

    if (logSetting) {

      const logChannel = interaction.guild.channels.cache.get(logSetting.value)

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
          .setTimestamp()

        logChannel.send({ embeds: [logEmbed] })
      }
    }

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
      .setTimestamp()

    await interaction.editReply({ embeds: [replyEmbed] })
  }
}
