const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('punir')
        .setDescription('Aplica uma punição e desconta pontos de reputação.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(opt => opt.setName('usuario').setDescription('O usuário que será punido').setRequired(true))
        .addIntegerOption(opt => opt.setName('gravidade').setDescription('Nível da infração').setRequired(true)
            .addChoices(
                { name: '1 - Aviso (-2 Rep)', value: 1 },
                { name: '2 - Advertência (-5 Rep)', value: 2 },
                { name: '3 - Timeout leve (-10 Rep)', value: 3 },
                { name: '4 - Timeout médio (-20 Rep)', value: 4 },
                { name: '5 - Timeout severo (-35 Rep)', value: 5 }
            ))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da punição').setRequired(true)),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        // --- VERIFICAÇÃO DE STAFF ---
        const staffRoleSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guildId);
        const hasRole = staffRoleSetting ? interaction.member.roles.cache.has(staffRoleSetting.value) : false;
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!hasRole && !isAdmin) {
            return interaction.reply({ 
                content: "❌ Este comando é restrito ao cargo de **Staff** configurado.", 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const user = interaction.options.getUser('usuario');
        const severity = interaction.options.getInteger('gravidade');
        const reason = interaction.options.getString('motivo');
        const timestamp = Date.now();

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.editReply("❌ Usuário não encontrado no servidor.");

        // Hierarquia
        if (member.roles.highest.position >= interaction.member.roles.highest.position && !isAdmin) {
            return interaction.editReply("❌ Você não pode punir alguém com um cargo superior ou igual ao seu.");
        }

        const punishmentsMap = {
            1: { action: "Aviso", time: 0 },
            2: { action: "Timeout (5m)", time: 5 * 60 * 1000 },
            3: { action: "Timeout (30m)", time: 30 * 60 * 1000 },
            4: { action: "Timeout (2h)", time: 2 * 60 * 60 * 1000 },
            5: { action: "Timeout (24h)", time: 24 * 60 * 60 * 1000 }
        };

        const penaltyValues = { 1: 2, 2: 5, 3: 10, 4: 20, 5: 35 };
        const selected = punishmentsMap[severity];
        const repLoss = penaltyValues[severity];

        try {
            // 1. Aplicação física
            if (selected.time > 0) {
                await member.timeout(selected.time, reason).catch(() => {
                    throw new Error("O bot não tem permissão para dar timeout neste usuário.");
                });
            }

            // 2. Registro no Histórico
            db.prepare(`
                INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(guildId, user.id, interaction.user.id, reason, severity, timestamp);

            // 3. Atualização da Reputação (CORRIGIDO PARA O NOVO DB)
            db.prepare(`
                INSERT INTO users (user_id, guild_id, reputation, penalties, last_penalty)
                VALUES (?, ?, ?, 1, ?)
                ON CONFLICT(user_id, guild_id) DO UPDATE SET
                reputation = MAX(0, reputation - ?),
                penalties = penalties + 1,
                last_penalty = ?
            `).run(user.id, guildId, 100 - repLoss, timestamp, repLoss, timestamp);

            // 4. Logs
            const logSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guildId);
            
            if (logSetting) {
                const logChannel = interaction.guild.channels.cache.get(logSetting.value);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle("⚖️ Sistema de Moderação | Nova Punição")
                        .setColor(0xFF0000)
                        .setThumbnail(user.displayAvatarURL())
                        .addFields(
                            { name: "👤 Usuário", value: `${user} (\`${user.id}\`)`, inline: true },
                            { name: "👮 Moderador", value: `${interaction.user}`, inline: true },
                            { name: "📉 Reputação", value: `\`-${repLoss} pontos\``, inline: true },
                            { name: "🛠️ Ação", value: `\`${selected.action}\``, inline: true },
                            { name: "📝 Motivo", value: reason }
                        )
                        .setTimestamp();

                    logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                }
            }

            await interaction.editReply({ 
                content: `✅ **Sucesso!** Punição registrada para ${user.username}.` 
            });

        } catch (err) {
            console.error(err);
            return interaction.editReply(`❌ **Erro:** ${err.message}`);
        }
    }
};