const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const PoTConfigSystem = require('../../systems/potConfigSystem');
const PoTTokenManager = require('../../integrations/pathoftitans/tokenManager');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');

// Armazenar sessões de reset
const resetSessions = new Map();

module.exports = {
    async execute(interaction, client) {
        const scope = interaction.options.getString('scope');
        const guildId = interaction.guildId;
        const userId = interaction.user.id;

        // ============================================================
        // IMPORTANTE: O AdvancedContainerBuilder JÁ define components V2
        // NÃO podemos usar content com components V2
        // Tudo deve estar DENTRO do container
        // ============================================================

        // Criar botões de confirmação
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`pot_reset_confirm_${guildId}_${userId}_${scope}`)
                .setLabel('✅ Confirmar Reset')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`pot_reset_cancel_${guildId}_${userId}`)
                .setLabel('❌ Cancelar')
                .setStyle(ButtonStyle.Secondary)
        );

        // Criar container com a mensagem de confirmação - TUDO DENTRO DO CONTAINER
        const builder = new AdvancedContainerBuilder({ accentColor: 0xFF4444 });
        builder
            .title('⚠️ CONFIRMAR RESET')
            .text(`Você está prestes a resetar: **${scope}**`)
            .text('Esta ação **NÃO PODE SER DESFEITA**!')
            .separator()
            .text('Clique em **Confirmar Reset** para prosseguir.')
            .footer(interaction.guild.name);

        // Build do container - NÃO adicionar content separado!
        const payload = builder.build();
        
        // Adicionar os botões ao payload (components já está definido)
        payload.components.push(row);

        // Salvar sessão
        resetSessions.set(`${guildId}_${userId}`, { scope, timestamp: Date.now() });

        // Enviar a mensagem com botões
        await interaction.editReply(payload);

        // Aguardar interação com os botões
        const filter = (i) => 
            i.user.id === userId && 
            (i.customId.startsWith(`pot_reset_confirm_${guildId}_${userId}`) || 
             i.customId === `pot_reset_cancel_${guildId}_${userId}`);

        try {
            const buttonInteraction = await interaction.channel.awaitMessageComponent({
                filter,
                time: 120000,
                max: 1
            });

            // Desabilitar os botões imediatamente
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('disabled_confirm')
                    .setLabel('✅ Confirmado')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('disabled_cancel')
                    .setLabel('❌ Cancelado')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );

            if (buttonInteraction.customId === `pot_reset_cancel_${guildId}_${userId}`) {
                // Usuário cancelou
                const cancelBuilder = new AdvancedContainerBuilder({ accentColor: 0xFFA500 });
                cancelBuilder
                    .title('❌ Reset Cancelado')
                    .text('A operação foi cancelada com sucesso.')
                    .footer(interaction.guild.name);

                const cancelPayload = cancelBuilder.build();
                cancelPayload.components = [disabledRow];
                
                await buttonInteraction.update(cancelPayload);
                resetSessions.delete(`${guildId}_${userId}`);
                return;
            }

            // Usuário confirmou - NÃO usar deferUpdate() pois pode causar Unknown Interaction
            // Em vez disso, use update() diretamente
            const scopeValue = buttonInteraction.customId.split('_')[4] || scope;
            const result = await this.executeReset(guildId, scopeValue);

            // Container de resultado
            const resultBuilder = new AdvancedContainerBuilder({ 
                accentColor: result.success ? 0x00FF00 : 0xFF0000 
            });

            resultBuilder
                .title(result.success ? '✅ Reset Concluído' : '❌ Erro no Reset')
                .text(result.message);

            if (result.success) {
                resultBuilder.separator();
                if (scopeValue === 'server') {
                    resultBuilder.text('💡 Use `/potserver setup` para reconfigurar o servidor.');
                } else if (scopeValue === 'logs') {
                    resultBuilder.text('💡 Use `/potserver logs` para recriar os webhooks.');
                } else if (scopeValue === 'all') {
                    resultBuilder.text('💡 Use `/potserver setup` para configurar tudo novamente.');
                }
            }

            resultBuilder.footer(interaction.guild.name);

            const resultPayload = resultBuilder.build();
            resultPayload.components = [disabledRow];

            // Usar update() em vez de editReply() para a resposta do botão
            await buttonInteraction.update(resultPayload);

        } catch (error) {
            if (error.code === 'InteractionCollectorError') {
                // Tempo esgotado - desabilitar botões
                const timeoutBuilder = new AdvancedContainerBuilder({ accentColor: 0xFFA500 });
                timeoutBuilder
                    .title('⏰ Tempo Esgotado')
                    .text('A confirmação expirou. Execute o comando novamente se necessário.')
                    .footer(interaction.guild.name);

                const timeoutPayload = timeoutBuilder.build();
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('disabled_confirm')
                        .setLabel('⏰ Expirado')
                        .setStyle(ButtonStyle.Danger)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('disabled_cancel')
                        .setLabel('⏰ Expirado')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                );
                timeoutPayload.components = [disabledRow];

                await interaction.editReply(timeoutPayload);
            } else {
                console.error('❌ [Reset] Erro:', error);
                // NÃO usar content com components V2 - usar container
                const errorBuilder = new AdvancedContainerBuilder({ accentColor: 0xFF0000 });
                errorBuilder
                    .title('❌ Erro')
                    .text(`Erro ao processar reset: ${error.message}`)
                    .footer(interaction.guild.name);
                
                await interaction.editReply(errorBuilder.build());
            }
        } finally {
            resetSessions.delete(`${guildId}_${userId}`);
        }
    },

    async executeReset(guildId, scope) {
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
