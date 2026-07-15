// /home/ubuntu/DiscStaffBot/src/commands/developer/reset-db.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const SequenceManager = require('../../database/sequences');

const DEVELOPER_ID = '203676076189286412';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-db')
        .setDescription('⚠️ LIMPEZA TOTAL: Apaga todos os dados de reputação e punições de um servidor.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt =>
            opt.setName('servidor_id')
                .setDescription('ID do servidor Discord a limpar')
                .setRequired(true))
        .addStringOption(opt =>
            opt.setName('confirmar')
                .setDescription('Digite "LIMPAR TUDO" para confirmar a ação')
                .setRequired(true)),

    // client aqui é sempre o bot PRINCIPAL (já em todo servidor de cliente),
    // não o bot developer que recebeu a interação — ver src/systems/core/
    // devBot.js. interaction.guild não existe (o comando roda no servidor
    // privado do dono, não no servidor alvo), por isso o alvo vem inteiro do
    // parâmetro servidor_id, resolvido via client.guilds.
    async execute(interaction, client) {
        const startTime = Date.now();
        const { user, options } = interaction;
        const guildId = options.getString('servidor_id');
        const confirmacao = options.getString('confirmar');

        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }

        if (user.id !== DEVELOPER_ID) {
            db.logActivity(guildId, user.id, 'reset_db_denied', null, {
                command: 'reset-db',
                reason: 'Usuário não autorizado',
                userId: user.id,
                userTag: user.tag
            });

            const deniedBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });
            deniedBuilder.text('# ACESSO NEGADO');
            deniedBuilder.text('Este comando é restrito ao desenvolvedor do bot.');
            deniedBuilder.separator();
            deniedBuilder.text(`**Seu ID:** \`${user.id}\``);
            deniedBuilder.text(`**ID Autorizado:** \`${DEVELOPER_ID}\``);
            deniedBuilder.footer('Bot de Developer');

            const { components, flags } = deniedBuilder.build();
            await interaction.editReply({
                components,
                flags: [flags]
            });
            return;
        }

        const targetGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (!targetGuild) {
            const errBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });
            errBuilder.text(`${emojis.circlealert || '❌'} O bot principal não está no servidor \`${guildId}\` (ou o ID está errado).`);
            errBuilder.footer('Bot de Developer');
            const { components, flags } = errBuilder.build();
            await interaction.editReply({ components, flags: [flags] });
            return;
        }

        if (confirmacao !== 'LIMPAR TUDO') {
            const cancelBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
            cancelBuilder.section(
                [
                    '# AÇÃO CANCELADA',
                    'Digite exatamente **"LIMPAR TUDO"** para confirmar a limpeza.',
                ].join('\n'),
                AdvancedContainerBuilder.thumbnail(targetGuild.iconURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png')
            );
            cancelBuilder.separator();
            cancelBuilder.text(`**Você digitou:** \`${confirmacao}\``);
            cancelBuilder.footer(targetGuild.name);

            const { components, flags } = cancelBuilder.build();
            await interaction.editReply({
                components,
                flags: [flags]
            });
            return;
        }

        try {
            const ConfigSystem = require('../../systems/core/configSystem');

            const statsBefore = {
                reputation: db.prepare(`SELECT COUNT(*) as count FROM reputation WHERE guild_id = ?`).get(guildId)?.count || 0,
                punishments: db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ?`).get(guildId)?.count || 0,
                reports: 0,
                feedbacks: 0
            };

            try {
                statsBefore.reports = db.prepare(`SELECT COUNT(*) as count FROM reports WHERE guild_id = ?`).get(guildId)?.count || 0;
            } catch (err) {}

            try {
                statsBefore.feedbacks = db.prepare(`SELECT COUNT(*) as count FROM feedbacks WHERE guild_id = ?`).get(guildId)?.count || 0;
            } catch (err) {}

            const clearDB = db.transaction(() => {
                db.prepare('DELETE FROM reputation WHERE guild_id = ?').run(guildId);
                db.prepare('DELETE FROM punishments WHERE guild_id = ?').run(guildId);
                try { db.prepare('DELETE FROM reports WHERE guild_id = ?').run(guildId); } catch (err) {}
                try { db.prepare('DELETE FROM feedbacks WHERE guild_id = ?').run(guildId); } catch (err) {}
                try { db.prepare('DELETE FROM activity_logs WHERE guild_id = ?').run(guildId); } catch (err) {}
                try { db.prepare('DELETE FROM staff_analytics WHERE guild_id = ?').run(guildId); } catch (err) {}

                try { db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'punishments'`).run(); } catch (err) {}
                try { db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'reports'`).run(); } catch (err) {}
                try { db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'reputation'`).run(); } catch (err) {}
                try { db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'feedbacks'`).run(); } catch (err) {}
            });

            clearDB();
            SequenceManager.resetAllSequences(guildId);
            ConfigSystem.clearCache(guildId);

            try {
                db.pragma('vacuum');
            } catch (err) {}

            const resetUuid = db.generateUUID();
            const activityId = db.logActivity(guildId, user.id, 'reset_db', null, {
                command: 'reset-db',
                resetUuid,
                statsBefore,
                responseTime: Date.now() - startTime
            });

            const logChannelId = ConfigSystem.getSetting(guildId, 'log_channel');
            if (logChannelId) {
                try {
                    const logChannel = await targetGuild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const alertBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });
                        alertBuilder.section(
                            [
                                '# ALERTA CRÍTICO: BANCO DE DADOS LIMPO',
                                `**Desenvolvedor:** ${user.tag}`,
                                `**Servidor:** ${targetGuild.name}`,
                            ].join('\n'),
                            AdvancedContainerBuilder.thumbnail(targetGuild.iconURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png')
                        );
                        alertBuilder.separator();
                        alertBuilder.text(`**Dados removidos:**`);
                        alertBuilder.text(`- Reputação: \`${statsBefore.reputation}\` registros`);
                        alertBuilder.text(`- Punições: \`${statsBefore.punishments}\` registros`);
                        alertBuilder.text(`- Reports: \`${statsBefore.reports}\` registros`);
                        alertBuilder.separator();
                        alertBuilder.text(`**ID da Transação:** \`${activityId}\``);
                        alertBuilder.footer(targetGuild.name);

                        const { components, flags } = alertBuilder.build();
                        await logChannel.send({
                            components,
                            flags: [flags]
                        });
                    }
                } catch (err) {}
            }

            const successBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });
            successBuilder.section(
                [
                    '# DATABASE RESETADA',
                    `Operação concluída com sucesso em **${targetGuild.name}**.`,
                ].join('\n'),
                AdvancedContainerBuilder.thumbnail(targetGuild.iconURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png')
            );
            successBuilder.separator();
            successBuilder.text(`**Registros removidos:**`);
            successBuilder.text(`- Reputação: \`${statsBefore.reputation}\``);
            successBuilder.text(`- Punições: \`${statsBefore.punishments}\``);
            successBuilder.text(`- Reports: \`${statsBefore.reports}\``);
            successBuilder.separator();
            successBuilder.text(`**Tempo de execução:** \`${Date.now() - startTime}ms\``);
            successBuilder.footer(targetGuild.name, `UUID: ${resetUuid.slice(0, 8)}`);

            const { components, flags } = successBuilder.build();
            await interaction.editReply({
                components,
                flags: [flags]
            });

            console.log(`📊 [RESET-DB] ${user.tag} resetou ${targetGuild.name} | ${Date.now() - startTime}ms`);

        } catch (error) {
            console.error('❌ Erro no reset-db:', error);

            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');

            db.logActivity(guildId, user.id, 'error', null, {
                command: 'reset-db', error: error.message
            });

            const errorBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });
            errorBuilder.section(
                [
                    '# ERRO AO RESETAR',
                    'Ocorreu um erro crítico. O banco de dados pode estar inconsistente.',
                ].join('\n'),
                AdvancedContainerBuilder.thumbnail(targetGuild.iconURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png')
            );
            errorBuilder.separator();
            errorBuilder.text(`**Código:** \`${error.message?.slice(0, 100) || 'Desconhecido'}\``);
            errorBuilder.footer(targetGuild.name, 'Contate o suporte imediatamente.');

            const { components, flags } = errorBuilder.build();
            await interaction.editReply({
                components,
                flags: [flags]
            });
        }
    }
};
