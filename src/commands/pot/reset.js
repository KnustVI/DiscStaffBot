const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const PoTConfigSystem = require('../../systems/potConfigSystem');
const PoTTokenManager = require('../../integrations/pathoftitans/tokenManager');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');

const resetSessions = new Map();

module.exports = {
    async execute(interaction, client) {
        const scope = interaction.options.getString('scope');
        const guildId = interaction.guildId;
        const userId = interaction.user.id;

        // REMOVIDO: verificação desnecessária
        // if (interaction.replied || interaction.deferred) {
        //     console.warn('⚠️ [Reset] Interação já respondida, ignorando.');
        //     return;
        // }

        const modal = new ModalBuilder()
            .setCustomId(`pot_reset_confirm_${guildId}_${userId}`)
            .setTitle('⚠️ CONFIRMAR RESET');

        const confirmInput = new TextInputBuilder()
            .setCustomId('confirm_text')
            .setLabel('Digite "CONFIRMAR" para prosseguir')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('CONFIRMAR')
            .setRequired(true);

        const scopeInput = new TextInputBuilder()
            .setCustomId('scope_text')
            .setLabel('Escopo do reset (informação)')
            .setStyle(TextInputStyle.Short)
            .setValue(scope)
            .setRequired(false);

        const row1 = new ActionRowBuilder().addComponents(confirmInput);
        const row2 = new ActionRowBuilder().addComponents(scopeInput);

        modal.addComponents(row1, row2);

        resetSessions.set(`${guildId}_${userId}`, { scope, timestamp: Date.now() });

        await interaction.showModal(modal);

        const filter = (i) => 
            i.customId === `pot_reset_confirm_${guildId}_${userId}` &&
            i.user.id === userId;

        try {
            const modalInteraction = await interaction.awaitModalSubmit({ filter, time: 120000 });
            await modalInteraction.deferReply({ flags: 64 });

            const confirmText = modalInteraction.fields.getTextInputValue('confirm_text');
            const scopeValue = modalInteraction.fields.getTextInputValue('scope_text');

            if (confirmText !== 'CONFIRMAR') {
                await modalInteraction.editReply({
                    content: '❌ Confirmação inválida. Digite exatamente "CONFIRMAR".'
                });
                resetSessions.delete(`${guildId}_${userId}`);
                return;
            }

            const result = await this.executeReset(guildId, scopeValue || scope, modalInteraction);

            const builder = new AdvancedContainerBuilder({ 
                accentColor: result.success ? 0x00FF00 : 0xFF0000 
            });

            builder
                .title(result.success ? '✅ Reset Concluído' : '❌ Erro no Reset')
                .text(result.message);

            if (result.success) {
                builder.separator();
                if (scopeValue === 'server') {
                    builder.text('💡 Use `/potserver setup` para reconfigurar o servidor.');
                } else if (scopeValue === 'logs') {
                    builder.text('💡 Use `/potserver logs` para recriar os webhooks.');
                } else if (scopeValue === 'all') {
                    builder.text('💡 Use `/potserver setup` para configurar tudo novamente.');
                }
            }

            builder.footer(interaction.guild.name);
            await modalInteraction.editReply(builder.build());

        } catch (error) {
            if (error.code === 'InteractionCollectorError') {
                // A interação original já foi respondida pelo modal
                console.warn('⏰ [Reset] Tempo esgotado para o modal.');
            } else {
                console.error('❌ [Reset] Erro:', error);
            }
        } finally {
            resetSessions.delete(`${guildId}_${userId}`);
        }
    },

    async executeReset(guildId, scope, interaction) {
        try {
            switch(scope) {
                case 'server':
                    const stmt = require('../../database/index').prepare(
                        `DELETE FROM settings WHERE guild_id = ? AND key = ?`
                    );
                    stmt.run(guildId, 'pot_server_config');
                    return {
                        success: true,
                        message: '🖥️ Configuração do servidor removida com sucesso!\nO token foi mantido.'
                    };

                case 'logs':
                    const db = require('../../database/index');
                    const deleteStmt = db.prepare(
                        `DELETE FROM settings WHERE guild_id = ? AND key LIKE 'pot_webhook_%'`
                    );
                    deleteStmt.run(guildId);
                    return {
                        success: true,
                        message: '📨 Todos os webhooks foram removidos com sucesso!'
                    };

                case 'all':
                    PoTConfigSystem.clearAllConfigs(guildId);
                    PoTTokenManager.revokeToken(guildId);
                    return {
                        success: true,
                        message: '🗑️ Todas as configurações foram removidas!\nIncluindo o token do servidor.'
                    };

                default:
                    return {
                        success: false,
                        message: '❌ Escopo de reset inválido.'
                    };
            }
        } catch (error) {
            console.error('❌ [Reset] Erro ao executar reset:', error);
            return {
                success: false,
                message: `❌ Erro ao resetar: ${error.message}`
            };
        }
    }
};