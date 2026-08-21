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
    PermissionFlagsBits,
} = require('discord.js');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const PlayerRegistry = require('./potPlayerRegistry');
const PoTConfigSystem = require('./potConfigSystem');
const sessionManager = require('../../utils/sessionManager');
const imageManager = require('../../utils/imageManager');
const ProfileImagePool = require('./profileImagePool');
const { buildIdentityBlock } = require('../../utils/userIdentity');
const { renderProfileCard, renderXpHuntBar } = require('../../utils/profileCardRenderer');
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

// Mesmo domínio do dashboard web (dashboard.titansvisit.win — ver
// premiumPanel.js SITE_PREMIUM_URL pro mesmo padrão de link fixo).
const DASHBOARD_BASE_URL = 'https://dashboard.titansvisit.win';

// Usada em sendProfile (tempo de jogo NESTE servidor, ligado em
// 2026-08-10) e espelhada em dashboard.js/perfil.ejs (tempo de jogo POR
// servidor + soma total) — mesma formatação nos dois lados, cada um com
// sua própria cópia (mesmo padrão de duplicação já usado pra
// formatGrowth/formatGrowthStage entre este arquivo e webhookPayloads.js).
function formatPlaytime(totalSeconds) {
    const seconds = Number(totalSeconds) || 0;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours === 0 && minutes === 0) return '—';
    return `${hours}h ${minutes}m`;
}

// Estágios oficiais (pedido do dono, 2026-08-06 — corrige o limiar de
// Sub-Adulto usado desde a seção 26 do PREMIUM.txt, 0.80): 0 = Filhote,
// 0.25 = Juvenil, 0.50 = Adolescente, 0.75 = Sub-Adulto, 1 = Adulto —
// mesmos 5 pontos agora usados como VALOR de cada item "Growth: <estágio>"
// da Loja de Jogo (ver web/views/loja.ejs), então a exibição do /perfil e
// o que a loja vai efetivamente aplicar batem entre si. Duplicada em
// webhookPayloads.js (formatGrowthStage) — mesmo padrão de duplicação
// proposital já usado ali, manter as duas em sincronia.
function formatGrowth(growth) {
    if (growth === null || growth === undefined) return '—';
    if (growth >= 1) return 'Adulto';
    if (growth >= 0.75) return 'Sub-Adulto';
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

        // SUCCESS fica fixo (já vinculado) — só "ainda não vinculado" usa a
        // cor personalizada do servidor no lugar do DEFAULT fixo, pedido do
        // dono 2026-08-10. guild?.id porque /registrar pode, em teoria, não
        // ter guild (getPanelPersonalization já trata guildId ausente).
        const ConfigSystem = require('../core/configSystem');
        const registerPersonalization = ConfigSystem.getPanelPersonalization(interaction.guild?.id);
        const builder = new AdvancedContainerBuilder({ accentColor: player ? COLORS.SUCCESS : (registerPersonalization.accentColor ?? COLORS.DEFAULT) });
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
     * Raptor: foto personalizada (upload via /perfil-edit) → AVATAR do
     * próprio Discord (pedido do dono, 2026-08-15: "no player premium
     * raptor se não conseguir carregar o profile dele configurado, puxe a
     * imagem de avatar do discord como imagem de perfil" — corrigido de
     * bannerURL para avatarURL/displayAvatarURL, era o campo errado do
     * Discord) → item da Loja (selected_photo_key, pedido do dono,
     * 2026-08-19: "Tier raptor pode... usar a loja se quiser") → foto
     * padrão do tier.
     * Compy: foto escolhida na Loja (/perfil-edit, selected_photo_key) →
     * foto padrão do tier. Compy NUNCA toca Discord.
     * Free: só item da Loja (selected_photo_key) → foto padrão do tier.
     * Free NUNCA toca Discord.
     * A chave escolhida pode vir do pool estático (imageManager) ou do
     * pool dinâmico adicionado via /perfil-pool (prefixo "pool:<id>" — ver
     * profileImagePool.js). Nunca guarda a URL de um anexo do Discord no
     * banco (expira em ~24h) — só o ID da mensagem de armazenamento,
     * resolvido de novo a cada /perfil.
     */
    async _resolveCardPhotoBuffer(interaction, targetUser, player, playerTier) {
        if (playerTier === 'raptor') {
            if (player?.banner_message_id) {
                try {
                    const url = await require('../../utils/imageStorage').resolveStoredImageUrl(interaction.client, player.banner_message_id);
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
                const url = fullUser.displayAvatarURL({ size: 512 });
                if (url) {
                    const res = await fetch(url);
                    if (res.ok) return Buffer.from(await res.arrayBuffer());
                }
            } catch (err) {
                // segue pro fallback padrão do tier
            }
        }

        // BUG CORRIGIDO 2026-08-15 (pedido do dono: "somente raptor pode
        // alterar as imagem sem gastar as cacadas") — Compy tinha acesso
        // LIVRE ao pool inteiro aqui, comportamento antigo de antes da Loja
        // existir (2026-08-07), nunca revisado depois que a compra por
        // Caçadas foi implementada. Compy passa pela MESMA checagem de
        // posse que o Free já usava (imageShopSystem.js#canUseImage).
        // ATUALIZADO 2026-08-19 (pedido do dono: "Tier raptor pode... usar
        // a loja se quiser") — Raptor agora TAMBÉM pode escolher pela Loja
        // (upload, branch acima, continua tendo prioridade quando
        // presente); canUseImage já cobre a checagem de posse+tier
        // sozinha, então não precisa mais de whitelist de tier aqui.
        // Removida também a branch legada de imageManager só pra Compy
        // (código morto: getPersonalizationOptions() não devolve mais
        // chave legada nenhuma desde a reforma de 2026-08-12, então
        // selected_photo_key nunca mais é preenchido com uma chave assim
        // pra ninguém que não seja de antes dessa data).
        if (player?.selected_photo_key && ProfileImagePool.isPoolValue(player.selected_photo_key)) {
            const poolId = ProfileImagePool.poolIdFromValue(player.selected_photo_key);
            const allowed = require('./imageShopSystem').canUseImage(player.user_id, 'personalizacao', poolId);
            if (allowed) {
                try {
                    const buffer = await ProfileImagePool.resolveImageBuffer(interaction.client, 'personalizacao', poolId);
                    if (buffer) return buffer;
                } catch (err) {
                    // segue pro fallback padrão do tier
                }
            }
        }

        return fs.readFileSync(DEFAULT_CARD_PHOTOS[playerTier] || DEFAULT_CARD_PHOTOS.free);
    }

    /**
     * Resolve os BYTES do PLANO DE FUNDO — composto atrás do card inteiro
     * por renderProfileCard (pedido do dono: "literalmente no fundo de
     * tudo", não um bloco separado acima do card como antes), então precisa
     * dos bytes de verdade (Buffer), não só de uma URL pra exibir direto.
     * Raptor: upload próprio (message_id) → BANNER do próprio Discord, se o
     * jogador tiver um configurado (pedido do dono, 2026-08-15: "...e o
     * banner dele como plano de fundo se existir" — antes não existia
     * nenhum fallback de Discord aqui, sempre caía direto em null) > null
     * (sem plano de fundo, Raptor sem upload E sem banner no Discord).
     * Compy/Raptor: item comprado na Loja (selected_background_key, ver
     * imageShopSystem.js#canUseImage) > null. Compy NUNCA toca Discord.
     * Free: SEM plano de fundo, sempre (pedido do dono, 2026-08-19: "Tier
     * Free... não pode ter plano de fundo no perfil, somente
     * personalização de foto de perfil") — retorna null antes de checar
     * qualquer coisa, mesmo que o jogador tenha um selected_background_key
     * antigo de antes dessa mudança (dado órfão, nunca mais usado).
     *
     * @returns {Promise<Buffer|null>}
     */
    async _resolveBackgroundBuffer(interaction, player, playerTier) {
        if (playerTier === 'free') return null;

        if (playerTier === 'raptor' && player?.background_message_id) {
            try {
                const url = await require('../../utils/imageStorage').resolveStoredImageUrl(interaction.client, player.background_message_id);
                if (url) {
                    const res = await fetch(url);
                    if (res.ok) return Buffer.from(await res.arrayBuffer());
                }
            } catch (err) {
                // segue pro próximo fallback
            }
        }

        // Sem upload próprio (ou upload falhou) — cai pro banner do Discord,
        // se o jogador tiver um configurado (força um fetch de verdade via
        // client.users.fetch(..., {force:true}), não client.users.cache: o
        // objeto em cache pode ser parcial e nunca ter o campo `banner`
        // populado, mesmo raciocínio já usado em _resolveCardPhotoBuffer
        // pro avatar).
        if (playerTier === 'raptor' && player?.user_id) {
            try {
                const fullUser = await interaction.client.users.fetch(player.user_id, { force: true });
                const url = fullUser.bannerURL({ size: 512 });
                if (url) {
                    const res = await fetch(url);
                    if (res.ok) return Buffer.from(await res.arrayBuffer());
                }
            } catch (err) {
                // segue sem plano de fundo (ou pro pool, abaixo)
            }
        }

        // Mesma regra do _resolveCardPhotoBuffer acima: canUseImage já
        // cobre a checagem de posse+tier sozinha (Free já saiu por cima
        // via early-return, então só Compy/Raptor chegam aqui). Removida
        // também a branch legada de imageManager só pra Compy (código
        // morto, mesmo motivo do outro resolver).
        if (player?.selected_background_key && ProfileImagePool.isPoolValue(player.selected_background_key)) {
            const poolId = ProfileImagePool.poolIdFromValue(player.selected_background_key);
            const allowed = require('./imageShopSystem').canUseImage(player.user_id, 'personalizacao', poolId);
            if (allowed) {
                const buffer = await ProfileImagePool.resolveImageBuffer(interaction.client, 'personalizacao', poolId);
                if (buffer) return buffer;
            }
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
    /**
     * Mensagem de espera de um estágio — pedido do dono, 2026-08-12: "podemos
     * adicionar uma mensagem de espera onde ele informa o que está
     * carregando?". A interação já chega deferida (ver handlers.js), então
     * dá pra trocar o conteúdo via editReply antes da resposta final — só
     * usado nos trechos de /perfil que realmente envolvem trabalho
     * perceptível (geração do card, com fetch de imagem + renderização);
     * o resto do comando é leitura direta do SQLite (better-sqlite3,
     * síncrono, na casa dos microssegundos) e não justificaria o custo de
     * uma ida-e-volta extra à API do Discord só pra mostrar um texto que
     * ninguém teria tempo de ler. Melhor esforço: uma falha aqui nunca pode
     * derrubar o carregamento do perfil de verdade.
     */
    async _sendLoadingStage(interaction, text) {
        try {
            await interaction.editReply(new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT }).text(text).build());
        } catch (err) {
            // melhor esforço — segue pro resto do carregamento normalmente
        }
    }

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

        // ── Card de perfil (moldura + foto + badges + estrelas de honra),
        // entra no lugar do título "# PERFIL". Só existe pra quem já linkou
        // a conta — sem Alderon ID/nome no jogo não tem o que desenhar no
        // card. Quando renderiza o card, a identificação (Alderon ID/Discord)
        // já vem NELE, então o bloco de identificação abaixo não repete essa
        // parte (só o avatar some; sem vínculo, cai no fallback de sempre).
        //
        // Plano de fundo (distinto da foto de dentro do card) é COMPOSTO por
        // renderProfileCard atrás do card inteiro, não um bloco separado do
        // Discord acima dele — pedido do dono: tem que ficar "literalmente
        // no fundo de tudo". Por isso é resolvido AQUI (como Buffer) e
        // passado pra dentro do render, em vez de virar seu próprio
        // builder.gallery() como antes. ─────────────────────────────────────
        let cardRendered = false;
        let stats = null;
        if (player) {
            await this._sendLoadingStage(interaction, `${EMOJIS.imagem || '🖼️'} Carregando suas imagens...`);
            try {
                // Por SERVIDOR (não mais global/somado entre servidores) —
                // o /perfil virou público, mostrar um total que soma outros
                // servidores que o bot atende confundiria a comunidade daqui
                // (ver aviso perto do KDA abaixo). Ver getGuildPlayerStats.
                stats = PlayerRegistry.getGuildPlayerStats(guild.id, player.alderon_id);
                // Foto e plano de fundo são totalmente independentes (nenhum
                // usa o resultado do outro) — rodavam em sequência antes
                // (pedido do dono, 2026-08-12: "o comando perfil demora um
                // pouquinho"), cada um podendo envolver 1-2 idas e voltas de
                // rede (canal de storage + CDN). Em paralelo agora; erro no
                // plano de fundo continua isolado (.catch cai pra null, sem
                // derrubar a foto nem o card inteiro — mesmo comportamento
                // de antes, só concorrente).
                // Cargo de staff (card novo, linha condicional) — mesma
                // checagem já usada mais abaixo pro bloco de texto "Cargo de
                // Staff" (targetMember/staffCategory, ver lá pro comentário
                // completo); resolvida aqui também porque o card já precisa
                // dela ANTES daquele bloco (mais barato que reestruturar a
                // ordem das seções desta função). ConfigSystem.
                // memberHasAnyStaffRole/staffRoleCategoryLabel já existem.
                const ConfigSystemForCard = require('../core/configSystem');
                const cardTargetMember = guild.members.cache.get(targetUser.id)
                    || await guild.members.fetch(targetUser.id).catch(() => null);
                const cardStaffLabel = ConfigSystemForCard.staffRoleCategoryLabel(guild.id, cardTargetMember);

                // Emblemas conquistados (ownedItems tipo 'badge') — mesma
                // fonte de dado do card do site (pfIdBadges, ver
                // dashboard.js), aqui resolvidos como Buffer (não URL, o
                // canvas do card precisa dos bytes) via
                // ProfileImagePool.resolveImageBuffer. Até 4 exibidos.
                const badgeRows = require('./imageShopSystem').getInventory(targetUser.id, 'badge').slice(0, 4);
                const badgeBuffers = (await Promise.all(
                    badgeRows.map((row) => ProfileImagePool.resolveImageBuffer(interaction.client, 'badge', row.pool_id).catch(() => null)),
                )).filter(Boolean);

                const [photoBuffer, backgroundBuffer] = await Promise.all([
                    this._resolveCardPhotoBuffer(interaction, targetUser, player, playerTier),
                    this._resolveBackgroundBuffer(interaction, player, playerTier).catch((error) => {
                        console.error('❌ [PlayerRegistration] Erro ao resolver plano de fundo:', error);
                        return null;
                    }),
                ]);
                const cardSpeciesLabel = PlayerRegistry.getMostPlayedDinosaur(player.alderon_id) || 'Ainda sem registro';
                const cardBuffer = await renderProfileCard({
                    tier: playerTier,
                    photoBuffer,
                    backgroundBuffer,
                    nickname: player.player_name || targetUser.username,
                    alderonId: player.alderon_id,
                    // Texto livre do jogador (Raptor, ver /perfil-edit) — sem
                    // um definido, mantém o placeholder de sempre.
                    titleLabel: player.profile_title || 'Em breve (missões)',
                    // Espécie MAIS jogada (por nº de vezes escolhida), não a
                    // última — essa continua só no painel "Offline" abaixo,
                    // vinda de stats.dinosaurType (getGlobalPlayerStats).
                    speciesLabel: cardSpeciesLabel,
                    isCarnivore: PlayerRegistry.isDinosaurCarnivore(cardSpeciesLabel),
                    honorStars: PunishmentSystem.getGlobalHonorStars(PunishmentSystem._resolveHistoryUserIds(targetUser.id, player.alderon_id)),
                    isStaff: !!cardStaffLabel,
                    staffLabel: cardStaffLabel,
                    badges: badgeBuffers,
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

            // Tempo de jogo NESTE servidor (pedido do dono, 2026-08-06:
            // "prepare... mas não comece a contar ainda"; LIGADO em
            // 2026-08-10: "Adicione horas jogadas naquele servidor nas
            // informações de perfil") — stats.totalPlaytime já vem pronto
            // de getGuildPlayerStats (soma o tempo AO VIVO da sessão atual
            // quando online agora), só reaproveita formatPlaytime() já
            // definida no topo do arquivo. Fora do bloco condicional de
            // status: é um total acumulado, aparece nos 3 estados
            // (jogando/seleção/offline), não só enquanto ativo num dino.
            const playtimeLine = stats.totalPlaytime > 0
                ? `**${EMOJIS.clock || '🕒'} Tempo de jogo neste servidor:** ${formatPlaytime(stats.totalPlaytime)}`
                : null;

            const statsLines = [];
            if (stats.isOnline && stats.dinosaurActive && stats.dinosaurType) {
                statsLines.push(
                    `## ${EMOJIS.circlecheck || '🟢'} Jogando agora de ${stats.dinosaurType}`,
                    `**Growth:** ${formatGrowth(stats.dinosaurGrowth)}`,
                );
            } else if (stats.isOnline) {
                statsLines.push(`${EMOJIS.circlecheck || '🟢'} **Jogando agora na seleção de dinossauros.**`);
            } else {
                statsLines.push(
                    `${EMOJIS.circlealert || '⚫'} **Offline**`,
                    `**Último dinossauro jogado:** ${stats.dinosaurType || '—'}`,
                );
            }
            if (playtimeLine) statsLines.push(playtimeLine);
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

        // ── Cargo de staff configurado (/config roles) + data de registro
        // (pedido do dono, 2026-08-07: "Registre a data de registro dos
        // jogadores, adicione ao perfil no site e no discord" +  "Quando um
        // usuário tiver o cargo staff configurado no discord, adicionar
        // esse cargo ao perfil dele no site e no discord"). Cargo é POR
        // SERVIDOR (mesma razão do KDA acima: /perfil é público aqui,
        // mostrar cargo de OUTRO servidor confundiria a comunidade deste);
        // data de registro é GLOBAL (player_links.registered_at, já vem
        // carimbada desde o primeiro /registrar, ver potPlayerRegistry.js
        // registerPlayerManually/_syncGlobalLinkFromWebhook — preservada em
        // re-vínculo, nunca sobrescrita). ───────────────────────────────────
        const ConfigSystem = require('../core/configSystem');
        const targetMember = guild.members.cache.get(targetUser.id)
            || await guild.members.fetch(targetUser.id).catch(() => null);
        const staffCategory = ConfigSystem.staffRoleCategoryLabel(guild.id, targetMember);
        const staffRoleName = ConfigSystem.highestStaffRoleName(guild.id, targetMember);
        const extraLines = [];
        // Card novo já mostra o cargo de staff (linha condicional, ver
        // renderProfileCard) quando ele renderiza — sem duplicar aqui nesse
        // caso. No fallback (cardRendered false: sem vínculo ou falha no
        // render), o card não existe pra mostrar isso, então continua.
        if (staffCategory && !cardRendered) {
            extraLines.push(`${EMOJIS.shield || '🛡️'} **Cargo de Staff:** ${staffCategory}${staffRoleName ? ` (${staffRoleName})` : ''}`);
        }
        if (player?.registered_at) {
            const regSeconds = Math.floor(player.registered_at / 1000);
            extraLines.push(`${EMOJIS.calendar || '📅'} **Registrado em:** <t:${regSeconds}:D> (<t:${regSeconds}:R>)`);
        }
        if (extraLines.length > 0) {
            addSeparatorIfNeeded();
            builder.text(extraLines.join('\n'));
        }

        // ── Histórico de Staff (pedido do dono, 2026-08-10: "Adicionar
        // histórico de staff no perfil de staffs apenas para vizualização
        // de quem é parte da equipe do servidor como staff"). DOIS gates
        // separados, de propósito:
        //  - QUEM APARECE (targetMember): Moderador OU Equipe de Eventos —
        //    Supervisor puro fica de fora (mesma regra já usada em
        //    /historico staff e nos relatórios, ver
        //    ConfigSystem.memberHasModOrEventRole — "análises são voltadas
        //    apenas pra moderação e eventos").
        //  - QUEM PODE VER (interaction.member, quem RODOU o comando):
        //    qualquer cargo de staff (incluindo Supervisor) ou Admin — mais
        //    largo de propósito, Supervisor continua podendo acompanhar a
        //    equipe mesmo não entrando na própria análise.
        // Dado já É apagado automaticamente ao perder TODOS os cargos de
        // staff (AnalyticsSystem.purgeStaffOnRoleLoss, via
        // guildMemberUpdate.js) — nada a fazer aqui além de ler.
        const viewerMember = interaction.member;
        const viewerIsStaff = viewerMember && (
            ConfigSystem.memberHasAnyStaffRole(guild.id, viewerMember)
            || viewerMember.permissions.has(PermissionFlagsBits.Administrator)
        );
        if (targetMember && viewerIsStaff && ConfigSystem.memberHasModOrEventRole(guild.id, targetMember)) {
            const AnalyticsSystem = require('../moderation/analyticsSystem');
            const staffTotals = AnalyticsSystem.getStaffHistoryTotals(guild.id, targetUser.id);
            const staffToday = AnalyticsSystem.getStaffTodayStats(guild.id, targetUser.id);
            addSeparatorIfNeeded();
            builder.text([
                `${EMOJIS.medal || '📊'} **Histórico de Staff** (${staffCategory}):`,
                staffTotals
                    ? `${EMOJIS.gavel || '⚠️'} Punições: \`${staffTotals.punishmentsApplied}\` • ${EMOJIS.ticket || '🎫'} Reports: \`${staffTotals.reportsJoined}\` entrados / \`${staffTotals.reportsClosed}\` fechados • ${EMOJIS.calendardays || '📅'} Eventos: \`${staffTotals.eventsCreated}\``
                    : `${EMOJIS.messagesquare || 'ℹ️'} Nenhum registro de atividade ainda.`,
                `-# Hoje: ${staffToday ? `\`${staffToday.punishmentsApplied}\` punições, \`${staffToday.reportsJoined}\` reports entrados` : 'nenhuma atividade ainda'} — use \`/historico staff\` pra mais detalhes.`,
            ].join('\n'));
        }

        // ── Saldos de moeda (pedido do dono, 2026-08-10: "Adicionar todos
        // os saldos de moedas no perfil, no discord e em jogo") — Caçadas/
        // XP continuam GLOBAIS (mesma razão de registered_at acima), só
        // aparecem pra quem já vinculou conta. Ossos virou saldo POR
        // SERVIDOR (reforma 2026-08-15, pedido do dono: "gostaria que
        // ossos fossem um saldo por servidor") — mostra o saldo NESTE
        // servidor especificamente, ver aviso "-#" abaixo. Ícones
        // dedicados (pedido do dono, 2026-08-12: "foram adicionados
        // icones para representar as moedas") — EMOJIS.Atack/EMOJIS.bone
        // são os emoji de aplicação sincronizados via `npm run
        // sync-emojis`, mesmo vocabulário visual da Loja (ver loja.ejs).
        // BUG REAL corrigido (pedido do dono, 2026-08-19: "Use emoji
        // Atack para moedas hunt e emoji bone para ossos") — o emoji de
        // Caçadas foi sincronizado do Discord com o nome "Atack" (não
        // "hunt" como o código assumia desde 2026-08-12), então
        // EMOJIS.hunt sempre foi undefined e caía no fallback 💎 genérico
        // — nunca mostrava o emoji de verdade. EMOJIS.bone já estava
        // certo desde o início, sem mudança nele.
        // XP usa DinoFootprint (já existia, reaproveitado por pedido
        // explícito em vez de um ícone novo só pra isso).
        // Blindado com try/catch (pedido do dono, 2026-08-15: relato de
        // saldo sumindo do /perfil às vezes) — este era o ÚNICO trecho da
        // função inteira sem isso: se qualquer coisa aqui lançasse um erro,
        // a função INTEIRA abortava ali (rodapé/botões/o envio final da
        // mensagem, tudo depois deste bloco, também sumia sem log nenhum).
        // As 3 funções de leitura (getBonesBalance/getHuntBalance/getXp) já
        // são internamente blindadas (nunca deveriam lançar), então isto é
        // defesa em profundidade — mas se acontecer de novo, agora fica
        // registrado (ErrorLogger, que também avisa no canal de log do
        // sistema) em vez de derrubar o resto do perfil em silêncio.
        if (player) {
            try {
                await this._sendLoadingStage(interaction, `${EMOJIS.bone || '🦴'} Contando seus Ossos...`);
                const bonesBalance = PlayerRegistry.getBonesBalance(targetUser.id, guild.id);
                addSeparatorIfNeeded();
                // Caçadas e XP saíram deste texto (pedido do dono, 2026-08-21:
                // "coloque somente Ossos: 101 / Ossos referentes a este
                // servidor") — já aparecem na barra de XP/Caçadas renderizada
                // logo abaixo (renderXpHuntBar), então repetir os dois aqui em
                // texto virou redundante. huntBalance/levelProgress continuam
                // lidos separadamente mais abaixo (bloco da barra), não aqui.
                builder.text([
                    `${EMOJIS.bone || '🦴'} **Ossos:** ${bonesBalance}`,
                    `-# ${EMOJIS.messagesquare || 'ℹ️'} Ossos referentes a este servidor.`,
                ].join('\n'));
            } catch (error) {
                const ErrorLogger = require('../core/errorLogger');
                ErrorLogger.error('perfil', 'saldosDeMoeda', error, { userId: targetUser.id, guildId: guild.id });
            }
        }

        // Linha de texto "Player Premium: X" removida (pedido do dono,
        // 2026-08-11: "Não precisamos dessa informação de premium nos
        // perfis considerando que já temos a imagem e cor ilustrativa do
        // mesmo") — antes a imagem de rodapé estática por tier
        // (footer_free/compy/raptor) ficava aqui só com o nome do tier em
        // texto, sem dado nenhum do jogador.
        // ── Barra de Nível/XP + Caçadas, também colorida por tier (pedido
        // do dono, 2026-08-20: "gostaria que essa barra substituísse a
        // barra de tier premium que temos nos perfis do discord, seguindo
        // as cores ainda de acordo com premium do jogador") — substitui a
        // imagem estática acima por uma renderizada na hora com o Nível/
        // XP/Caçadas REAIS do jogador (mesmo layout de .pf-id-bottom-row
        // no site, ver renderXpHuntBar em profileCardRenderer.js). Caçadas
        // e XP são GLOBAIS (ver bloco de saldos acima) — funciona mesmo
        // sem vínculo de PoT (getHuntBalance/getLevelProgress voltam 0/
        // Nível 0 com segurança), mesma condição incondicional que a
        // imagem antiga já tinha (fora dos blocos cardRendered/player).
        try {
            const huntBalanceForBar = PlayerRegistry.getHuntBalance(targetUser.id);
            const levelProgressForBar = PlayerRegistry.getLevelProgress(targetUser.id);
            const xpHuntBarBuffer = await renderXpHuntBar({ tier: playerTier, levelProgress: levelProgressForBar, huntBalance: huntBalanceForBar });
            extraFiles.push(new AttachmentBuilder(xpHuntBarBuffer, { name: 'perfil-xp-hunt.png' }));
            addSeparatorIfNeeded();
            builder.gallery(['attachment://perfil-xp-hunt.png']);
        } catch (error) {
            console.error('❌ [PlayerRegistration] Erro ao gerar barra de XP/Caçadas, seguindo sem ela:', error);
        }

        // Botão "Emblema & Título" — baseado no TARGET (o perfil sendo
        // exibido), diferente dos botões de atalho abaixo. Navega pra uma
        // "página" nova DENTRO da mesma mensagem (mesmo padrão de /ajuda —
        // editReply troca o conteúdo, com um botão Voltar pra página de
        // perfil original) mostrando o equipado + o que dá pra resgatar
        // agora — ver handlePerfilViewBadgeTitle em configSystem.js.
        // Reabilitado na reforma das lojas (2026-08-12): estava desativado
        // ("por hora desative os botões de emblemas e titulo") esperando
        // uma fonte real de "conquistado" — agora existe (image_inventory.
        // source='redeemed' via AchievementSystem.checkRequirementMet).
        // Só entra com vínculo (sem player_links não há emblema/título pra
        // mostrar).
        const profileActionButtons = [];
        if (player) {
            profileActionButtons.push(
                new ButtonBuilder().setCustomId(`perfil-edit:view-badge-title:${targetUser.id}`).setLabel('Emblema & Título').setStyle(ButtonStyle.Secondary).setEmoji(EMOJIS.badge || '🏅'),
            );
            // Inventário — "botão de inventário do jogador... manda uma
            // mensagem ephemeral do inventario dele no discord" (ver
            // handlePerfilInventory em configSystem.js, lista
            // image_inventory/imageShopSystem — itens comprados/resgatados).
            // Reabilitado junto com o botão acima (reforma 2026-08-12).
            profileActionButtons.push(
                new ButtonBuilder().setCustomId(`perfil-edit:inventory:${targetUser.id}`).setLabel('Inventário').setStyle(ButtonStyle.Secondary).setEmoji('🎒'),
            );
        }

        // Atalhos pro dashboard web — sempre baseados em QUEM RODOU o
        // comando (interaction.user), nunca em targetUser: /perfil aceita
        // ver o perfil de outra pessoa (opção `usuario`/`alderon_id`, ver
        // perfil.js), e os botões são links fixos (ButtonStyle.Link) —
        // qualquer um que clicar entra com a PRÓPRIA conta do Discord,
        // então mostrar teria que refletir os acessos de quem vai clicar,
        // não de quem está sendo exibido no card. Pedido do dono,
        // 2026-08-10: "Adicionar botão dashboard em perfil apenas para
        // usuários que administram um server". Botão de atalho pro
        // Controle Loja (só pro dono) removido em 2026-08-10 — pedido do
        // dono: "não é para ser isso" — a página continua acessível pela
        // sidebar do dashboard (/dev/Loja), só não pelo /perfil.
        //
        // Botão Dashboard aponta direto pro /perfil do site agora (pedido
        // do dono, 2026-08-11: "link de dashboard no perfil (discord) deve
        // levar diretamente a pagina do perfil do usúario") — antes ia pra
        // /dashboard (lista de servidores administrados). Continua restrito
        // a quem administra algum servidor (gate original, não mexido —
        // pedido só trocou o destino, não quem vê o botão).
        const profileLinkButtons = [];
        // Cache-only de propósito (mesmo risco aceito já documentado em
        // dashboard.js getStaffRoles/resolveStaffRoleLabel): iterar E
        // buscar (fetch) o membro em TODO servidor que o bot atende seria
        // lento/gasta rate limit à toa só pra decidir se mostra 1 botão.
        const administersAnyGuild = [...this.client.guilds.cache.values()].some((g) => {
            const member = g.members.cache.get(interaction.user.id);
            if (!member) return false;
            if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
            return ConfigSystem.memberHasAnyStaffRole(g.id, member);
        });
        if (administersAnyGuild) {
            profileLinkButtons.push(
                new ButtonBuilder().setLabel('Dashboard').setURL(`${DASHBOARD_BASE_URL}/perfil`).setStyle(ButtonStyle.Link).setEmoji(EMOJIS.gauge || '📊'),
            );
        }
        // Loja — pedido do dono, 2026-08-11: "Adicione um botão de link da
        // loja que leva a loja no site". Sempre visível (a Loja de
        // Personalização é aberta a qualquer jogador, em qualquer tier —
        // ver imageShopSystem.js —, sem gate de administrador nenhum, ao
        // contrário do botão Dashboard acima).
        profileLinkButtons.push(
            new ButtonBuilder().setLabel('Loja').setURL(`${DASHBOARD_BASE_URL}/loja`).setStyle(ButtonStyle.Link).setEmoji(EMOJIS.store || '🛍️'),
        );

        // Mesma linha pros dois grupos (cabe até 5 por ActionRow — hoje no
        // máximo 4: Emblema&Título + Inventário + Dashboard + Loja) —
        // mistura Secondary com Link sem problema nenhum, Discord permite
        // os dois estilos juntos.
        const allProfileButtons = [...profileActionButtons, ...profileLinkButtons];

        const payload = builder.build();
        payload.files = [...(payload.files || []), ...extraFiles];
        if (allProfileButtons.length > 0) {
            payload.components = [...payload.components, new ActionRowBuilder().addComponents(...allProfileButtons)];
        }
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
                COLORS.ERROR, guild,
            ));
        }

        // ── Mesmo conflito checado dentro de registerPlayerManually, mas
        // verificado ANTES de gastar um código/RCON à toa. ─────────────────
        const takenBy = PlayerRegistry.getPlayerByAlderonId(alderonIdRaw);
        if (takenBy && takenBy.user_id !== userId) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} Esse Alderon ID já está vinculado a outra conta do Discord (o vínculo é global, vale em qualquer servidor). Se isso for um engano, peça para a staff verificar.`,
                COLORS.ERROR, guild,
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
                COLORS.ERROR, guild,
            ));
        }
        const gameUsername = onlinePlayer.player_name || playerName;

        const code = PlayerRegistry.generateVerificationCode();
        const rconResult = await PoTConfigSystem.executeRconCommand(guild.id, `SystemMessage ${gameUsername} Seu codigo de verificacao Titan's Pass: ${code}`, { actor: interaction.user.toString(), source: '/registrar' });

        if (!rconResult?.success) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} Não foi possível enviar o código de verificação para o jogo agora (${rconResult?.error || 'erro desconhecido'}). Tente novamente em instantes.`,
                COLORS.ERROR, guild,
            ));
        }

        sessionManager.set(userId, guild.id, 'player_verify', 'pending', {
            playerName, alderonId: alderonIdRaw, code,
        }, 10 * 60 * 1000);

        const ConfigSystem = require('../core/configSystem');
        const modalPersonalization = ConfigSystem.getPanelPersonalization(guild.id);
        const builder = new AdvancedContainerBuilder({ accentColor: modalPersonalization.accentColor ?? COLORS.DEFAULT });
        builder.text(`${EMOJIS.messagesquare || '📨'} **Código enviado!**`);
        builder.text(`Olhe o chat do jogo — mandamos um código de verificação pra \`${alderonIdRaw}\`. Clique no botão abaixo e digite o código pra concluir o cadastro.`);
        builder.text(`${EMOJIS.clockalert || '⏳'} O código expira em 10 minutos.`);
        builder.footer(guild);

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
                COLORS.ERROR, interaction.guild,
            ));
        }

        const submittedCode = interaction.fields.getTextInputValue('codigo').trim();
        if (submittedCode !== session.code) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} Código incorreto. Confira o chat do jogo e tente de novo (clique em "Confirmar código" na mensagem anterior).`,
                COLORS.ERROR, interaction.guild,
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
                COLORS.ERROR, interaction.guild,
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
        builder.footer(interaction.guild);

        await interaction.editReply(builder.build());
    }

    _simpleReply(text, color, guild) {
        return new AdvancedContainerBuilder({ accentColor: color }).text(text).footer(guild).build();
    }
}

module.exports = PlayerRegistrationSystem;
