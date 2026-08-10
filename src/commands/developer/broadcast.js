// src/commands/developer/broadcast.js
/**
 * Envia um comunicado (Components V2) pra TODOS os servidores onde o bot
 * principal está — no canal de logs gerais configurado (mesma chave
 * 'log_channel' usada por /config logs, resolvida via
 * ConfigSystem.getUnifiedGeneralLogChannel), ou por DM ao dono do servidor
 * quando não há canal configurado (ou o canal não pôde ser usado, ex: bot
 * sem permissão/canal apagado).
 *
 * Diferente de reset-db/reset-reports/reset-user-data (que operam sobre UM
 * servidor ou UMA identidade), este comando é inerentemente global — sem
 * servidor_id, mesmo padrão de /perfil-pool.
 *
 * Título/mensagem/confirmação vêm de um MODAL (pedido do dono, 2026-08-10:
 * "quero que tenha preenchimento de mensagem por modal"), não mais de
 * opções do slash command — Discord não aceita anexo (imagem/thumbnail)
 * dentro de modal, então esses 2 continuam como opções do /broadcast em
 * si; título/mensagem/confirmar viram campos do modal aberto na hora.
 * Isso exige que `execute()` chame interaction.showModal() como a
 * PRIMEIRA resposta da interação — sem o deferReply({flags:64}) que
 * devBot.js faz por padrão pra todo outro comando de developer, daí o
 * marcador `opensModal: true` abaixo (ver devBot.js) e o novo
 * `handleModalSubmit` exportado, roteado por lá quando o modal é enviado.
 * Os anexos (imagem/thumbnail) ficam parados no SessionManager entre a
 * abertura do modal e o envio dele — customId de modal não carrega dado
 * nenhum além de si mesmo, e um modal submit é uma interação NOVA, sem
 * acesso a interaction.options do comando original.
 */
const { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../../database/index');
const ConfigSystem = require('../../systems/core/configSystem');
const ResponseManager = require('../../utils/responseManager');
const SessionManager = require('../../utils/sessionManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

const DEVELOPER_ID = '203676076189286412';
const CONFIRM_PHRASE = 'ENVIAR BROADCAST';
const SESSION_TTL_MS = 10 * 60 * 1000; // tempo generoso pra preencher o modal com calma

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

// Thumbnail (pequena, ao lado do texto — pedido do dono, 2026-08-10:
// "opção para adicionar thumbnail alem da imagem") é um accessory de
// section(), diferente de imagem (grande, embaixo do texto, via
// gallery()) — únicas 2 formas de imagem que containerBuilder.js suporta.
// Com os 2, a thumbnail acompanha o texto (section) e a imagem grande vem
// depois (gallery); só thumbnail usa section sem gallery; só imagem
// mantém o comportamento de sempre (text solto + gallery).
function buildAnnouncementPayload(titulo, mensagem, imagemUrl, thumbnailUrl) {
    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
    const header = `${EMOJIS.megaphone || '📣'} ${titulo}`;
    if (thumbnailUrl) {
        builder.section(`## ${header}\n${mensagem}`, AdvancedContainerBuilder.thumbnail(thumbnailUrl));
    } else {
        builder.text(`## ${header}`);
        builder.text(mensagem);
    }
    if (imagemUrl) builder.gallery([imagemUrl]);
    builder.footerRaw("Titan's Pass — comunicado oficial do desenvolvedor");
    return builder.build();
}

function buildBroadcastModal() {
    return new ModalBuilder().setCustomId('broadcast:submit').setTitle('Enviar Broadcast').addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('titulo').setLabel('Título do comunicado').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('mensagem').setLabel('Mensagem (markdown suportado)').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(3900),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('confirmar').setLabel(`Digite exatamente: ${CONFIRM_PHRASE}`).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder(CONFIRM_PHRASE),
        ),
    );
}

module.exports = {
    // Ver devBot.js: pula o deferReply({flags:64}) automático pra este
    // comando — showModal() só é aceito como resposta ORIGINAL da
    // interação, nunca depois de um defer.
    opensModal: true,

    data: new SlashCommandBuilder()
        .setName('broadcast')
        .setDescription('🔒 Envia um comunicado pra todos os servidores (canal de logs gerais ou DM do dono)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addAttachmentOption(opt => opt.setName('imagem')
            .setDescription('Imagem grande opcional, abaixo do texto')
            .setRequired(false))
        .addAttachmentOption(opt => opt.setName('thumbnail')
            .setDescription('Imagem pequena opcional, ao lado do texto')
            .setRequired(false)),

    // client aqui é sempre o bot PRINCIPAL (já está em todos os servidores
    // de cliente) — ver src/systems/core/devBot.js.
    async execute(interaction, client) {
        const { user, options } = interaction;

        if (user.id !== DEVELOPER_ID) {
            db.logActivity(null, user.id, 'broadcast_denied', null, { command: 'broadcast' });
            return await ResponseManager.error(interaction, 'Este comando é restrito ao desenvolvedor do bot.');
        }

        const imagem = options.getAttachment('imagem');
        const thumbnail = options.getAttachment('thumbnail');
        SessionManager.set(user.id, null, 'broadcast', 'pending', {
            imagemUrl: imagem?.url || null,
            thumbnailUrl: thumbnail?.url || null,
        }, SESSION_TTL_MS);

        await interaction.showModal(buildBroadcastModal());
    },

    async handleModalSubmit(interaction, client) {
        const startTime = Date.now();
        const { user } = interaction;

        const titulo = interaction.fields.getTextInputValue('titulo');
        const mensagem = interaction.fields.getTextInputValue('mensagem');
        const confirmacao = interaction.fields.getTextInputValue('confirmar');

        const staged = SessionManager.get(user.id, null, 'broadcast', 'pending') || { imagemUrl: null, thumbnailUrl: null };
        SessionManager.delete(user.id, null, 'broadcast', 'pending');

        if (confirmacao !== CONFIRM_PHRASE) {
            return await ResponseManager.error(
                interaction,
                `Confirmação não bateu com "${CONFIRM_PHRASE}" — nada foi enviado. Use \`/broadcast\` de novo pra tentar outra vez.`,
            );
        }

        // Pedido do dono, 2026-08-10: "Comando broadcast não precisa ter
        // resposta de interação privada (ephemera)" — sem flags aqui
        // (deferReply padrão é público); loop abaixo passa por todo
        // servidor, então defer é necessário pra não estourar o prazo de
        // resposta da interação.
        await interaction.deferReply();

        try {
            const payload = buildAnnouncementPayload(titulo, mensagem, staged.imagemUrl, staged.thumbnailUrl);
            const guilds = [...client.guilds.cache.values()];
            const results = { channel: [], dm: [], failed: [] };

            for (const guild of guilds) {
                let delivered = false;

                const logChannelId = ConfigSystem.getUnifiedGeneralLogChannel(guild.id);
                if (logChannelId) {
                    try {
                        const channel = await guild.channels.fetch(logChannelId).catch(() => null);
                        if (channel) {
                            await channel.send(payload);
                            results.channel.push(guild.name);
                            delivered = true;
                        }
                    } catch (err) {}
                }

                if (!delivered) {
                    try {
                        const owner = await guild.fetchOwner();
                        await owner.send(payload);
                        results.dm.push(guild.name);
                        delivered = true;
                    } catch (err) {}
                }

                if (!delivered) results.failed.push(guild.name);
            }

            const broadcastUuid = db.generateUUID();
            db.logActivity(null, user.id, 'broadcast', null, {
                command: 'broadcast',
                titulo,
                totalGuilds: guilds.length,
                channelCount: results.channel.length,
                dmCount: results.dm.length,
                failedCount: results.failed.length,
                failed: results.failed,
                broadcastUuid,
                responseTime: Date.now() - startTime,
            });

            const successBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });
            successBuilder.text([
                `# ${EMOJIS.shieldcheck || '✅'} BROADCAST ENVIADO`,
                `**Título:** ${titulo}`,
            ].join('\n'));
            successBuilder.separator();
            successBuilder.text([
                `**Servidores:** ${guilds.length}`,
                `- ${EMOJIS.megaphone || '📣'} Canal de logs: ${results.channel.length}`,
                `- ${EMOJIS.mailwarning || '📨'} DM do dono: ${results.dm.length}`,
                `- ${EMOJIS.circlealert || '❌'} Falhou (canal e DM indisponíveis): ${results.failed.length}`,
            ].join('\n'));
            if (results.failed.length > 0) {
                successBuilder.separator();
                successBuilder.text(`**Falharam:**\n${results.failed.map(n => `- ${n}`).join('\n')}`);
            }
            successBuilder.footer('Bot de Developer', `UUID: ${broadcastUuid.slice(0, 8)} — ${Date.now() - startTime}ms`);

            const { components, flags } = successBuilder.build();
            await interaction.editReply({ components, flags: [flags] });

            console.log(`📊 [BROADCAST] ${user.tag} enviou "${titulo}" | canal:${results.channel.length} dm:${results.dm.length} falha:${results.failed.length}`);
        } catch (error) {
            console.error('❌ Erro no broadcast:', error);

            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');

            db.logActivity(null, user.id, 'error', null, { command: 'broadcast', error: error.message });

            const errorBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`# ${EMOJIS.circlealert || '❌'} ERRO AO ENVIAR BROADCAST\n\`${error.message?.slice(0, 150) || 'Desconhecido'}\``)
                .footer('Bot de Developer', 'O envio pode ter parado no meio — verifique manualmente.');
            const { components, flags } = errorBuilder.build();
            await interaction.editReply({ components, flags: [flags] });
        }
    },
};
