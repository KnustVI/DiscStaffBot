const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {

  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configurações do bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    .addSubcommand(sub =>
      sub
        .setName('show')
        .setDescription('Mostrar configurações do servidor')
    )

    .addSubcommand(sub =>
      sub
        .setName('logs-channel')
        .setDescription('Definir canal de logs')
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Canal de logs')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('alert-channel')
        .setDescription('Definir canal de alerta')
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Canal de alerta')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('problem-role')
        .setDescription('Definir cargo problemático')
        .addRoleOption(option =>
          option.setName('role')
            .setDescription('Cargo problemático')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('exemplar-role')
        .setDescription('Definir cargo exemplar')
        .addRoleOption(option =>
          option.setName('role')
            .setDescription('Cargo exemplar')
            .setRequired(true)
        )
    ),

  async execute(interaction) {

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    try {

      if (sub === 'show') {

        const settings = db.prepare(`
          SELECT key, value FROM settings WHERE guild_id = ?
        `).all(guildId);

        if (!settings.length) {
          return interaction.editReply("⚙ Nenhuma configuração definida.");
        }

        const text = settings
          .map(s => `**${s.key}** → ${s.value}`)
          .join("\n");

        return interaction.editReply({
          content: `⚙ **Configurações do servidor**\n\n${text}`
        });

      }

      if (sub === 'logs-channel') {

        const channel = interaction.options.getChannel('channel');

        db.prepare(`
          INSERT OR REPLACE INTO settings (guild_id, key, value)
          VALUES (?, 'logs_channel', ?)
        `).run(guildId, channel.id);

        return interaction.editReply(`📜 Canal de logs definido para ${channel}`);

      }

      if (sub === 'alert-channel') {

        const channel = interaction.options.getChannel('channel');

        db.prepare(`
          INSERT OR REPLACE INTO settings (guild_id, key, value)
          VALUES (?, 'alert_channel', ?)
        `).run(guildId, channel.id);

        return interaction.editReply(`🚨 Canal de alerta definido para ${channel}`);

      }

      if (sub === 'problem-role') {

        const role = interaction.options.getRole('role');

        db.prepare(`
          INSERT OR REPLACE INTO settings (guild_id, key, value)
          VALUES (?, 'problem_role', ?)
        `).run(guildId, role.id);

        return interaction.editReply(`⚠ Cargo problemático definido: ${role}`);

      }

      if (sub === 'exemplar-role') {

        const role = interaction.options.getRole('role');

        db.prepare(`
          INSERT OR REPLACE INTO settings (guild_id, key, value)
          VALUES (?, 'exemplar_role', ?)
        `).run(guildId, role.id);

        return interaction.editReply(`🏅 Cargo exemplar definido: ${role}`);

      }

    } catch (err) {

      console.error(err);
      return interaction.editReply("❌ Ocorreu um erro ao executar o comando.");

    }

  }
};
