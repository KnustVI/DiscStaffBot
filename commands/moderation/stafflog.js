const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');
const PunishmentSystem = require('../../systems/punishmentSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resetrep')
        .setDescription('Reseta completamente a reputação e histórico de um usuário.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário que terá a ficha limpa').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do reset').setRequired(true)),

    async execute(interaction) {
        const { guild, options, user: staff } = interaction;
        const target = options.getUser('usuario');
        const reason = options.getString('motivo');

        await interaction.deferReply({ ephemeral: true });

        try {
            const hasData = await PunishmentSystem.resetUserFicha(guild.id, target.id);

            if (!hasData) {
                return interaction.editReply(`${EMOJIS.AVISO} O usuário **${target.username}** não possui registros ativos.`);
            }

            // --- BUSCA DE CANAIS (LOGS E STAFFLOG/ALERTAS) ---
            const settings = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ? AND key IN ('logs_channel', 'alert_channel')`).all(guild.id);
            const cfg = Object.fromEntries(settings.map(s => [s.key, s.value]));

            const logEmbed = new EmbedBuilder()
                .setTitle(`${EMOJIS.CLEAN} Reset de Ficha Técnica`)
                .setColor(0x3498db)
                .setThumbnail(target.displayAvatarURL())
                .addFields(
                    { name: `${EMOJIS.USUARIO} Usuário`, value: `${target} (\`${target.id}\`)`, inline: true },
                    { name: `${EMOJIS.STAFF} Responsável`, value: `${staff}`, inline: true },
                    { name: `${EMOJIS.NOTE} Motivo do Reset`, value: `\`\`\`${reason}\`\`\`` }
                )
                .setFooter({ text: `✧ BOT by: KnustVI`, iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' })
                .setTimestamp();

            // 1. Enviar para Logs Gerais (Auditoria Pública/Padrão)
            if (cfg.logs_channel) {
                const channel = guild.channels.cache.get(cfg.logs_channel);
                if (channel) await channel.send({ embeds: [logEmbed] }).catch(() => null);
            }

            // 2. Enviar para Staff Log (Alertas Críticos)
            if (cfg.alert_channel && cfg.alert_channel !== cfg.logs_channel) {
                const staffLog = guild.channels.cache.get(cfg.alert_channel);
                if (staffLog) {
                    // Mudamos a cor para amarelo para destacar que é um alerta de ação da Staff
                    const alertEmbed = EmbedBuilder.from(logEmbed)
                        .setTitle(`${EMOJIS.ALERT} ALERTA DE STAFF: Ficha Resetada`)
                        .setColor(0xFFAA00); 
                    
                    await staffLog.send({ embeds: [alertEmbed] }).catch(() => null);
                }
            }

            await interaction.editReply(`${EMOJIS.CHECK} Ficha de **${target.username}** foi completamente resetada.`);

        } catch (error) {
            console.error("Erro no resetrep:", error);
            await interaction.editReply(`${EMOJIS.ERRO} Erro ao processar o reset no banco de dados.`);
        }
    }
};