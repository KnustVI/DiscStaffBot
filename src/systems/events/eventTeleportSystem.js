// src/systems/events/eventTeleportSystem.js
/**
 * Botões de teleporte configuráveis na postagem de um evento (/evento) — até
 * 2 por evento (Herbívoro/Carnívoro), cada um levando quem clicar até uma
 * coordenada fixa via RCON (`teleport <nome em jogo> <coordenadas>`). A
 * coordenada é obtida em jogo com `/mapbug` (copia a posição atual pra área
 * de transferência) e colada pelo staff no modal de configuração.
 *
 * Liberado a partir do tier Rastreador (mesma flag `autoRcon` que já libera
 * a ação automática em jogo do /strike e o aviso de evento — ver
 * eventScheduler.js) — o evento sempre tem um Evento Agendado do Discord
 * nesse tier (ver evento.js), e é o STATUS desse evento (Active) que decide
 * se o TP está "disponível agora", não um horário calculado à parte.
 *
 * Fluxo (3 interações separadas, cada uma precisa ser a resposta certa no
 * momento certo — showModal() só funciona como PRIMEIRA resposta):
 *   1. Botão "Adicionar TP"/"Editar TP" (event-tp:config:*) - mensagem
 *      ephemeral explicando o /mapbug + botão "Configurar Coordenadas".
 *   2. Botão "Configurar Coordenadas" (event-tp:config-modal:*) - abre o
 *      modal (especial-caseado em interactionCreate.js, ANTES do
 *      deferUpdate() genérico, que quebraria o showModal()).
 *   3. Modal enviado (event-tp:config-submit:*) - salva no banco e edita a
 *      postagem original, trocando o botão de configuração pelos botões de
 *      TP reais (só os que tiverem coordenada preenchida) + "Editar TP".
 *
 * A postagem original (container montado por evento.js) nunca é
 * reconstruída a partir do zero — cada edição pega o container já existente
 * na mensagem (`message.components[0].toJSON()`, sempre o item [0] porque
 * só existem 2 componentes de topo possíveis: o container e a linha de
 * botões de TP) e troca só a linha de botões ao lado dele.
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, GuildScheduledEventStatus, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../../database/index');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const PremiumSystem = require('../premium/premiumSystem');
const PoTConfigSystem = require('../pot/potConfigSystem');
const PlayerRegistry = require('../pot/potPlayerRegistry');
const ConfigSystem = require('../core/configSystem');
const ResponseManager = require('../../utils/responseManager');

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

const SPECIES = {
    herbivoro: { label: 'Herbívoro', emoji: EMOJIS.Herbivore || '🌿', column: 'herbivore_coords' },
    carnivoro: { label: 'Carnívoro', emoji: EMOJIS.Carnivore || '🦖', column: 'carnivore_coords' },
};

// ==================== BANCO ====================

function getConfig(messageId) {
    return db.prepare(`SELECT * FROM event_teleports WHERE message_id = ?`).get(messageId) || null;
}

function saveConfig({ messageId, guildId, threadId, scheduledEventId, herbivoreCoords, carnivoreCoords, userId }) {
    const now = Date.now();
    db.prepare(`
        INSERT INTO event_teleports (message_id, guild_id, thread_id, scheduled_event_id, herbivore_coords, carnivore_coords, created_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(message_id) DO UPDATE SET
            herbivore_coords = excluded.herbivore_coords,
            carnivore_coords = excluded.carnivore_coords,
            scheduled_event_id = excluded.scheduled_event_id,
            updated_at = excluded.updated_at
    `).run(messageId, guildId, threadId, scheduledEventId || null, herbivoreCoords || null, carnivoreCoords || null, userId, now);
}

function _hasUsed(messageId, userId) {
    return !!db.prepare(`SELECT 1 FROM event_teleport_uses WHERE message_id = ? AND user_id = ?`).get(messageId, userId);
}

// Reserva o uso ANTES de disparar o RCON (evita corrida de clique duplo) —
// se falhar (já usado), devolve false sem tocar em nada. Se o RCON falhar
// depois, quem chamou desfaz com `_releaseUse`.
function _reserveUse(messageId, userId, species) {
    try {
        db.prepare(`INSERT INTO event_teleport_uses (message_id, user_id, species, used_at) VALUES (?, ?, ?, ?)`)
            .run(messageId, userId, species, Date.now());
        return true;
    } catch (err) {
        return false; // UNIQUE(message_id, user_id) já existe
    }
}

function _releaseUse(messageId, userId) {
    db.prepare(`DELETE FROM event_teleport_uses WHERE message_id = ? AND user_id = ?`).run(messageId, userId);
}

// ==================== HELPERS DE UI ====================

function _isEnabled(guildId) {
    return !!PremiumSystem.getGuildLimits(guildId).autoRcon;
}

// Erro ephemeral via followUp — NUNCA via ResponseManager.error()/editReply()
// aqui: todo botão deste sistema já passou por deferUpdate() (ver
// interactionCreate.js, bloco genérico), então "a resposta deferida" É a
// mensagem original da postagem (Components V2). editReply() com
// `content`/`flags` simples nela sempre falha com
// "MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2" (mesmo motivo já
// documentado em handlers.js/handleError). followUp() sempre cria uma
// mensagem ephemeral NOVA, nunca esbarra nisso.
async function _ephemeralError(interaction, message) {
    return await interaction.followUp({ content: message, flags: 64 });
}

function _buildConfigButton(messageId, scheduledEventId, hasConfig) {
    return AdvancedContainerBuilder.secondaryButton(
        `event-tp:config:${messageId}:${scheduledEventId || 'none'}`,
        hasConfig ? 'Editar TP' : 'Adicionar TP',
    ).setEmoji(EMOJIS.mappin || '📍');
}

function _buildLiveRow(messageId, scheduledEventId, config) {
    const buttons = [];
    for (const [key, meta] of Object.entries(SPECIES)) {
        if (config[meta.column]) {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`event-tp:go:${messageId}:${key}`)
                    .setLabel(`TP ${meta.label}`)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(meta.emoji),
            );
        }
    }
    buttons.push(_buildConfigButton(messageId, scheduledEventId, true));
    return buttons;
}

/**
 * Edita a postagem original trocando SÓ a linha de botões ao lado do
 * container (nunca reconstrói o container em si — pega ele já pronto da
 * própria mensagem, ver comentário no topo do arquivo).
 */
async function _updatePostButtons(message, buttons) {
    const containerJSON = message.components[0].toJSON();
    const row = new ActionRowBuilder().setComponents(...buttons);
    await message.edit({ components: [containerJSON, row], flags: MessageFlags.IsComponentsV2 });
}

/**
 * Chamado por evento.js logo após criar a postagem — anexa o botão inicial
 * "Adicionar TP" como uma linha de botões separada, ao lado do container já
 * enviado (não mexe no conteúdo do post em si). Só faz sentido a partir do
 * tier Rastreador (autoRcon) — quem chama já checa isso antes.
 */
async function attachConfigButton(message, scheduledEventId) {
    await _updatePostButtons(message, [_buildConfigButton(message.id, scheduledEventId, false)]);
}

function _explanationBuilder(guildName, config) {
    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
    builder.text(`${EMOJIS.mappin || '📍'} **Configurar Teleporte do Evento**`);
    builder.text(
        `1. Vá até o local desejado **dentro do jogo** (ex: ponto de encontro dos herbívoros).\n` +
        `2. Digite \`/mapbug\` no chat do jogo — isso copia sua posição atual pra área de transferência.\n` +
        `3. Clique em **Configurar Coordenadas** abaixo e cole o resultado exatamente como copiado.`
    );
    builder.text(`${EMOJIS.trianglealert || '⚠️'} Você pode configurar só um dos dois tipos, ou os dois. Deixar em branco remove aquele botão.`);
    builder.separator();
    builder.text(
        `${EMOJIS.circlealert || '🔔'} Os botões de TP só funcionam **enquanto o evento estiver ativo** (depois de alguém do staff iniciar o evento no Discord), ` +
        `e cada jogador só pode usar **uma vez por evento** (herbívoro ou carnívoro, não os dois).`
    );
    if (config?.herbivore_coords || config?.carnivore_coords) {
        builder.separator();
        builder.text(`${EMOJIS.clipboardlist || '📋'} **Configuração atual:**`);
        if (config.herbivore_coords) builder.text(`${EMOJIS.Herbivore || '🌿'} Herbívoro: \`${config.herbivore_coords}\``);
        if (config.carnivore_coords) builder.text(`${EMOJIS.Carnivore || '🦖'} Carnívoro: \`${config.carnivore_coords}\``);
    }
    builder.footer(guildName);
    return builder;
}

// ==================== INTERAÇÕES ====================

module.exports = {
    attachConfigButton,

    /**
     * Roteador genérico do sistema "event-tp" (ver InteractionHandler.
     * handleComponent) — duas ações passam por aqui, ambas SEM modal (só
     * "config-modal" abre modal, e esse é especial-caseado direto em
     * interactionCreate.js, nunca passa por este método):
     *   - "config": botão "Adicionar TP"/"Editar TP" -> explicação ephemeral.
     *   - "go": botão de TP real, visível a qualquer jogador na postagem.
     */
    async handleComponent(interaction, action, param) {
        if (action === 'go') {
            const [messageId, species] = String(param).split(':');
            return await this.handleGo(interaction, messageId, species);
        }

        if (action !== 'config') {
            return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Ação desconhecida.`);
        }

        const [messageId, scheduledEventId] = String(param).split(':');
        const { guild, member } = interaction;

        if (!ConfigSystem.memberHasConfiguredRole(guild.id, member, 'event_role')) {
            return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Só a Equipe de Eventos pode configurar o teleporte.`);
        }
        if (!_isEnabled(guild.id)) {
            return await _ephemeralError(interaction, PremiumSystem.getGuildDenialMessage(guild.id));
        }

        const config = getConfig(messageId);
        const builder = _explanationBuilder(guild.name, config);
        builder.buttons(
            AdvancedContainerBuilder.primaryButton(`event-tp:config-modal:${messageId}:${scheduledEventId}`, 'Configurar Coordenadas')
                .setEmoji(EMOJIS.edit || '✏️'),
        );

        const payload = builder.build();
        await interaction.followUp({ ...payload, flags: payload.flags | 64 });
    },

    /**
     * event-tp:config-modal:<messageId>:<scheduledEventId> — abre o modal.
     * Chamado direto de interactionCreate.js (ANTES do deferUpdate()
     * genérico), nunca passa pelo handleComponent acima.
     */
    async handleOpenConfigModal(interaction) {
        const [, , messageId, scheduledEventId] = interaction.customId.split(':');
        const { guild, member } = interaction;

        if (!ConfigSystem.memberHasConfiguredRole(guild.id, member, 'event_role')) {
            return await interaction.reply({ content: `${EMOJIS.circlealert || '❌'} Só a Equipe de Eventos pode configurar o teleporte.`, flags: 64 });
        }
        if (!_isEnabled(guild.id)) {
            return await interaction.reply({ content: PremiumSystem.getGuildDenialMessage(guild.id), flags: 64 });
        }

        const config = getConfig(messageId);

        const modal = new ModalBuilder()
            .setCustomId(`event-tp:config-submit:${messageId}:${scheduledEventId}`)
            .setTitle('Configurar Teleporte do Evento')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('herbivoro')
                        .setLabel('Coordenada Herbívoro (opcional)')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Cole aqui o resultado de /mapbug')
                        .setMaxLength(150)
                        .setRequired(false)
                        .setValue(config?.herbivore_coords || ''),
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('carnivoro')
                        .setLabel('Coordenada Carnívoro (opcional)')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Cole aqui o resultado de /mapbug')
                        .setMaxLength(150)
                        .setRequired(false)
                        .setValue(config?.carnivore_coords || ''),
                ),
            );

        await interaction.showModal(modal);
    },

    /**
     * event-tp:config-submit:<messageId>:<scheduledEventId> — modal
     * enviado. Vai pelo roteamento genérico de modal (já veio deferReply
     * ephemeral do interactionCreate.js).
     */
    async handleModal(interaction, action) {
        if (action !== 'config-submit') {
            return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Modal desconhecido.`);
        }

        const [, , messageId, scheduledEventId] = interaction.customId.split(':');
        const { guild, member, user } = interaction;

        if (!ConfigSystem.memberHasConfiguredRole(guild.id, member, 'event_role')) {
            return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Só a Equipe de Eventos pode configurar o teleporte.`);
        }
        if (!_isEnabled(guild.id)) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guild.id));
        }

        const herbivoreCoords = interaction.fields.getTextInputValue('herbivoro').trim();
        const carnivoreCoords = interaction.fields.getTextInputValue('carnivoro').trim();

        if (!herbivoreCoords && !carnivoreCoords) {
            return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Preencha pelo menos uma das duas coordenadas.`);
        }

        saveConfig({
            messageId,
            guildId: guild.id,
            threadId: interaction.channelId,
            scheduledEventId: scheduledEventId !== 'none' ? scheduledEventId : null,
            herbivoreCoords: herbivoreCoords || null,
            carnivoreCoords: carnivoreCoords || null,
            userId: user.id,
        });

        const config = getConfig(messageId);

        try {
            const message = await interaction.channel.messages.fetch(messageId);
            await _updatePostButtons(message, _buildLiveRow(messageId, scheduledEventId, config));
        } catch (err) {
            console.error('❌ [EventTeleport] Erro ao atualizar botões da postagem:', err.message);
            return await ResponseManager.error(interaction, `${EMOJIS.circlealert || '❌'} Coordenadas salvas, mas não consegui atualizar os botões na postagem (${err.message}). Tente de novo em instantes.`);
        }

        const summary = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });
        summary.text(`${EMOJIS.circlecheck || '✅'} **Teleporte configurado!**`);
        if (config.herbivore_coords) summary.text(`${EMOJIS.Herbivore || '🌿'} Herbívoro: \`${config.herbivore_coords}\``);
        if (config.carnivore_coords) summary.text(`${EMOJIS.Carnivore || '🦖'} Carnívoro: \`${config.carnivore_coords}\``);
        summary.footer(guild.name);
        await interaction.editReply(summary.build());
    },

    /**
     * event-tp:go:<messageId>:<species> — botão de TP visível a qualquer
     * jogador na postagem. Já veio com deferUpdate() do roteamento
     * genérico, então a resposta é sempre um followUp ephemeral.
     */
    async handleGo(interaction, messageId, species) {
        const { guild, user } = interaction;
        const meta = SPECIES[species];
        if (!meta) {
            return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Tipo de teleporte desconhecido.`);
        }

        const config = getConfig(messageId);
        const coords = config?.[meta.column];
        if (!coords) {
            return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Esse teleporte não está mais configurado.`);
        }

        // ── Só durante o evento: status Active do Evento Agendado do
        // Discord associado a essa postagem (não um horário calculado à
        // parte — ver comentário no topo do arquivo). ──────────────────────
        let active = false;
        if (config.scheduled_event_id) {
            try {
                const scheduledEvent = await guild.scheduledEvents.fetch(config.scheduled_event_id);
                active = scheduledEvent?.status === GuildScheduledEventStatus.Active;
            } catch (err) {
                active = false; // evento removido/não encontrado
            }
        }
        if (!active) {
            return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Esse teleporte só funciona **enquanto o evento estiver acontecendo**.`);
        }

        if (_hasUsed(messageId, user.id)) {
            return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Você já usou seu teleporte neste evento.`);
        }

        const link = PlayerRegistry.getPlayerByDiscordId(user.id);
        if (!link?.alderon_id) {
            return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Você precisa vincular sua conta com \`/registrar\` antes de usar o teleporte.`);
        }
        const onlinePlayer = PlayerRegistry.getOnlinePotPlayer(guild.id, link.alderon_id);
        if (!onlinePlayer) {
            return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Você precisa estar **online no jogo agora** pra usar o teleporte.`);
        }

        if (!_reserveUse(messageId, user.id, species)) {
            return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Você já usou seu teleporte neste evento.`);
        }

        // Alvo pelo NOME em jogo, não pelo Alderon ID — mesmo padrão
        // confirmado em whisper/systemmessage (ver rconCommandCatalog.js);
        // nunca testado especificamente pra `teleport`, mas é o
        // comportamento mais consistente com o resto do catálogo até
        // alguém confirmar o contrário num servidor real.
        const targetName = onlinePlayer.player_name || link.player_name;
        const command = `teleport ${targetName} ${coords}`;
        const rconResult = await PoTConfigSystem.executeRconCommand(guild.id, command).catch((err) => ({ success: false, error: err.message }));

        if (!rconResult?.success) {
            _releaseUse(messageId, user.id);
            return await _ephemeralError(interaction, `${EMOJIS.circlealert || '❌'} Não foi possível teleportar agora (${rconResult?.error || 'erro desconhecido'}). Tente de novo.`);
        }

        db.logActivity(guild.id, user.id, 'event_teleport', null, { messageId, species, command });

        await interaction.followUp({ content: `${EMOJIS.circlecheck || '✅'} Teleportado para **${meta.label}**! Bom evento!`, flags: 64 });
    },

    getConfig,
};
