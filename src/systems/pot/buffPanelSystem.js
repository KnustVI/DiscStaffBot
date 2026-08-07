// src/systems/pot/buffPanelSystem.js
/**
 * Painel /config buffs — cria/edita/apaga buffs (presets de `setattr` em
 * lote), "parecido com os níveis de punição" (pedido do dono), exclusivo do
 * plano Caçador (mesma flag `genericRconEnabled` do resto do catálogo RCON
 * manual — /ingame-*). Estrutura de telas dentro de UM painel ephemeral só,
 * trocado em lugar (`interaction.update()`/`editReply()`), mesmo padrão de
 * config-punishments (níveis) e config-roles:
 *
 *   list             -> lista de buffs + botão "Criar Buff"
 *   edit(buffId)      -> atributos do buff + botões Adicionar/Excluir/Voltar
 *   pick-attribute    -> select com os atributos confirmados (KNOWN_STATS,
 *                        ver buffStatCatalog.js) — bem abaixo do limite de
 *                        25 de um select só, sem precisar de um passo de
 *                        categoria antes (existiu antes, removido quando a
 *                        lista de ~59 atributos "de documentação" foi
 *                        substituída pelos confirmados por teste real).
 *
 * Escolher um atributo abre um MODAL pedindo o valor — precisa ser
 * especial-caseado em interactionCreate.js (ANTES do deferUpdate()
 * genérico), mesmo motivo de sempre: showModal() só funciona como PRIMEIRA
 * resposta a uma interação.
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const PremiumSystem = require('../premium/premiumSystem');
const PunishmentSystem = require('../moderation/punishmentSystem');
const BuffSystem = require('./buffSystem');
const BuffStatCatalog = require('./buffStatCatalog');
const ResponseManager = require('../../utils/responseManager');

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

function _isEnabled(guildId) {
    return !!PremiumSystem.getGuildLimits(guildId).genericRconEnabled;
}

// Criar/editar buff é restrito ao cargo Supervisor (pedido do dono) —
// diferente de aplicar um buff (/ingame-buff aplicar), liberado pra
// qualquer cargo de staff (ver ConfigSystem.memberHasAnyStaffRole lá).
async function _isSupervisor(interaction) {
    return await PunishmentSystem.memberHasSupervisorRole(interaction.guild, interaction.member);
}

const SUPERVISOR_ONLY_MESSAGE = 'Este comando é restrito ao cargo Supervisor (ver /config roles).';

async function _ephemeralError(interaction, message) {
    return await interaction.followUp({ content: message, flags: 64 });
}

// ==================== TELAS ====================

function _renderList(cb, guildId) {
    const buffs = BuffSystem.getBuffs(guildId);
    cb.section(
        [
            '# BUFFS CONFIGURÁVEIS',
            'Crie presets de atributos (RCON `setattr`) pra aplicar num jogador com um comando só (`/ingame-buff aplicar`).',
            `**Buffs criados:** \`${buffs.length}\``,
        ].join('\n'),
        cb.assetThumbnail('icone_config') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png'),
    );
    cb.separator();

    if (buffs.length === 0) {
        cb.text(`${EMOJIS.messagesquare || 'ℹ️'} Nenhum buff criado ainda. Use o botão **Criar Buff** abaixo.`);
    } else {
        // Mesmo teto de segurança contra COMPONENT_MAX_TOTAL_COMPONENTS_
        // EXCEEDED já corrigido em configSystem.js refreshPointsPanel (ver
        // PREMIUM.txt pra o caso real que motivou aquela correção) — este
        // painel não tem NENHUM limite de quantos buffs um guild pode criar
        // (diferente de níveis de punição, que têm um teto por tier), então
        // era só questão de tempo até alguém criar buffs o bastante pra
        // quebrar aqui também. Cada buff custa 3 componentes (Section+
        // texto+botão); o resto do painel (cabeçalho/separador/rodapé/botão
        // Criar Buff) usa uns 7 — 8 buffs visíveis fica com boa margem.
        const BUFF_LIST_SAFE_LIMIT = 8;
        const visibleBuffs = buffs.slice(0, BUFF_LIST_SAFE_LIMIT);
        const hiddenBuffs = buffs.slice(BUFF_LIST_SAFE_LIMIT);

        for (const buff of visibleBuffs) {
            const stats = BuffSystem.getBuffStats(buff.id);
            cb.section(
                `**${buff.name}**\n${EMOJIS.gauge || '📊'} ${stats.length} atributo(s) configurado(s)`,
                AdvancedContainerBuilder.secondaryButton(`config-buffs:view:${buff.id}`, 'Ver/Editar'),
            );
        }

        if (hiddenBuffs.length > 0) {
            cb.separator();
            const hiddenNames = hiddenBuffs.map(b => `**${b.name}**`).join(', ');
            cb.text(`${EMOJIS.messagesquare || 'ℹ️'} +${hiddenBuffs.length} buff(s) não exibido(s) aqui por limite técnico do Discord (${hiddenNames}). Apague ou renomeie algum dos exibidos acima pra liberar espaço na lista.`);
        }
    }
}

function _renderEdit(cb, guildId, buffId) {
    const buff = BuffSystem.getBuff(guildId, buffId);
    if (!buff) {
        cb.text(`${EMOJIS.circlealert || '❌'} Este buff não existe mais.`);
        return null;
    }

    const stats = BuffSystem.getBuffStats(buffId);
    cb.section(
        [`# BUFF: ${buff.name}`, `${stats.length} atributo(s) configurado(s).`].join('\n'),
        cb.assetThumbnail('icone_config') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png'),
    );
    cb.separator();

    if (stats.length === 0) {
        cb.text(`${EMOJIS.messagesquare || 'ℹ️'} Nenhum atributo adicionado ainda. Use o botão **Adicionar Atributo** abaixo.`);
    } else {
        // Mesmo teto de segurança de _renderList acima — um buff pode ter
        // até 17 atributos (ver BuffStatCatalog.KNOWN_STATS), e a 3
        // componentes cada, 17 sozinho já passa dos 40 (sem nem contar o
        // resto do painel). 8 atributos visíveis fica com boa margem.
        const STAT_LIST_SAFE_LIMIT = 8;
        const visibleStats = stats.slice(0, STAT_LIST_SAFE_LIMIT);
        const hiddenStats = stats.slice(STAT_LIST_SAFE_LIMIT);

        for (const stat of visibleStats) {
            cb.section(
                `**${stat.attribute}**: \`${stat.value}\``,
                AdvancedContainerBuilder.dangerButton(`config-buffs:remove-stat:${buffId}:${stat.attribute}`, 'Remover'),
            );
        }

        if (hiddenStats.length > 0) {
            cb.separator();
            const hiddenNames = hiddenStats.map(s => `**${s.attribute}**`).join(', ');
            cb.text(`${EMOJIS.messagesquare || 'ℹ️'} +${hiddenStats.length} atributo(s) não exibido(s) aqui por limite técnico do Discord (${hiddenNames}). Remova algum dos exibidos acima pra liberar espaço na lista.`);
        }
    }

    return buff;
}

function _renderPickAttribute(cb, buffId) {
    cb.text(`${EMOJIS.messagesquare || 'ℹ️'} Escolha o atributo que você quer adicionar:`);
    const select = new StringSelectMenuBuilder()
        .setCustomId(`config-buffs:attr-select:${buffId}`)
        .setPlaceholder('Selecionar atributo')
        .addOptions(BuffStatCatalog.KNOWN_STATS.map((s) => ({ label: s, value: s })));
    cb.selectMenu(select);
}

/**
 * Redesenha o painel inteiro na tela pedida — mesmo padrão de
 * refreshPointsPanel/refreshRolesPanel (configSystem.js): SEMPRE o mesmo
 * container, sem `content`, mensagem de sucesso separada via followUp
 * ephemeral.
 */
async function refreshBuffPanel(interaction, successMessage, guildName, view) {
    const guildId = interaction.guildId;
    const cb = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
    const bottomRows = [];

    if (view.screen === 'edit') {
        const buff = _renderEdit(cb, guildId, view.buffId);
        if (buff) {
            bottomRows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`config-buffs:add-stat:${view.buffId}`).setLabel('Adicionar Atributo').setStyle(ButtonStyle.Success).setEmoji(EMOJIS.add || '➕'),
                new ButtonBuilder().setCustomId(`config-buffs:delete:${view.buffId}`).setLabel('Excluir Buff').setStyle(ButtonStyle.Danger).setEmoji(EMOJIS.trash || '🗑️'),
            ));
        }
        bottomRows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('config-buffs:back-list').setLabel('Voltar à Lista').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.arrowleft || '⬅️'),
        ));
    } else if (view.screen === 'pick-attribute') {
        _renderPickAttribute(cb, view.buffId);
        bottomRows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`config-buffs:back-edit:${view.buffId}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.circlealert || '❌'),
        ));
    } else {
        _renderList(cb, guildId);
        bottomRows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('config-buffs:create:modal').setLabel('Criar Buff').setStyle(ButtonStyle.Success).setEmoji(EMOJIS.add || '➕'),
        ));
    }

    cb.footer(guildName);
    const { components, flags, files } = cb.build();
    const replyData = { components: [...components, ...bottomRows], flags, files };

    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(replyData);
    } else {
        await interaction.update(replyData);
    }

    if (successMessage) {
        try {
            await interaction.followUp({ content: successMessage, flags: 64 });
        } catch (err) {
            // feedback é best-effort, nunca deve travar o painel
        }
    }
}

/**
 * Tela de confirmação de exclusão — mesmo padrão de handleDeleteLevelButton
 * (configSystem.js): container próprio, não passa por refreshBuffPanel.
 */
async function _renderDeleteConfirm(interaction, guildName, buff) {
    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });
    builder.section(
        [
            '# EXCLUIR BUFF',
            `Tem certeza que deseja excluir o buff **${buff.name}**? Esta ação não pode ser desfeita.`,
        ].join('\n'),
        builder.assetThumbnail('icone_config') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png'),
    );
    builder.footer(guildName);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`config-buffs:delete-confirm:${buff.id}`).setLabel('Confirmar Exclusão').setStyle(ButtonStyle.Danger).setEmoji(EMOJIS.circlecheck || '✅'),
        new ButtonBuilder().setCustomId(`config-buffs:delete-cancel:${buff.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.circlealert || '❌'),
    );

    const { components, flags } = builder.build();
    const replyData = { components: [...components, row], flags };
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(replyData);
    } else {
        await interaction.update(replyData);
    }
}

// ==================== INTERAÇÕES ====================

module.exports = {
    refreshBuffPanel,

    /**
     * Roteador genérico do sistema "config-buffs" — tudo que NÃO abre modal
     * passa por aqui (ver InteractionHandler.handleComponent).
     */
    async handleComponent(interaction, action, param) {
        const guildId = interaction.guildId;
        const guildName = interaction.guild.name;

        if (!_isEnabled(guildId)) {
            return await _ephemeralError(interaction, PremiumSystem.getGuildDenialMessage(guildId));
        }
        if (!(await _isSupervisor(interaction))) {
            return await _ephemeralError(interaction, SUPERVISOR_ONLY_MESSAGE);
        }

        switch (action) {
            case 'view':
                return await refreshBuffPanel(interaction, null, guildName, { screen: 'edit', buffId: param });

            case 'back-list':
                return await refreshBuffPanel(interaction, null, guildName, { screen: 'list' });

            case 'back-edit':
                return await refreshBuffPanel(interaction, null, guildName, { screen: 'edit', buffId: param });

            case 'add-stat':
                return await refreshBuffPanel(interaction, null, guildName, { screen: 'pick-attribute', buffId: param });

            case 'remove-stat': {
                const [buffId, attribute] = String(param).split(':');
                BuffSystem.removeBuffStat(buffId, attribute);
                return await refreshBuffPanel(interaction, `${EMOJIS.circlecheck || '✅'} Atributo **${attribute}** removido.`, guildName, { screen: 'edit', buffId });
            }

            case 'delete': {
                const buff = BuffSystem.getBuff(guildId, param);
                if (!buff) {
                    return await refreshBuffPanel(interaction, `${EMOJIS.messagesquare || 'ℹ️'} Este buff já não existe mais.`, guildName, { screen: 'list' });
                }
                return await _renderDeleteConfirm(interaction, guildName, buff);
            }

            case 'delete-confirm': {
                const deleted = BuffSystem.deleteBuff(guildId, param);
                if (!deleted) {
                    return await refreshBuffPanel(interaction, `${EMOJIS.messagesquare || 'ℹ️'} Este buff já não existe mais.`, guildName, { screen: 'list' });
                }
                return await refreshBuffPanel(interaction, `${EMOJIS.circlecheck || '✅'} Buff **${deleted.name}** excluído.`, guildName, { screen: 'list' });
            }

            case 'delete-cancel':
                return await refreshBuffPanel(interaction, null, guildName, { screen: 'edit', buffId: param });

            default:
                return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Ação desconhecida.`);
        }
    },

    /**
     * config-buffs:create:modal — botão "Criar Buff". Especial-caseado em
     * interactionCreate.js (ANTES do deferUpdate() genérico).
     */
    async handleOpenCreateModal(interaction) {
        if (!_isEnabled(interaction.guildId)) {
            return await interaction.reply({ content: PremiumSystem.getGuildDenialMessage(interaction.guildId), flags: 64 });
        }
        if (!(await _isSupervisor(interaction))) {
            return await interaction.reply({ content: SUPERVISOR_ONLY_MESSAGE, flags: 64 });
        }

        const modal = new ModalBuilder()
            .setCustomId('config-buffs:create-submit')
            .setTitle('Criar Buff')
            .addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('name')
                    .setLabel('Nome do buff')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ex: Buff de Evento')
                    .setMaxLength(100)
                    .setRequired(true),
            ));
        await interaction.showModal(modal);
    },

    /**
     * config-buffs:attr-select:<buffId> — select de atributo. Especial-
     * caseado em interactionCreate.js: escolher um atributo abre o modal
     * pedindo o valor, e select/botão que abre modal precisa ser a
     * PRIMEIRA resposta (nunca passa pelo deferUpdate() genérico).
     */
    async handleOpenStatValueModal(interaction) {
        const [, , buffId] = interaction.customId.split(':');
        if (!_isEnabled(interaction.guildId)) {
            return await interaction.reply({ content: PremiumSystem.getGuildDenialMessage(interaction.guildId), flags: 64 });
        }
        if (!(await _isSupervisor(interaction))) {
            return await interaction.reply({ content: SUPERVISOR_ONLY_MESSAGE, flags: 64 });
        }

        const attribute = interaction.values?.[0];
        if (!attribute) {
            return await interaction.reply({ content: `${EMOJIS.circlealert || '❌'} Nenhum atributo selecionado.`, flags: 64 });
        }

        const modal = new ModalBuilder()
            .setCustomId(`config-buffs:stat-value-submit:${buffId}:${attribute}`)
            .setTitle(`Valor: ${attribute}`.slice(0, 45))
            .addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('value')
                    .setLabel(`Valor de ${attribute}`.slice(0, 45))
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ex: 500 ou 1.5')
                    .setMaxLength(50)
                    .setRequired(true),
            ));
        await interaction.showModal(modal);
    },

    /**
     * Roteador genérico de modal do sistema "config-buffs" (ver
     * InteractionHandler.handleModal) — já veio deferReply ephemeral do
     * interactionCreate.js.
     */
    async handleModal(interaction, action) {
        const guildId = interaction.guildId;
        const guildName = interaction.guild.name;

        if (!_isEnabled(guildId)) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guildId));
        }
        if (!(await _isSupervisor(interaction))) {
            return await ResponseManager.error(interaction, SUPERVISOR_ONLY_MESSAGE);
        }

        if (action === 'create-submit') {
            const name = interaction.fields.getTextInputValue('name').trim();
            if (!name) {
                return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Informe um nome pro buff.`);
            }
            const buff = BuffSystem.createBuff(guildId, name, interaction.user.id);
            return await refreshBuffPanel(interaction, `${EMOJIS.circlecheck || '✅'} Buff **${buff.name}** criado! Adicione os atributos abaixo.`, guildName, { screen: 'edit', buffId: buff.id });
        }

        if (action === 'stat-value-submit') {
            const [, , buffId, attribute] = interaction.customId.split(':');
            const value = interaction.fields.getTextInputValue('value').trim();
            if (!value) {
                return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Informe um valor pro atributo.`);
            }
            BuffSystem.upsertBuffStat(buffId, attribute, value);
            return await refreshBuffPanel(interaction, `${EMOJIS.circlecheck || '✅'} **${attribute}** definido como \`${value}\`.`, guildName, { screen: 'edit', buffId });
        }

        return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Modal desconhecido.`);
    },
};
