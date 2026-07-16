// src/systems/pot/playerRegistrationSystem.js

/**
 * playerRegistrationSystem.js
 *
 * Vínculo MANUAL de conta via painel + modal (comando /registrar) — liga o
 * Discord do usuário à conta dele no Path of Titans (Alderon ID). Complementa
 * o vínculo automático por webhook (ver potPlayerRegistry.js), que acontece
 * sozinho quando o jogador já conectou o Discord pelo site oficial da
 * Alderon Games e entra em qualquer servidor com o bot configurado — essa é
 * a forma mais segura, já que a própria Alderon confirma a titularidade da
 * conta. O cadastro manual aqui é o caminho alternativo pra quem ainda não
 * fez esse link oficial.
 *
 * Campos obrigatórios no vínculo:
 *  - Discord: username/ID — sempre o de quem executa o comando, nunca
 *    perguntado (não faz sentido vincular em nome de outra pessoa aqui).
 *  - Path of Titans: nome de exibição no jogo + Alderon ID (AGID) — pedidos
 *    via modal, únicos dados que o usuário realmente precisa digitar.
 *
 * Verificação em jogo (RCON): ainda NÃO ativada — ver o bloco correspondente
 * em potPlayerRegistry.js. Por enquanto o vínculo manual aceita o Alderon ID
 * informado sem confirmar no jogo, e o painel deixa isso claro.
 */

const path = require('path');
const fs = require('fs');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    AttachmentBuilder,
} = require('discord.js');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const PlayerRegistry = require('./potPlayerRegistry');
const PoTConfigSystem = require('./potConfigSystem');
const sessionManager = require('../../utils/sessionManager');
const imageManager = require('../../utils/imageManager');
const { buildIdentityBlock } = require('../../utils/userIdentity');
const { renderProfileCard } = require('../../utils/profileCardRenderer');
const PunishmentSystem = require('../moderation/punishmentSystem');

const DEFAULT_CARD_PHOTOS = {
    free: path.join(__dirname, '..', '..', '..', 'assets', 'images', 'FOTO PERFIL FREE.webp'),
    compy: path.join(__dirname, '..', '..', '..', 'assets', 'images', 'FOTO PERFIL COMPY.webp'),
    raptor: path.join(__dirname, '..', '..', '..', 'assets', 'images', 'FOTO PERFIL RAPTOR.webp'),
};

// Cor do container do /perfil por tier — mesma paleta da marca usada no
// card em si (Light/Mostarda/Terracota).
const TIER_ACCENT_COLORS = {
    free: 0xF8DCC0,
    compy: 0xDCA15E,
    raptor: 0x803E30,
};

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

const ALDERON_ID_REGEX = /^\d{3}-\d{3}-\d{3}$/;

function formatPlaytime(totalSeconds) {
    const seconds = Number(totalSeconds) || 0;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours === 0 && minutes === 0) return '—';
    return `${hours}h ${minutes}m`;
}

// Estágios de crescimento confirmados pelo dono (referência oficial para
// TODOS os comandos/logs do bot): 0 = Filhote, 0.25 = Juvenil,
// 0.50 = Adolescente, 0.80 = Sub-Adulto, 1 = Adulto. Valores contínuos entre
// esses pontos usam o limiar mais próximo abaixo.
function formatGrowth(growth) {
    if (growth === null || growth === undefined) return '—';
    if (growth >= 1) return 'Adulto';
    if (growth >= 0.80) return 'Sub-Adulto';
    if (growth >= 0.50) return 'Adolescente';
    if (growth >= 0.25) return 'Juvenil';
    return 'Filhote';
}

function formatKD(kills, deaths) {
    if (deaths > 0) return (kills / deaths).toFixed(2);
    if (kills > 0) return kills.toFixed(2);
    return '—';
}

class PlayerRegistrationSystem {
    constructor(client) {
        this.client = client;
    }

    // ==================== CARD COMPARTILHADO (avatar + identificação + status) ====================

    /**
     * Bloco reutilizado tanto pelo painel de /registrar quanto pelo /perfil:
     * avatar, username, Discord ID, e o status do vínculo com a conta do
     * Path of Titans (Alderon ID, se houver).
     *
     * @param {AdvancedContainerBuilder} builder
     * @param {import('discord.js').User} targetUser
     * @param {object|null} player - linha de pot_players, ou null se não registrado
     */
    _appendProfileCard(builder, targetUser, player) {
        let text = buildIdentityBlock(targetUser);
        if (!player) {
            text += `\n${EMOJIS.circlealert || '❌'} Conta ainda não linkada, use /registrar para linkar sua conta ao bot Titan's Pass.`;
        }

        builder.section(
            text,
            AdvancedContainerBuilder.thumbnail(targetUser.displayAvatarURL({ size: 256 })),
        );

        return builder;
    }

    /**
     * Imagem de rodapé por tier (assets footer_free/compy/raptor) — usada no
     * lugar do footer de texto ("Produzido por...") em todo container
     * relacionado a premium/perfil do jogador. Retorna os attachments extras
     * que o chamador precisa mesclar em payload.files.
     */
    _appendFooterImage(builder, playerTier) {
        const footerKey = `footer_${playerTier}`;
        const footerUrl = imageManager.getUrl(footerKey);
        const footerAttachment = imageManager.getAttachment(footerKey);
        const extraFiles = [];
        if (footerUrl) {
            builder.gallery([footerUrl]);
            if (footerAttachment) extraFiles.push(footerAttachment);
        }
        return extraFiles;
    }

    // ==================== PAINEL DE CADASTRO (/registrar) ====================

    /**
     * Monta e envia o painel de status/cadastro (sempre efêmero — é uma
     * consulta/ação pessoal, não faz sentido ser pública no canal).
     */
    async sendPanel(interaction) {
        const userId = interaction.user.id;
        const guildName = interaction.guild?.name || 'Servidor';

        const player = PlayerRegistry.getPlayerByDiscordId(userId);

        const builder = new AdvancedContainerBuilder({ accentColor: player ? COLORS.SUCCESS : COLORS.DEFAULT });
        builder.text('# CADASTRO DE JOGADOR');
        builder.text('Vincula sua conta do Discord à sua conta do Path of Titans (Alderon ID) no nosso banco de dados, pra que o bot possa reconhecer você e liberar recursos exclusivos.');
        builder.text(`${EMOJIS.globo || '🌐'} **Esse vínculo é global** — funciona em qualquer servidor que tiver o bot, não precisa registrar de novo em cada comunidade.`);
        builder.separator();

        this._appendProfileCard(builder, interaction.user, player);

        builder.separator();
        if (player) {
            builder.text(`${EMOJIS.messagesquare || 'ℹ️'} Pode atualizar quando quiser — por exemplo, se vinculou uma conta diferente do Path of Titans.`);
        } else {
            builder.text(`${EMOJIS.messagesquare || 'ℹ️'} Clique no botão abaixo pra vincular sua conta.`);
        }
        builder.separator();
        builder.text(
            `${EMOJIS.shieldcheck || '🛡️'} **Forma mais rápida:** conecte sua conta do Discord pelo site oficial da Alderon Games e entre em um servidor com o bot configurado — o vínculo é feito automaticamente, sem precisar preencher o cadastro manual abaixo.`
        );
        builder.separator();
        builder.text(
            `${EMOJIS.trianglealert || '⚠️'} **Verificação em jogo obrigatória:** o cadastro manual abaixo só é concluído depois de você confirmar um código enviado dentro do jogo — por isso, esteja online no servidor de jogo configurado aqui antes de preencher.`
        );

        const PremiumSystem = require('../premium/premiumSystem');
        const playerTier = PremiumSystem.getPlayerTier(userId);
        builder.separator();
        const extraFiles = this._appendFooterImage(builder, playerTier);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('player_register:open')
                .setLabel(player ? 'Atualizar Cadastro' : 'Cadastrar')
                .setStyle(player ? ButtonStyle.Secondary : ButtonStyle.Success)
                .setEmoji(EMOJIS.idcard || '🆔'),
        );

        const payload = builder.build();
        payload.components = [...payload.components, row];
        payload.files = [...(payload.files || []), ...extraFiles];
        payload.flags = payload.flags | MessageFlags.Ephemeral;

        await interaction.editReply(payload);
    }

    // ==================== PERFIL (/perfil) ====================

    /**
     * Resolve os bytes da foto de fundo do card, em ordem de prioridade:
     * Raptor: foto personalizada (upload via /perfil-edit) → banner do
     * próprio Discord → foto padrão do tier.
     * Compy: foto escolhida num menu pré-definido (/perfil-edit,
     * selected_photo_key) → foto padrão do tier.
     * Nunca guarda a URL de um anexo do Discord no banco (expira em ~24h) —
     * só o ID da mensagem de armazenamento, resolvido de novo a cada /perfil.
     */
    async _resolveCardPhotoBuffer(interaction, targetUser, player, playerTier) {
        if (playerTier === 'raptor') {
            if (player?.banner_message_id && process.env.BANNER_STORAGE_CHANNEL_ID) {
                try {
                    const storageChannel = await interaction.client.channels.fetch(process.env.BANNER_STORAGE_CHANNEL_ID);
                    const storedMessage = await storageChannel.messages.fetch(player.banner_message_id);
                    const url = storedMessage.attachments.first()?.url;
                    if (url) {
                        const res = await fetch(url);
                        if (res.ok) return Buffer.from(await res.arrayBuffer());
                    }
                } catch (err) {
                    // segue pro próximo fallback
                }
            }

            try {
                const fullUser = await targetUser.fetch();
                const url = fullUser.bannerURL({ size: 512 });
                if (url) {
                    const res = await fetch(url);
                    if (res.ok) return Buffer.from(await res.arrayBuffer());
                }
            } catch (err) {
                // segue pro fallback padrão do tier
            }
        }

        if (playerTier === 'compy' && player?.selected_photo_key && imageManager.hasImage(player.selected_photo_key)) {
            try {
                const localPath = imageManager.getPath(player.selected_photo_key);
                if (localPath) return fs.readFileSync(localPath);
            } catch (err) {
                // segue pro fallback padrão do tier
            }
        }

        return fs.readFileSync(DEFAULT_CARD_PHOTOS[playerTier] || DEFAULT_CARD_PHOTOS.free);
    }

    /**
     * Resolve a URL do PLANO DE FUNDO (banner atrás da mensagem inteira do
     * /perfil, distinto do recorte de foto de dentro do card acima) — Raptor
     * (upload próprio, message_id) > Compy (imageManager, selected_background_key)
     * > null (sem plano de fundo nenhum — diferente da foto, não tem
     * "padrão do tier" pra isso, simplesmente não aparece banner nenhum).
     * Só retorna URL (não Buffer): o plano de fundo só é EXIBIDO
     * (builder.gallery()), nunca composto/recortado como a foto do card.
     *
     * @returns {Promise<string|null>}
     */
    async _resolveBackgroundUrl(interaction, player, playerTier) {
        if (playerTier === 'raptor' && player?.background_message_id && process.env.BANNER_STORAGE_CHANNEL_ID) {
            try {
                const storageChannel = await interaction.client.channels.fetch(process.env.BANNER_STORAGE_CHANNEL_ID);
                const storedMessage = await storageChannel.messages.fetch(player.background_message_id);
                const url = storedMessage.attachments.first()?.url;
                if (url) return url;
            } catch (err) {
                // segue pro fallback (sem plano de fundo)
            }
        }

        if (playerTier === 'compy' && player?.selected_background_key && imageManager.hasImage(player.selected_background_key)) {
            const url = imageManager.getUrl(player.selected_background_key);
            if (url) return url;
        }

        return null;
    }

    /**
     * Monta e envia o cartão de perfil de um usuário (o próprio ou outro).
     * Só leitura — sem botão de ação; para cadastrar/atualizar é sempre
     * /registrar (evita ter dois fluxos de escrita fazendo a mesma coisa).
     *
     * @param {import('discord.js').CommandInteraction} interaction
     * @param {import('discord.js').User} targetUser
     */
    async sendProfile(interaction, targetUser) {
        const guild = interaction.guild;
        const player = PlayerRegistry.getPlayerByDiscordId(targetUser.id);

        const PremiumSystem = require('../premium/premiumSystem');
        const playerTier = PremiumSystem.getPlayerTier(targetUser.id);

        const builder = new AdvancedContainerBuilder({ accentColor: TIER_ACCENT_COLORS[playerTier] || COLORS.DEFAULT });
        const extraFiles = [];

        // Um separator() só é adicionado ANTES de cada bloco a partir do 2º —
        // evita separadores vazios (dois seguidos, ou um sobrando no fim)
        // quando algum bloco opcional (ex: texto de tier, no Free) não entra.
        let needsSeparator = false;
        const addSeparatorIfNeeded = () => {
            if (needsSeparator) builder.separator();
            needsSeparator = true;
        };

        // ── Plano de fundo (banner atrás da mensagem inteira, distinto da
        // foto de dentro do card) — sempre o PRIMEIRO bloco, mesmo padrão de
        // "banner no topo" já usado em /config personalizar. Só existe pra
        // quem já linkou a conta e configurou um (ver /perfil-edit). ────────
        if (player) {
            try {
                const backgroundUrl = await this._resolveBackgroundUrl(interaction, player, playerTier);
                if (backgroundUrl) {
                    addSeparatorIfNeeded();
                    builder.gallery([backgroundUrl]);
                }
            } catch (error) {
                console.error('❌ [PlayerRegistration] Erro ao resolver plano de fundo:', error);
            }
        }

        // ── Card de perfil (moldura + foto + badges + estrelas de honra),
        // entra no lugar do título "# PERFIL". Só existe pra quem já linkou
        // a conta — sem Alderon ID/nome no jogo não tem o que desenhar no
        // card. Quando renderiza o card, a identificação (Alderon ID/Discord)
        // já vem NELE, então o bloco de identificação abaixo não repete essa
        // parte (só o avatar some; sem vínculo, cai no fallback de sempre). ──
        let cardRendered = false;
        let stats = null;
        if (player) {
            try {
                // Por SERVIDOR (não mais global/somado entre servidores) —
                // o /perfil virou público, mostrar um total que soma outros
                // servidores que o bot atende confundiria a comunidade daqui
                // (ver aviso perto do KDA abaixo). Ver getGuildPlayerStats.
                stats = PlayerRegistry.getGuildPlayerStats(guild.id, player.alderon_id);
                const photoBuffer = await this._resolveCardPhotoBuffer(interaction, targetUser, player, playerTier);
                const cardBuffer = await renderProfileCard({
                    tier: playerTier,
                    photoBuffer,
                    nickname: player.player_name || targetUser.username,
                    alderonId: player.alderon_id,
                    discordUsername: targetUser.username,
                    // Texto livre do jogador (Raptor, ver /perfil-edit) — sem
                    // um definido, mantém o placeholder de sempre.
                    titleLabel: player.profile_title || 'Em breve (missões)',
                    levelLabel: 'Nível 1',
                    // Espécie MAIS jogada (por nº de vezes escolhida), não a
                    // última — essa continua só no painel "Offline" abaixo,
                    // vinda de stats.dinosaurType (getGlobalPlayerStats).
                    speciesLabel: PlayerRegistry.getMostPlayedDinosaur(player.alderon_id) || 'Ainda sem registro',
                    honorStars: PunishmentSystem.getGlobalHonorStars(targetUser.id),
                });
                extraFiles.push(new AttachmentBuilder(cardBuffer, { name: 'perfil-card.png' }));
                addSeparatorIfNeeded();
                builder.gallery(['attachment://perfil-card.png']);
                cardRendered = true;
            } catch (error) {
                console.error('❌ [PlayerRegistration] Erro ao gerar card de perfil:', error);
            }
        }

        if (cardRendered) {
            // ── Estatísticas do jogador, com o avatar do Discord ao lado —
            // dados DESTE SERVIDOR (ver getGuildPlayerStats acima). 3 estados,
            // vindos de webhook (não RCON — ver potPlayerRegistry.js):
            // online+dinossauro ativo (PlayerRespawn), online na tela de
            // seleção (PlayerLogin sem respawn ainda, ou morreu e voltou pra
            // seleção — PlayerKilled zera dinosaur_active da vítima), ou
            // offline (PlayerLogout/Leave). ──────────────────────────────────
            // hide_kda (Player Premium, ver /perfil-edit) esconde só a linha
            // de Kills/Deaths/K-D — o resto do bloco (status/dino/growth/
            // tempo de jogo) continua aparecendo normalmente.
            const kdLine = player.hide_kda ? null : [
                `**Kills:** ${stats.kills} | **Deaths:** ${stats.deaths} | **K/D:** ${formatKD(stats.kills, stats.deaths)}`,
                `-# ${EMOJIS.messagesquare || 'ℹ️'} Estatísticas de combate referentes a este servidor.`,
            ].join('\n');

            const statsLines = [];
            if (stats.isOnline && stats.dinosaurActive && stats.dinosaurType) {
                statsLines.push(
                    `## ${EMOJIS.circlecheck || '🟢'} Jogando agora de "${stats.dinosaurType}"`,
                    `**Growth:** ${formatGrowth(stats.dinosaurGrowth)} | **Tempo de jogo:** ${formatPlaytime(stats.totalPlaytime)}`,
                );
            } else if (stats.isOnline) {
                statsLines.push(`${EMOJIS.circlecheck || '🟢'} **Jogando agora na seleção de dinossauros.**`);
            } else {
                statsLines.push(
                    `${EMOJIS.circlealert || '⚫'} **Offline**`,
                    `**Último dinossauro jogado:** ${stats.dinosaurType ? `"${stats.dinosaurType}"` : '—'}`,
                );
            }
            if (kdLine) statsLines.push(kdLine);

            addSeparatorIfNeeded();
            builder.section(statsLines.join('\n'), AdvancedContainerBuilder.thumbnail(targetUser.displayAvatarURL({ size: 256 })));
        } else {
            // Sem vínculo (ou falha ao gerar o card) — volta pro banner estático
            // padrão do tier + bloco de identificação completo de sempre.
            const bannerKey = `foto_perfil_${playerTier}`;
            const bannerUrl = imageManager.getUrl(bannerKey);
            const bannerAttachment = imageManager.getAttachment(bannerKey);
            if (bannerAttachment) extraFiles.push(bannerAttachment);
            if (bannerUrl) {
                addSeparatorIfNeeded();
                builder.gallery([bannerUrl]);
            }
            addSeparatorIfNeeded();
            this._appendProfileCard(builder, targetUser, player);
            addSeparatorIfNeeded();
            builder.text(`${EMOJIS.sparkles || '✨'} *Títulos e emblemas exclusivos chegando em breve!*`);
        }

        if (playerTier !== 'free') {
            addSeparatorIfNeeded();
            const tierLabel = playerTier === 'raptor' ? 'Raptor' : 'Compy';
            builder.text(`${EMOJIS.badge || '🏅'} **Player Premium:** ${tierLabel}`);
        }

        // ── Imagem de rodapé, também por tier (assets footer_free/compy/raptor) —
        // substitui o footer de texto ("Produzido por..."), não usado aqui. ──────
        addSeparatorIfNeeded();
        extraFiles.push(...this._appendFooterImage(builder, playerTier));

        const payload = builder.build();
        payload.files = [...(payload.files || []), ...extraFiles];
        // Pedido do dono: /perfil deixou de ser ephemeral — visível pra
        // qualquer um no canal, não só quem rodou o comando (era forçado
        // aqui antes, independente de como interactionCreate.js deferiu).

        await interaction.editReply(payload);
    }

    // ==================== MODAL ====================

    getRegisterModal(existingPlayer) {
        const modal = new ModalBuilder().setCustomId('player_register_modal').setTitle('Cadastro de Jogador');

        // ── NUNCA chamar .setValue('') aqui: o campo do Alderon ID tem
        // setMinLength(11), e o Discord valida o `value` de PREENCHIMENTO
        // do modal contra esse limite antes mesmo do modal abrir — uma
        // string vazia quebra showModal() com 50035/BASE_TYPE_MIN_LENGTH
        // pra QUALQUER usuário sem cadastro prévio (existingPlayer null).
        // .setValue() só pode ser chamado quando há valor de verdade. ──────
        const nomeInput = new TextInputBuilder()
            .setCustomId('nome_jogo')
            .setLabel('Seu nome no Path of Titans')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
            .setPlaceholder('Ex: Rexy');
        if (existingPlayer?.player_name) nomeInput.setValue(existingPlayer.player_name);

        const alderonInput = new TextInputBuilder()
            .setCustomId('alderon_id')
            .setLabel('Seu Alderon ID (AGID)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(11)
            .setMaxLength(11)
            .setPlaceholder('Formato: 048-236-424');
        if (existingPlayer?.alderon_id) alderonInput.setValue(existingPlayer.alderon_id);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nomeInput),
            new ActionRowBuilder().addComponents(alderonInput),
        );
        return modal;
    }

    async handleOpenModal(interaction) {
        const player = PlayerRegistry.getPlayerByDiscordId(interaction.user.id);
        await interaction.showModal(this.getRegisterModal(player));
    }

    /**
     * Passo 1 do cadastro manual: valida o Alderon ID digitado e, se tudo
     * bater (formato, sem conflito, servidor com RCON configurado, jogador
     * online nesse servidor agora), gera e manda um código de verificação
     * via RCON — a verificação em jogo é OBRIGATÓRIA, nada é salvo em
     * player_links ainda. Os dados ficam staged em SessionManager até o
     * jogador confirmar o código (ver handleVerifyCodeSubmit).
     */
    async handleModalSubmit(interaction) {
        const userId = interaction.user.id;
        const guild = interaction.guild;
        const guildName = guild?.name || 'Servidor';

        const playerName = interaction.fields.getTextInputValue('nome_jogo').trim();
        const alderonIdRaw = interaction.fields.getTextInputValue('alderon_id').trim();

        if (!ALDERON_ID_REGEX.test(alderonIdRaw)) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} Alderon ID inválido. Use o formato \`xxx-xxx-xxx\` (só números), exatamente como aparece no jogo. Você digitou: \`${alderonIdRaw}\`.`,
                COLORS.ERROR, guildName,
            ));
        }

        // ── Mesmo conflito checado dentro de registerPlayerManually, mas
        // verificado ANTES de gastar um código/RCON à toa. ─────────────────
        const takenBy = PlayerRegistry.getPlayerByAlderonId(alderonIdRaw);
        if (takenBy && takenBy.user_id !== userId) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} Esse Alderon ID já está vinculado a outra conta do Discord (o vínculo é global, vale em qualquer servidor). Se isso for um engano, peça para a staff verificar.`,
                COLORS.ERROR, guildName,
            ));
        }

        // ── Verificação em jogo é obrigatória: precisa de RCON configurado
        // NESTE servidor e do jogador online NELE agora — sem isso o código
        // não tem como chegar até o jogador. Também é daqui que vem o
        // USERNAME real (webhook) usado como alvo do SystemMessage — o
        // comando espera o nome de usuário da Alderon Games/nome em jogo,
        // não o Alderon ID (diferente de kick/ban, que aceitam AGID). ──────
        const onlinePlayer = PlayerRegistry.getOnlinePotPlayer(guild.id, alderonIdRaw);
        if (!onlinePlayer) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} **Verificação em jogo obrigatória.** Não encontramos esse Alderon ID online no servidor de jogo configurado em **${guildName}** agora. Entre no jogo (nesse servidor) e tente \`/registrar\` de novo.`,
                COLORS.ERROR, guildName,
            ));
        }
        const gameUsername = onlinePlayer.player_name || playerName;

        const code = PlayerRegistry.generateVerificationCode();
        const rconResult = await PoTConfigSystem.executeRconCommand(guild.id, `SystemMessage ${gameUsername} Seu codigo de verificacao Titan's Pass: ${code}`);

        if (!rconResult?.success) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} Não foi possível enviar o código de verificação para o jogo agora (${rconResult?.error || 'erro desconhecido'}). Tente novamente em instantes.`,
                COLORS.ERROR, guildName,
            ));
        }

        sessionManager.set(userId, guild.id, 'player_verify', 'pending', {
            playerName, alderonId: alderonIdRaw, code,
        }, 10 * 60 * 1000);

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        builder.text(`${EMOJIS.messagesquare || '📨'} **Código enviado!**`);
        builder.text(`Olhe o chat do jogo — mandamos um código de verificação pra \`${alderonIdRaw}\`. Clique no botão abaixo e digite o código pra concluir o cadastro.`);
        builder.text(`${EMOJIS.clockalert || '⏳'} O código expira em 10 minutos.`);
        builder.footer(guildName);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('player_register:confirm_code')
                .setLabel('Confirmar código')
                .setStyle(ButtonStyle.Success)
                .setEmoji(EMOJIS.circlecheck || '✅'),
        );

        const payload = builder.build();
        payload.components = [...payload.components, row];
        await interaction.editReply(payload);
    }

    // ==================== VERIFICAÇÃO EM JOGO (PASSO 2) ====================

    getVerifyCodeModal() {
        return new ModalBuilder().setCustomId('player_register_verify_modal').setTitle('Confirmar Código').addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('codigo')
                    .setLabel('Código recebido no jogo')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMinLength(6)
                    .setMaxLength(6)
                    .setPlaceholder('Ex: 483920'),
            ),
        );
    }

    async handleConfirmCodeButton(interaction) {
        const session = sessionManager.get(interaction.user.id, interaction.guildId, 'player_verify', 'pending');
        if (!session) {
            return await interaction.reply({
                content: `${EMOJIS.circlealert || '❌'} Sessão expirada ou não encontrada. Use /registrar de novo pra gerar um código novo.`,
                flags: 64,
            });
        }
        await interaction.showModal(this.getVerifyCodeModal());
    }

    async handleVerifyCodeSubmit(interaction) {
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const guildName = interaction.guild?.name || 'Servidor';

        const session = sessionManager.get(userId, guildId, 'player_verify', 'pending');
        if (!session) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} Sessão expirada. Use /registrar de novo pra gerar um código novo.`,
                COLORS.ERROR, guildName,
            ));
        }

        const submittedCode = interaction.fields.getTextInputValue('codigo').trim();
        if (submittedCode !== session.code) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} Código incorreto. Confira o chat do jogo e tente de novo (clique em "Confirmar código" na mensagem anterior).`,
                COLORS.ERROR, guildName,
            ));
        }

        const result = PlayerRegistry.registerPlayerManually(userId, session.alderonId, session.playerName, true);
        sessionManager.delete(userId, guildId, 'player_verify', 'pending');

        if (!result.success) {
            const messages = {
                MISSING_FIELDS: 'Preencha os dois campos corretamente.',
                ALDERON_TAKEN: 'Esse Alderon ID já está vinculado a outra conta do Discord nesse meio tempo. Se isso for um engano, peça para a staff verificar.',
                DB_ERROR: 'Erro interno ao salvar o cadastro. Tente novamente em instantes.',
            };
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} ${messages[result.error] || 'Não foi possível concluir o cadastro.'}`,
                COLORS.ERROR, guildName,
            ));
        }

        const summary = result.created
            ? `${EMOJIS.circlecheck || '✅'} **Cadastro verificado e criado!**`
            : result.relinked
                ? `${EMOJIS.circlecheck || '✅'} **Cadastro verificado e atualizado** para o novo Alderon ID.`
                : `${EMOJIS.circlecheck || '✅'} **Cadastro verificado e atualizado!**`;

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });
        builder.text(summary);
        builder.text(`${EMOJIS.user || '👤'} **Nome no jogo:** ${session.playerName}`);
        builder.text(`${EMOJIS.PotLogo || '🦖'} **Alderon ID:** \`${session.alderonId}\``);
        builder.text(`${EMOJIS.shieldcheck || '🛡️'} Verificado em jogo.`);
        builder.footer(guildName);

        await interaction.editReply(builder.build());
    }

    _simpleReply(text, color, guildName) {
        return new AdvancedContainerBuilder({ accentColor: color }).text(text).footer(guildName).build();
    }
}

module.exports = PlayerRegistrationSystem;
