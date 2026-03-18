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
        const alertChannelSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'alert_channel'`).get(guildId);

        if (!staffRoleSetting || !logChannelSetting) {
            return interaction.reply({
                content: "⚠️ **O sistema não está configurado.** Use `/config canais-e-cargos` primeiro.",
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

        if (member.roles.highest.position >= interaction.member.roles.highest.position && !isAdmin) {
            return interaction.editReply("❌ Você não pode punir alguém com cargo superior ou igual ao seu.");
        }

        // --- 3. BUSCA DINÂMICA DE MÉTRICAS ---
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
            // --- 4. APLICAÇÃO DA PUNIÇÃO NO DISCORD ---
            let executionDetail = "Ação registrada";

            if (selectedAction === 'timeout' && selectedTimeMinutes > 0) {
                const timeInMs = selectedTimeMinutes * 60 * 1000;
                await member.timeout(timeInMs, reason);
                executionDetail = `Timeout (${selectedTimeMinutes}m)`;
            } 
            else if (selectedAction === 'ban') {
                await member.ban({ reason: `Punição Nível ${severity}: ${reason}` });
                executionDetail = "Banimento Permanente";
            } 
            else if (selectedAction === 'kick') {
                await member.kick(reason);
                executionDetail = "Expulsão";
            } 
            else {
                executionDetail = "Aviso (ADV)";
            }

            // --- 5. REGISTRO NO BANCO ---
            const insertPunishment = db.prepare(`
                INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, ticket_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(guildId, user.id, interaction.user.id, reason, severity, ticketId, timestamp);

            const punishmentId = insertPunishment.lastInsertRowid;

            // Atualiza reputação e pega o novo valor para o alerta
            db.prepare(`
                INSERT INTO users (user_id, guild_id, reputation, penalties, last_penalty)
                VALUES (?, ?, ?, 1, ?)
                ON CONFLICT(user_id, guild_id) DO UPDATE SET
                reputation = MAX(0, reputation - ?),
                penalties = penalties + 1,
                last_penalty = ?
            `).run(user.id, guildId, 100 - repLoss, timestamp, repLoss, timestamp);

            const userData = db.prepare(`SELECT reputation FROM users WHERE user_id = ? AND guild_id = ?`).get(user.id, guildId);

            // --- 6. LOGS E ALERTAS (SISTEMA DE MONITORAMENTO) ---
            const logChannel = interaction.guild.channels.cache.get(logChannelSetting.value);
            const alertChannel = alertChannelSetting ? interaction.guild.channels.cache.get(alertChannelSetting.value) : null;

            // Envio para o Canal de Logs (Padrão)
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setDescription(`# ⚖️ Nova Punição | ID #${punishmentId}`)
                    .setColor(0xFF0000)
                    .addFields(
                        { name: "👤 Usuário", value: `${user} (\`${user.id}\`)`, inline: true },
                        { name: "👮 Moderador", value: `${interaction.user}`, inline: true },
                        { name: "🛠️ Ação", value: `\`${executionDetail}\``, inline: true },
                        { name: "📉 Reputação Atual", value: `\`${userData.reputation} pts\``, inline: true },
                        { name: "📝 Motivo", value: `\`\`\`${reason}\`\`\`` }
                    )
                    .setFooter({ 
                    text: interaction.guild.name, 
                    iconURL: interaction.guild
                    .iconURL({ dynamic: true })})
                    .setTimestamp();
                logChannel.send({ embeds: [logEmbed] }).catch(() => null);
            }

            // --- LÓGICA DE ALERTAS CRÍTICOS ---
            if (alertChannel) {
                // Alerta 1: Usuário em Estado Crítico (Reputação < 30)
                if (userData.reputation <= 30) {
                    const userAlert = new EmbedBuilder()
                        .setColor(0xFFFF00) // Amarelo
                        .setDescription("# ⚠️ ALERTA: Usuário em Estado Crítico" +
                            `O usuário ${user} atingiu um nível de reputação perigoso.`)
                        .addFields(
                            { name: "📉 Reputação Restante", value: `**${userData.reputation} pontos**`, inline: true },
                            { name: "🎫 Último Protocolo", value: `#${punishmentId}`, inline: true }
                        )
                        .setFooter({ 
                        text: interaction.guild.name, 
                        iconURL: interaction.guild
                        .iconURL({ dynamic: true })})
                        .setTimestamp();

                    alertChannel.send({ embeds: [userAlert] });
                }

                // Alerta 2: Monitoramento de Staff (Punições Graves Nível 4 e 5)
                if (severity >= 4) {
                    const staffAlert = new EmbedBuilder()
                        .setColor(0xFF4500) // Laranja/Vermelho forte
                        .setDescription(`# 🚨 MONITORAMENTO: Punição de Alta Gravidade`+
                            `O moderador ${interaction.user} aplicou uma punição de **Nível ${severity}**.`)
                        .addFields(
                            { name: "👤 Alvo", value: `${user}`, inline: true },
                            { name: "🛠️ Ação", value: `\`${executionDetail}\``, inline: true },
                            { name: "📝 Motivo", value: `\`\`\`${reason}\`\`\`` }
                        )
                        .setFooter({ 
                        text: interaction.guild.name, 
                        iconURL: interaction.guild
                        .iconURL({ dynamic: true })})
                        .setTimestamp();

                    alertChannel.send({ embeds: [staffAlert] });
                }
            }

            // --- 7. NOTIFICAÇÃO DM E RESPOSTA FINAL ---
            const dmEmbed = new EmbedBuilder()
                .setDescription(`# ⚖️ Punição Recebida: ${interaction.guild.name}`)
                .setColor(0xff0000)
                .addFields(
                    { name: "📝 Motivo", value: `\`\`\`${reason}\`\`\`` },
                    { name: "📉 Reputação", value: `\`-${repLoss} pts\``, inline: true },
                    { name: "🎫 Protocolo", value: `#${punishmentId}`, inline: true }
                )
                .setFooter({ 
                    text: interaction.guild.name, 
                    iconURL: interaction.guild
                    .iconURL({ dynamic: true })})
                    .setTimestamp();
                
            await user.send({ embeds: [dmEmbed] }).catch(() => null);

            await interaction.editReply({ 
                content: `✅ Punição **#${punishmentId}** aplicada com sucesso.\n${userData.reputation <= 30 ? "⚠️ **Aviso:** Este usuário entrou em estado crítico de reputação." : ""}` 
            });

        } catch (err) {
            console.error(err);
            return interaction.editReply(`❌ **Erro ao aplicar punição:** Verifique minhas permissões e posição de cargo.`);
        }
    }
};