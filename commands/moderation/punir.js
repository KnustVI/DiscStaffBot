const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('punir')
        .setDescription('Aplica uma punição e desconta pontos de reputação.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(opt => opt.setName('usuario').setDescription('O usuário que será punido').setRequired(true))
        .addIntegerOption(opt => opt.setName('gravidade').setDescription('Nível da infração (1 a 5)').setRequired(true)
            .addChoices(
                { name: 'Nível 1', value: 1 },
                { name: 'Nível 2', value: 2 },
                { name: 'Nível 3', value: 3 },
                { name: 'Nível 4', value: 4 },
                { name: 'Nível 5', value: 5 }
            ))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da punição').setRequired(true))
        .addStringOption(opt => opt.setName('ticket').setDescription('Número do ticket (Opcional)').setRequired(false)),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const ticketId = interaction.options.getString('ticket'); // Sem o "|| N/A" para podermos testar se existe
        const user = interaction.options.getUser('usuario');
        const severity = interaction.options.getInteger('gravidade');
        const reason = interaction.options.getString('motivo');
        const timestamp = Date.now();

        // --- 1. VERIFICAÇÕES ---
        const staffRoleSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guildId);
        const logChannelSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guildId);
        const alertChannelSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'alert_channel'`).get(guildId);

        if (!staffRoleSetting || !logChannelSetting) {
            return interaction.reply({ content: "⚠️ **O sistema não está configurado.**", ephemeral: true });
        }

        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasRole = interaction.member.roles.cache.has(staffRoleSetting.value);
        if (!hasRole && !isAdmin) return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });

        await interaction.deferReply({ ephemeral: true });

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.editReply("❌ Usuário não encontrado.");

        // --- 2. MÉTRICAS ---
        const getMetric = (type) => db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, `punish_${severity}_${type}`)?.value;
        const defaultMetrics = {
            1: { action: "aviso", time: 0, rep: 2 },
            2: { action: "timeout", time: 5, rep: 5 },
            3: { action: "timeout", time: 30, rep: 10 },
            4: { action: "timeout", time: 120, rep: 20 },
            5: { action: "ban", time: 0, rep: 35 }
        };

        const selectedAction = (getMetric('action') || defaultMetrics[severity].action).toLowerCase();
        const selectedTimeMinutes = parseInt(getMetric('time') || defaultMetrics[severity].time);
        const repLoss = parseInt(getMetric('rep') || defaultMetrics[severity].rep);

        try {
            // --- 3. EXECUÇÃO ---
            let executionDetail = "Aviso (ADV)";
            if (selectedAction === 'timeout' && selectedTimeMinutes > 0) {
                await member.timeout(selectedTimeMinutes * 60 * 1000, reason);
                executionDetail = `Timeout (${selectedTimeMinutes}m)`;
            } else if (selectedAction === 'ban') {
                await member.ban({ reason });
                executionDetail = "Banimento Permanente";
            }

            // --- 4. BANCO DE DADOS ---
            const insertPunishment = db.prepare(`
                INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, ticket_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(guildId, user.id, interaction.user.id, reason, severity, ticketId || 'N/A', timestamp);

            const punishmentId = insertPunishment.lastInsertRowid;

            db.prepare(`
                INSERT INTO users (user_id, guild_id, reputation, penalties, last_penalty)
                VALUES (?, ?, ?, 1, ?)
                ON CONFLICT(user_id, guild_id) DO UPDATE SET
                reputation = MAX(0, reputation - ?), penalties = penalties + 1, last_penalty = ?
            `).run(user.id, guildId, 100 - repLoss, timestamp, repLoss, timestamp);

            const userData = db.prepare(`SELECT reputation FROM users WHERE user_id = ? AND guild_id = ?`).get(user.id, guildId);

            // --- 5. EMBED DINÂMICA (TICKET SÓ APARECE SE EXISTIR) ---
            const fields = [
                { name: "👤 Usuário", value: `${user} (\`${user.id}\`)`, inline: true },
                { name: "👮 Moderador", value: `${interaction.user}`, inline: true },
                { name: "🛠️ Ação", value: `\`${executionDetail}\``, inline: true },
                { name: "📉 Reputação Atual", value: `\`${userData.reputation} pts\``, inline: true }
            ];

            // Se o ticketId existir, adicionamos ele à lista de campos
            if (ticketId) {
                fields.push({ name: "🎫 Ticket", value: `\`#${ticketId}\``, inline: true });
            }

            // O motivo sempre por último ocupando a linha toda
            fields.push({ name: "📝 Motivo", value: `\`\`\`${reason}\`\`\`` });

            const finalEmbed = new EmbedBuilder()
                .setDescription(`# ⚖️ Nova Punição | ID #${punishmentId}`)
                .setColor(0xFF0000)
                .addFields(fields)
                .setFooter({ 
                    text: interaction.guild.name, 
                    iconURL: interaction.guild.iconURL({ dynamic: true })
                })
                .setTimestamp();

            // Envio Logs e DM
            const logChannel = interaction.guild.channels.cache.get(logChannelSetting.value);
            if (logChannel) await logChannel.send({ embeds: [finalEmbed] }).catch(() => null);
            await user.send({ embeds: [finalEmbed] }).catch(() => null);

            await interaction.editReply({ content: `✅ Punição **#${punishmentId}** aplicada.` });

        } catch (err) {
            console.error(err);
            return interaction.editReply(`❌ Erro ao aplicar punição.`);
        }
    }
};