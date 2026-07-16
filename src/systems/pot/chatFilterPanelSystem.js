// src/systems/pot/chatFilterPanelSystem.js
/**
 * Painel /config filtro — cria/apaga palavras filtradas do chat em jogo,
 * cada uma ligada a um nível de punição customizado (mesmo catálogo do
 * /strike, ver punishmentLevels.js). Estrutura de telas dentro de UM
 * painel ephemeral só, trocado em lugar — mesmo padrão de config-buffs:
 *
 *   list        -> lista de palavras filtradas + botão "Adicionar Palavra"
 *   pick-level  -> select com os níveis de punição configurados do
 *                  servidor, mostrado depois do modal que pede a palavra
 *
 * Diferente de config-buffs (que tem uma tela "edit" intermediária por
 * buff, já que um buff tem VÁRIOS atributos), aqui cada palavra é uma
 * linha só na lista — não precisa de tela própria por palavra.
 *
 * O modal que pede a palavra precisa ser especial-caseado em
 * interactionCreate.js (ANTES do deferUpdate() genérico), mesmo motivo de
 * sempre: showModal() só funciona como PRIMEIRA resposta a uma interação.
 * A palavra staged fica em SessionManager (mesmo padrão de strike_staging)
 * até o staff escolher o nível no select seguinte.
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const PremiumSystem = require('../premium/premiumSystem');
const PunishmentSystem = require('../moderation/punishmentSystem');
const PunishmentLevels = require('../moderation/punishmentLevels');
const ChatFilterSystem = require('./chatFilterSystem');
const SessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

const STAGING_CATEGORY = 'filter_staging';

// Exclusivo do Caçador (pedido do dono) — mesma flag já usada pelo
// catálogo manual/buffs.
function _isEnabled(guildId) {
    return !!PremiumSystem.getGuildLimits(guildId).genericRconEnabled;
}

// Mesmo critério de acesso de config-buffs — criar/editar é restrito ao
// cargo Supervisor, mais estreito que só Administrator do Discord.
async function _isSupervisor(interaction) {
    return await PunishmentSystem.memberHasSupervisorRole(interaction.guild, interaction.member);
}

const SUPERVISOR_ONLY_MESSAGE = 'Este comando é restrito ao cargo Supervisor (ver /config roles).';

async function _ephemeralError(interaction, message) {
    return await interaction.followUp({ content: message, flags: 64 });
}

// ==================== TELAS ====================

function _renderList(cb, guildId) {
    const filters = ChatFilterSystem.getFilters(guildId);
    cb.section(
        [
            '# FILTRO DE PALAVRAS (CHAT EM JOGO)',
            'Palavras que, ao serem escritas no chat Global ou de Grupo, aplicam automaticamente o nível de punição escolhido.',
            `**Palavras filtradas:** \`${filters.length}\``,
        ].join('\n'),
        cb.assetThumbnail('icone_config') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png'),
    );
    cb.separator();

    if (filters.length === 0) {
        cb.text(`${EMOJIS.messagesquare || 'ℹ️'} Nenhuma palavra filtrada ainda. Use o botão **Adicionar Palavra** abaixo.`);
    } else {
        for (const filter of filters) {
            const level = PunishmentLevels.getLevel(guildId, filter.level_id);
            const levelLabel = level ? `${level.name} (${level.severity})` : `${EMOJIS.trianglealert || '⚠️'} nível #${filter.level_id} não existe mais`;
            cb.section(
                `**"${filter.word}"**\n${EMOJIS.gavel || '⚖️'} ${levelLabel}`,
                AdvancedContainerBuilder.dangerButton(`config-filtro:remove:${filter.id}`, 'Remover'),
            );
        }
    }
}

function _renderPickLevel(cb, guildId, word) {
    cb.text(`${EMOJIS.messagesquare || 'ℹ️'} Palavra: **"${word}"** — escolha o nível de punição que ela deve aplicar:`);
    const levels = PunishmentLevels.getLevels(guildId);
    const select = new StringSelectMenuBuilder()
        .setCustomId('config-filtro:level-select')
        .setPlaceholder('Selecionar nível de punição')
        .addOptions(levels.map((level) => new StringSelectMenuOptionBuilder()
            .setLabel(level.name)
            .setDescription(`${level.severity} | -${level.points} pts | ${level.duration_str || 'Permanente'}`)
            .setValue(String(level.id))));
    cb.selectMenu(select);
}

/**
 * Redesenha o painel inteiro na tela pedida — mesmo padrão de
 * refreshBuffPanel: SEMPRE o mesmo container, sem `content`, mensagem de
 * sucesso separada via followUp ephemeral.
 */
async function refreshFilterPanel(interaction, successMessage, guildName, view) {
    const guildId = interaction.guildId;
    const cb = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
    const bottomRows = [];

    if (view.screen === 'pick-level') {
        _renderPickLevel(cb, guildId, view.word);
        bottomRows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('config-filtro:back-list').setLabel('Cancelar').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.circlealert || '❌'),
        ));
    } else {
        _renderList(cb, guildId);
        bottomRows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('config-filtro:create:modal').setLabel('Adicionar Palavra').setStyle(ButtonStyle.Success).setEmoji(EMOJIS.add || '➕'),
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

// ==================== INTERAÇÕES ====================

module.exports = {
    refreshFilterPanel,

    /**
     * Roteador genérico do sistema "config-filtro" — tudo que NÃO abre
     * modal passa por aqui (ver InteractionHandler.handleComponent).
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
            case 'back-list':
                SessionManager.delete(interaction.user.id, guildId, STAGING_CATEGORY, STAGING_CATEGORY);
                return await refreshFilterPanel(interaction, null, guildName, { screen: 'list' });

            case 'remove': {
                const removed = ChatFilterSystem.removeFilter(guildId, param);
                if (!removed) {
                    return await refreshFilterPanel(interaction, `${EMOJIS.messagesquare || 'ℹ️'} Esta palavra já não está mais filtrada.`, guildName, { screen: 'list' });
                }
                return await refreshFilterPanel(interaction, `${EMOJIS.circlecheck || '✅'} Palavra **"${removed.word}"** removida do filtro.`, guildName, { screen: 'list' });
            }

            case 'level-select': {
                const staging = SessionManager.get(interaction.user.id, guildId, STAGING_CATEGORY, STAGING_CATEGORY);
                if (!staging) {
                    return await refreshFilterPanel(interaction, `${EMOJIS.circlealert || '❌'} Sessão expirada — clique em **Adicionar Palavra** de novo.`, guildName, { screen: 'list' });
                }
                const levelId = interaction.values?.[0];
                const level = PunishmentLevels.getLevel(guildId, levelId);
                if (!level) {
                    return await refreshFilterPanel(interaction, `${EMOJIS.circlealert || '❌'} Este nível não existe mais.`, guildName, { screen: 'pick-level', word: staging.word });
                }
                SessionManager.delete(interaction.user.id, guildId, STAGING_CATEGORY, STAGING_CATEGORY);
                const { isNew, filter } = ChatFilterSystem.addFilter(guildId, staging.word, level.id, interaction.user.id);
                const verb = isNew ? 'adicionada ao' : 'atualizada no';
                return await refreshFilterPanel(interaction, `${EMOJIS.circlecheck || '✅'} Palavra **"${filter.word}"** ${verb} filtro — nível **${level.name}**.`, guildName, { screen: 'list' });
            }

            default:
                return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Ação desconhecida.`);
        }
    },

    /**
     * config-filtro:create:modal — botão "Adicionar Palavra". Especial-
     * caseado em interactionCreate.js (ANTES do deferUpdate() genérico).
     */
    async handleOpenCreateModal(interaction) {
        if (!_isEnabled(interaction.guildId)) {
            return await interaction.reply({ content: PremiumSystem.getGuildDenialMessage(interaction.guildId), flags: 64 });
        }
        if (!(await _isSupervisor(interaction))) {
            return await interaction.reply({ content: SUPERVISOR_ONLY_MESSAGE, flags: 64 });
        }
        if (PunishmentLevels.getLevels(interaction.guildId).length === 0) {
            return await interaction.reply({ content: `${EMOJIS.circlealert || '❌'} Nenhum nível de punição configurado ainda — crie um em \`/config punishments\` primeiro.`, flags: 64 });
        }

        const modal = new ModalBuilder()
            .setCustomId('config-filtro:create-submit')
            .setTitle('Adicionar Palavra ao Filtro')
            .addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('word')
                    .setLabel('Palavra ou frase a filtrar')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ex: palavrão')
                    .setMaxLength(100)
                    .setRequired(true),
            ));
        await interaction.showModal(modal);
    },

    /**
     * Roteador genérico de modal do sistema "config-filtro" (ver
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
            const word = interaction.fields.getTextInputValue('word').trim();
            if (!word) {
                return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Informe uma palavra ou frase.`);
            }
            if (PunishmentLevels.getLevels(guildId).length === 0) {
                return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Nenhum nível de punição configurado ainda — crie um em \`/config punishments\` primeiro.`);
            }
            SessionManager.set(interaction.user.id, guildId, STAGING_CATEGORY, STAGING_CATEGORY, { word }, 120000);
            return await refreshFilterPanel(interaction, null, guildName, { screen: 'pick-level', word });
        }

        return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Modal desconhecido.`);
    },
};
