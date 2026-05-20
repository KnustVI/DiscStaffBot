// /home/ubuntu/DiscStaffBot/src/commands/developer/reset-db.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const ContainerFormatter = require('../../utils/ContainerFormatter');

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
        
        // ==================== VERIFICAÇÃO DE ACESSO ====================
        if (user.id !== DEVELOPER_ID) {
            db.logActivity(guildId, user.id, 'reset_db_denied', null, { 
                command: 'reset-db',
                reason: 'Usuário não autorizado',
                userId: user.id,
                userTag: user.tag
            });
            
            const deniedBuilder = ContainerFormatter.createBuilder(guild.name, 0xF64B4E);
            deniedBuilder.addTitle(`${emojis.Error || '❌'} Acesso Negado`, 1);
            deniedBuilder.addText('Este comando é restrito ao desenvolvedor do bot.');
            deniedBuilder.addSeparator();
            deniedBuilder.addText(`**Seu ID:** \`${user.id}\``);
            deniedBuilder.addText(`**ID Autorizado:** \`${DEVELOPER_ID}\``);
            deniedBuilder.addFooter('Caso necessário, contate o desenvolvedor.');
            
            await interaction.editReply({
                components: [deniedBuilder.build()],
                flags: ['IsComponentsV2']
            });
            return;
        }
        
        // ==================== CONFIRMAÇÃO ====================
        if (confirmacao !== 'LIMPAR TUDO') {
            const cancelBuilder = ContainerFormatter.createBuilder(guild.name, 0xFFBD59);
            cancelBuilder.addTitle(`${emojis.Warning || '⚠️'} Ação Cancelada`, 1);
            cancelBuilder.addText(`Digite exatamente **"LIMPAR TUDO"** para confirmar a limpeza.`);
            cancelBuilder.addSeparator();
            cancelBuilder.addText(`**Você digitou:** \`${confirmacao}\``);
            cancelBuilder.addFooter();
            
            await interaction.editReply({
                components: [cancelBuilder.build()],
                flags: ['IsComponentsV2']
            });
            return;
        }
        
        // ==================== EXECUÇÃO DA LIMPEZA ====================
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
            });
            
            clearDB();
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
            
            // ==================== NOTIFICAÇÃO NO CANAL DE LOG ====================
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_channel');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const alertBuilder = ContainerFormatter.createBuilder(guild.name, 0xF64B4E);
                        alertBuilder.addTitle(`${emojis.Warning || '⚠️'} ALERTA CRÍTICO: BANCO DE DADOS LIMPO`, 1);
                        alertBuilder.addSeparator();
                        alertBuilder.addText(`**Desenvolvedor:** ${user.tag}`);
                        alertBuilder.addText(`**Servidor:** ${guild.name}`);
                        alertBuilder.addSeparator();
                        alertBuilder.addText(`**Dados removidos:**`);
                        alertBuilder.addText(`- Reputação: \`${statsBefore.reputation}\` registros`);
                        alertBuilder.addText(`- Punições: \`${statsBefore.punishments}\` registros`);
                        alertBuilder.addText(`- Reports: \`${statsBefore.reports}\` registros`);
                        alertBuilder.addSeparator();
                        alertBuilder.addText(`**ID da Transação:** \`${activityId}\``);
                        alertBuilder.addFooter();
                        
                        await logChannel.send({
                            components: [alertBuilder.build()],
                            flags: ['IsComponentsV2']
                        });
                    }
                } catch (err) {}
            }
            
            // ==================== RESPOSTA DE SUCESSO ====================
            const successBuilder = ContainerFormatter.createBuilder(guild.name, 0xBBF96A);
            successBuilder.addTitle(`${emojis.CLEAN || '🧹'} Database Resetada`, 1);
            successBuilder.addSeparator();
            successBuilder.addText(`Operação concluída com sucesso em **${guild.name}**.`);
            successBuilder.addSeparator();
            successBuilder.addText(`**Registros removidos:**`);
            successBuilder.addText(`- Reputação: \`${statsBefore.reputation}\``);
            successBuilder.addText(`- Punições: \`${statsBefore.punishments}\``);
            successBuilder.addText(`- Reports: \`${statsBefore.reports}\``);
            successBuilder.addSeparator();
            successBuilder.addText(`**Tempo de execução:** \`${Date.now() - startTime}ms\``);
            successBuilder.addFooter(`UUID: ${resetUuid.slice(0, 8)}`);
            
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
            
            const errorBuilder = ContainerFormatter.createBuilder(guild.name, 0xF64B4E);
            errorBuilder.addTitle(`${emojis.Error || '❌'} Erro ao Resetar`, 1);
            errorBuilder.addText(`Ocorreu um erro crítico. O banco de dados pode estar inconsistente.`);
            errorBuilder.addSeparator();
            errorBuilder.addText(`**Código:** \`${error.message?.slice(0, 100) || 'Desconhecido'}\``);
            errorBuilder.addFooter('Contate o suporte imediatamente.');
            
            await interaction.editReply({
                components: [errorBuilder.build()],
                flags: ['IsComponentsV2']
            });
        }
    }
};