// /home/ubuntu/DiscStaffBot/src/commands/developer/reset-db.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const ContainerFormatter = require('../../utils/containerFormatter');
const SequenceManager = require('../../database/sequences');

const DEVELOPER_ID = '203676076189286412';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-db')
        .setDescription('⚠️ LIMPEZA TOTAL: Apaga todos os dados de reputação e punições DESTE servidor.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => 
            opt.setName('confirmar')
                .setDescription('Digite "LIMPAR TUDO" para confirmar a ação')
                .setRequired(true)),

    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, user, options } = interaction;
        const guildId = guild.id;
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
            
            const deniedBuilder = ContainerFormatter.create(guild.name, 0xF64B4E);
            deniedBuilder.title(`${emojis.Error || '❌'} Acesso Negado`, 1);
            deniedBuilder.text('Este comando é restrito ao desenvolvedor do bot.');
            deniedBuilder.line();
            deniedBuilder.text(`**Seu ID:** \`${user.id}\``);
            deniedBuilder.text(`**ID Autorizado:** \`${DEVELOPER_ID}\``);
            deniedBuilder.footer('Caso necessário, contate o desenvolvedor.');
            
            await interaction.editReply({
                components: [deniedBuilder.build()],
                flags: ['IsComponentsV2']
            });
            return;
        }
        
        if (confirmacao !== 'LIMPAR TUDO') {
            const cancelBuilder = ContainerFormatter.create(guild.name, 0xFFBD59);
            cancelBuilder.title(`${emojis.Warning || '⚠️'} Ação Cancelada`, 1);
            cancelBuilder.text(`Digite exatamente **"LIMPAR TUDO"** para confirmar a limpeza.`);
            cancelBuilder.line();
            cancelBuilder.text(`**Você digitou:** \`${confirmacao}\``);
            cancelBuilder.footer();
            
            await interaction.editReply({
                components: [cancelBuilder.build()],
                flags: ['IsComponentsV2']
            });
            return;
        }
        
        try {
            const ConfigSystem = require('../../systems/configSystem');
            
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
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const alertBuilder = ContainerFormatter.create(guild.name, 0xF64B4E);
                        alertBuilder.title(`${emojis.Warning || '⚠️'} ALERTA CRÍTICO: BANCO DE DADOS LIMPO`, 1);
                        alertBuilder.line();
                        alertBuilder.text(`**Desenvolvedor:** ${user.tag}`);
                        alertBuilder.text(`**Servidor:** ${guild.name}`);
                        alertBuilder.line();
                        alertBuilder.text(`**Dados removidos:**`);
                        alertBuilder.text(`- Reputação: \`${statsBefore.reputation}\` registros`);
                        alertBuilder.text(`- Punições: \`${statsBefore.punishments}\` registros`);
                        alertBuilder.text(`- Reports: \`${statsBefore.reports}\` registros`);
                        alertBuilder.line();
                        alertBuilder.text(`**ID da Transação:** \`${activityId}\``);
                        alertBuilder.footer();
                        
                        await logChannel.send({
                            components: [alertBuilder.build()],
                            flags: ['IsComponentsV2']
                        });
                    }
                } catch (err) {}
            }
            
            const successBuilder = ContainerFormatter.create(guild.name, 0xBBF96A);
            successBuilder.title(`${emojis.CLEAN || '🧹'} Database Resetada`, 1);
            successBuilder.line();
            successBuilder.text(`Operação concluída com sucesso em **${guild.name}**.`);
            successBuilder.line();
            successBuilder.text(`**Registros removidos:**`);
            successBuilder.text(`- Reputação: \`${statsBefore.reputation}\``);
            successBuilder.text(`- Punições: \`${statsBefore.punishments}\``);
            successBuilder.text(`- Reports: \`${statsBefore.reports}\``);
            successBuilder.line();
            successBuilder.text(`**Tempo de execução:** \`${Date.now() - startTime}ms\``);
            successBuilder.footer(`UUID: ${resetUuid.slice(0, 8)}`);
            
            await interaction.editReply({
                components: [successBuilder.build()],
                flags: ['IsComponentsV2']
            });
            
            console.log(`📊 [RESET-DB] ${user.tag} resetou ${guild.name} | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            console.error('❌ Erro no reset-db:', error);
            
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            db.logActivity(guildId, user.id, 'error', null, { 
                command: 'reset-db', error: error.message
            });
            
            const errorBuilder = ContainerFormatter.create(guild.name, 0xF64B4E);
            errorBuilder.title(`${emojis.Error || '❌'} Erro ao Resetar`, 1);
            errorBuilder.text(`Ocorreu um erro crítico. O banco de dados pode estar inconsistente.`);
            errorBuilder.line();
            errorBuilder.text(`**Código:** \`${error.message?.slice(0, 100) || 'Desconhecido'}\``);
            errorBuilder.footer('Contate o suporte imediatamente.');
            
            await interaction.editReply({
                components: [errorBuilder.build()],
                flags: ['IsComponentsV2']
            });
        }
    }
};