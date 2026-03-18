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
                { name: '3 - Castigo leve (-10 Rep)', value: 3 },
                { name: '4 - Castigo médio (-20 Rep)', value: 4 },
                { name: '5 - Castigo severo (-35 Rep)', value: 5 }
            ))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da punição').setRequired(true)),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        // --- 1. VERIFICAÇÃO DE CONFIGURAÇÃO DO SERVIDOR ---
        const staffRoleSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guildId);
        const logChannelSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guildId);

        if (!staffRoleSetting || !logChannelSetting) {
            return interaction.reply({
                content: "⚠️ **O sistema ainda não foi configurado por um Administrador.**\nPara usar este comando, o canal de logs e o cargo de Staff precisam ser definidos via `/config`.",
                ephemeral: true
            });
        }

        // --- 2. VERIFICAÇÃO DE PERMISSÃO DO USUÁRIO ---
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasRole = interaction.member.roles.cache.has(staffRoleSetting.value);

        if (!hasRole && !isAdmin) {
            return interaction.reply({ 
                content: "❌ Este comando é restrito à **Staff** configurada ou **Administradores**.", 
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

        // Impedir que o bot tente punir a si mesmo
        if (user.id === interaction.client.user.id) return interaction.editReply("❌ Eu não posso punir a mim mesmo.");
        
        // Verificação de Hierarquia
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
            // 3. Aplicação do Timeout no Discord
            if (selected.time > 0) {
                await member.timeout(selected.time, reason).catch((err) => {
                    console.error(err);
                    throw new Error("Permissão insuficiente para dar timeout neste membro.");
                });
            }

            // 4. Registro no Histórico de Punições
            const insertPunishment = db.prepare(`
                INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(guildId, user.id, interaction.user.id, reason, severity, timestamp);

            const punishmentId = insertPunishment.lastInsertRowid;

            // 5. Atualização da Reputação (Lógica UPSERT por Guilda)
            db.prepare(`
                INSERT INTO users (user_id, guild_id, reputation, penalties, last_penalty)
                VALUES (?, ?, ?, 1, ?)
                ON CONFLICT(user_id, guild_id) DO UPDATE SET
                reputation = MAX(0, reputation - ?),
                penalties = penalties + 1,
                last_penalty = ?
            `).run(user.id, guildId, 100 - repLoss, timestamp, repLoss, timestamp);

            // --- NOVO: ENVIO DE DM PARA O JOGADOR ---
            const dmEmbed = new EmbedBuilder()
                .setTitle(`⚖️ Você recebeu uma punição em ${interaction.guild.name}`)
                .setColor(0xff0000)
                .setThumbnail(interaction.guild.iconURL())
                .setDescription(`Olá ${user.username}, uma ação administrativa foi aplicada à sua conta. Entre em contato com os administradores do servidor da forma correta caso isso seja um erro, a punição é aplicada sempre por um staff do servidor.`)
                .addFields(
                    { name: "📝 Motivo", value: `\`\`\`${reason}\`\`\`` },
                    { name: "📊 Gravidade", value: `Nível ${severity}`, inline: true },
                    { name: "📉 Reputação Perdida", value: `-${repLoss} pontos`, inline: true },
                    { name: "⏳ Medida Aplicada", value: selected.action, inline: true }
                )
                .setFooter({ text: "Siga as regras para evitar punições severas e perda de reputação." })
                .setTimestamp();
            try {
                await user.send({ embeds: [dmEmbed] });
            } catch (err) {
                console.log(`Não foi possível enviar DM para ${user.tag}. (DMs fechadas)`);
                // Não travamos o comando aqui, apenas avisamos no log interno que a DM falhou.
            }

            // 6. Envio de Logs (Já validado que o canal existe no passo 1)
            const logChannel = interaction.guild.channels.cache.get(logChannelSetting.value);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle(`⚖️ Punição Aplicada | ID: #${punishmentId}`)
                    .setColor(0xFF0000)
                    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                    .addFields(
                        { name: "🆔 Protocolo (ID)", value: `\`#${punishmentId}\``, inline: true },
                        { name: "👤 Usuário", value: `${user}\n(\`${user.id}\`)`, inline: true },
                        { name: "👮 Moderador", value: `${interaction.user}`, inline: true },
                        { name: "📉 Reputação", value: `\`-${repLoss} pontos\``, inline: true },
                        { name: "🛠️ Ação", value: `\`${selected.action}\``, inline: true },
                        { name: "📝 Motivo", value: `\`\`\`${reason}\`\`\`` }
                    )
                    .setFooter({ text: `Use /historico para ver o passado deste usuário.` })
                    .setTimestamp();

                logChannel.send({ embeds: [logEmbed] }).catch(() => null);
            }

            await interaction.editReply({ 
                content: `✅ Punição **#${punishmentId}** aplicada a **${user.username}**. Reputação descontada conforme a gravidade nível ${severity}.` 
            });

        } catch (err) {
            console.error(err);
            return interaction.editReply(`❌ **Erro ao punir:** ${err.message}`);
        }
    }
};