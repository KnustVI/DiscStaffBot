const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configurações do bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    // Subcomando "show"
    .addSubcommand(sub =>
      sub
        .setName('show')
        .setDescription('Mostrar configurações do servidor')
    )

    // Subcomando group "set"
    .addSubcommandGroup(group =>
      group
        .setName('set')
        .setDescription('Alterar configurações')
        
        .addSubcommand(sub =>
          sub
            .setName('alert-channel')
            .setDescription('Definir canal de alerta da staff')
            .addChannelOption(option =>
              option.setName('channel')
                .setDescription('Canal de alerta')
                .setRequired(true)
            )
        )
        
        .addSubcommand(sub =>
          sub
            .setName('logs-channel')
            .setDescription('Definir canal de logs de punições')
            .addChannelOption(option =>
              option.setName('channel')
                .setDescription('Canal de logs')
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
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guild.id;
    const group = interaction.options.getSubcommandGroup(false); // false se não houver grupo
    const sub = interaction.options.getSubcommand();

    // Sem grupo
    if (!group) {
      if (sub === 'show') {
        const settings = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ?`).all(guildId);
        let text = "⚙ **Configurações do servidor**\n\n";
        if (settings.length === 0) text += "Nenhuma configuração definida.";
        else settings.forEach(s => text += `**${s.key}** → ${s.value}\n`);

        return await interaction.editReply({ content: text, ephemeral: true });
      }
    }

    // Grupo 'set'
    if (group === 'set') {
      if (sub === 'alert-channel') {
        const channel = interaction.options.getChannel('channel');
        db.prepare(`INSERT OR REPLACE INTO settings (guild_id, key, value) VALUES (?, 'alert_channel', ?)`).run(guildId, channel.id);
        return await interaction.editReply(`✅ Canal de alerta definido para ${channel}`);
      }

      if (sub === 'logs-channel') {
        const channel = interaction.options.getChannel('channel');
        db.prepare(`INSERT OR REPLACE INTO settings (guild_id, key, value) VALUES (?, 'logs_channel', ?)`).run(guildId, channel.id);
        return await interaction.editReply(`📜 Canal de logs definido para ${channel}`);
      }

      if (sub === 'problem-role') {
        const role = interaction.options.getRole('role');
        db.prepare(`INSERT OR REPLACE INTO settings (guild_id, key, value) VALUES (?, 'problem_role', ?)`).run(guildId, role.id);
        return await interaction.editReply(`⚠ Cargo problemático definido: ${role}`);
      }

      if (sub === 'exemplar-role') {
        const role = interaction.options.getRole('role');
        db.prepare(`INSERT OR REPLACE INTO settings (guild_id, key, value) VALUES (?, 'exemplar_role', ?)`).run(guildId, role.id);
        return await interaction.editReply(`🏅 Cargo exemplar definido: ${role}`);
      }
    }
  }
};