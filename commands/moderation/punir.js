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
        const ticketId = interaction.options.getString('ticket') || 'N/A';
        const user = interaction.options.getUser('usuario');
        const severity = interaction.options.getInteger('gravidade');
        const reason = interaction.options.getString('motivo');
        const timestamp = Date.now();

        // --- 1. VERIFICAÇÃO DE CONFIGURAÇÃO ---
        const staffRoleSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guildId);
        const logChannelSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guildId);

        if (!staffRoleSetting || !logChannelSetting) {
            return interaction.reply({
                content: "⚠️ **O sistema não está configurado.** Use `/config-metricas` primeiro.",
                ephemeral: true
            });
        }

        // --- 2. VERIFICAÇÃO DE PERMISSÃO ---
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasRole = interaction.member.roles.cache.has(staffRoleSetting.value);

        if (!hasRole && !isAdmin) {
            return interaction.reply({ content: "❌ Apenas a **Staff** autorizada pode usar este comando.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.editReply("❌ Usuário não encontrado no servidor.");
        if (user.id === interaction.client.user.id) return interaction.editReply("❌ Eu não posso me punir.");

        // Impedir punir cargos superiores
        if (member.roles.highest.position >= interaction.member.roles.highest.position && !isAdmin) {
            return interaction.editReply("❌ Você não pode punir alguém com cargo superior ou igual ao seu.");
        }

        /* --- 3. BUSCA DINÂMICA DE MÉTRICAS --- */
        const getMetric = (type) => db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, `punish_${severity}_${type}`)?.value;

        const defaultMetrics = {
            1: { action: "Aviso", time: 0, rep: 2 },
            2: { action: "Timeout", time: 5, rep: 5 },
            3: { action: "Timeout", time: 30, rep: 10 },
            4: { action: "Timeout", time: 120, rep: 20 },
            5: { action: "Timeout", time: 1440, rep: 35 }
        };

        const selectedAction = getMetric('action') || defaultMetrics[severity].action;
        const selectedTimeMinutes = parseInt(getMetric('time')) ?? defaultMetrics[severity].time;
        const repLoss = parseInt(getMetric('rep')) ?? defaultMetrics[severity].rep;

        try {
            // --- 4. APLICAÇÃO DO TIMEOUT ---
            if (selectedTimeMinutes > 0) {
                const timeInMs = selectedTimeMinutes * 60 * 1000;
                await member.timeout(timeInMs, reason).catch(() => {
                    console.error("Erro ao aplicar timeout (Permissões de cargo?)");
                });
            }

            // --- 5. REGISTRO NO BANCO (HISTÓRICO + REPUTAÇÃO) ---
            const insertPunishment = db.prepare(`
                INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, ticket_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(guildId, user.id, interaction.user.id, reason, severity, ticketId, timestamp);

            const punishmentId = insertPunishment.lastInsertRowid;

            db.prepare(`
                INSERT INTO users (user_id, guild_id, reputation, penalties, last_penalty)
                VALUES (?, ?, ?, 1, ?)
                ON CONFLICT(user_id, guild_id) DO UPDATE SET
                reputation = MAX(0, reputation - ?),
                penalties = penalties + 1,
                last_penalty = ?
            `).run(user.id, guildId, 100 - repLoss, timestamp, repLoss, timestamp);

            // --- 6. NOTIFICAÇÃO DM ---
            const dmEmbed = new EmbedBuilder()
                .setTitle(`⚖️ Notificação de Punição: ${interaction.guild.name}`)
                .setColor(0xff0000)
                .setDescription(`Uma ação administrativa foi registrada em seu perfil.`)
                .addFields(
                    { name: "📝 Motivo", value: `\`\`\`${reason}\`\`\`` },
                    { name: "🛠️ Ação", value: `\`${selectedAction} (${selectedTimeMinutes}m)\``, inline: true },
                    { name: "📉 Reputação", value: `\`-${repLoss} pts\``, inline: true },
                    { name: "🎫 Ticket", value: `\`#${ticketId}\``, inline: true }
                )
                .setFooter({ text: `Protocolo de Registro: #${punishmentId}` })
                .setTimestamp();

            await user.send({ embeds: [dmEmbed] }).catch(() => null);

            // --- 7. LOG STAFF ---
            const logChannel = interaction.guild.channels.cache.get(logChannelSetting.value);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle(`⚖️ Nova Punição | ID #${punishmentId}`)
                    .setColor(0xFF0000)
                    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                    .addFields(
                        { name: "👤 Usuário", value: `${user}\n(\`${user.id}\`)`, inline: true },
                        { name: "👮 Moderador", value: `${interaction.user}`, inline: true },
                        { name: "🎫 Ticket", value: `\`#${ticketId}\``, inline: true },
                        { name: "🛠️ Ação Aplicada", value: `\`${selectedAction} (${selectedTimeMinutes}m)\``, inline: true },
                        { name: "📉 Perda de Rep", value: `\`-${repLoss} pontos\``, inline: true },
                        { name: "📝 Motivo Oficial", value: `\`\`\`${reason}\`\`\`` }
                    )
                    .setTimestamp();

                logChannel.send({ embeds: [logEmbed] }).catch(() => null);
            }

            await interaction.editReply({ 
                content: `✅ Punição **#${punishmentId}** aplicada com sucesso.\n📉 **-${repLoss}** pontos de reputação para ${user.username}.` 
            });

        } catch (err) {
            console.error(err);
            return interaction.editReply(`❌ **Erro interno:** ${err.message}`);
        }
    }
};