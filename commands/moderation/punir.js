const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis'); // Importe os emojis

module.exports = {
    data: new SlashCommandBuilder()
        .setName('punir')
        .setDescription('Aplica uma punição e desconta pontos de reputação.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(opt => opt.setName('usuario').setDescription('O usuário que será punido').setRequired(true))
        .addIntegerOption(opt => opt.setName('gravidade').setDescription('Nível da infração (1 a 5)').setRequired(true)
            .addChoices(
                { name: 'Nível 1 (Leve)', value: 1 },
                { name: 'Nível 2 (Média)', value: 2 },
                { name: 'Nível 3 (Grave)', value: 3 },
                { name: 'Nível 4 (Gravíssima)', value: 4 },
                { name: 'Nível 5 (Banimento)', value: 5 }
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

        // --- 1. VERIFICAÇÕES DE CONFIGURAÇÃO ---
        const staffRoleSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guildId);
        const logChannelSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guildId);

        if (!staffRoleSetting || !logChannelSetting) {
            return interaction.reply({ content: `${EMOJIS.ERRO} **O sistema não está configurado.** Use os comandos de setup primeiro.`, ephemeral: true });
        }

        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasRole = interaction.member.roles.cache.has(staffRoleSetting.value);
        if (!hasRole && !isAdmin) return interaction.reply({ content: `${EMOJIS.ERRO} Você não tem permissão de Staff para usar este comando.`, ephemeral: true });

        await interaction.deferReply({ ephemeral: true });

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.editReply(`${EMOJIS.ERRO} Usuário não encontrado no servidor.`);

        // --- 2. DEFINIÇÃO DE MÉTRICAS (BANCO OU DEFAULT) ---
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
            // --- 3. EXECUÇÃO DA AÇÃO DISCORD ---
            let executionDetail = "Aviso (Advertência)";
            if (selectedAction === 'timeout' && selectedTimeMinutes > 0) {
                await member.timeout(selectedTimeMinutes * 60 * 1000, reason);
                executionDetail = `Timeout (${selectedTimeMinutes}min)`;
            } else if (selectedAction === 'ban') {
                await member.ban({ reason });
                executionDetail = "Banimento Permanente";
            }

            // --- 4. PERSISTÊNCIA NO BANCO DE DADOS ---
            // Salva a punição com o ticket_id
            const insertPunishment = db.prepare(`
                INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, ticket_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(guildId, user.id, interaction.user.id, reason, severity, ticketId, timestamp);

            const punishmentId = insertPunishment.lastInsertRowid;

            // Atualiza reputação do usuário
            db.prepare(`
                INSERT INTO users (user_id, guild_id, reputation, penalties, last_penalty)
                VALUES (?, ?, ?, 1, ?)
                ON CONFLICT(user_id, guild_id) DO UPDATE SET
                reputation = MAX(0, reputation - ?), 
                penalties = penalties + 1, 
                last_penalty = ?
            `).run(user.id, guildId, 100 - repLoss, timestamp, repLoss, timestamp);

            const userData = db.prepare(`SELECT reputation FROM users WHERE user_id = ? AND guild_id = ?`).get(user.id, guildId);

            // --- 5. CONSTRUÇÃO DA EMBED (ORGANIZADA) ---
            const finalEmbed = new EmbedBuilder()
                .setDescription(`# ${EMOJIS.ACTION} Nova Punição | ID #${punishmentId}`)
                .setThumbnail(user.displayAvatarURL({ forceStatic: false }))
                .setColor(0xFF0000)
                .addFields(
                    { name: `${EMOJIS.USUARIO} Usuário`, value: `<@${punishment.user_id}> (\`${punishment.user_id}\`)`, inline: true },
                    { name: `${EMOJIS.STAFF} STAFF`, value: `${interaction.user}`, inline: true },
                    { name: `${EMOJIS.ACTION} Ação Aplicada`, value: `\`${executionDetail}\``, inline: true },
                    { name: `${EMOJIS.DOWN} Reputação`, value: `\`${userData.reputation} pts (-${repLoss})\``, inline: true },
                    { name: `${EMOJIS.TICKET} Ticket`, value: `\`\`\`#${ticketId}\`\`\``, inline: true },
                    { name: `${EMOJIS.NOTE} Motivo Detalhado`, value: `\`\`\`${reason}\`\`\`` }
                )
                .setFooter({ 
                    text: interaction.guild.name, 
                    iconURL: interaction.guild.iconURL({ forceStatic: false }) || null
                })
                .setTimestamp();

            // Envio para Logs da Staff
            const logChannel = interaction.guild.channels.cache.get(logChannelSetting.value);
            if (logChannel) {
                await logChannel.send({ embeds: [finalEmbed] }).catch(() => null);
            }

            // Envio para o Usuário (DM)
            await user.send({ 
                content: `${EMOJIS.DM} Você recebeu uma nova punição em **${interaction.guild.name}**.`, 
                embeds: [finalEmbed] 
            }).catch(() => null);

            await interaction.editReply({ content: `${EMOJIS.CHECK} Punição **#${punishmentId}** aplicada e registrada com sucesso.` });

        } catch (err) {
            console.error("Erro no comando punir:", err);
            return interaction.editReply(`${EMOJIS.ERRO} Erro ao aplicar punição. Verifique se o cargo do bot está acima do usuário e se as permissões estão corretas.`);
        }
    }
};