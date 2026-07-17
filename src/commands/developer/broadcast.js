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
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ConfigSystem = require('../../systems/core/configSystem');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

const DEVELOPER_ID = '203676076189286412';
const CONFIRM_PHRASE = 'ENVIAR BROADCAST';

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

function buildAnnouncementPayload(titulo, mensagem, imagem) {
    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
    builder.title(`${EMOJIS.megaphone || '📣'} ${titulo}`);
    builder.text(mensagem);
    if (imagem) builder.gallery([imagem.url]);
    builder.footerRaw("Titan's Pass — comunicado oficial do desenvolvedor");
    return builder.build();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('broadcast')
        .setDescription('🔒 Envia um comunicado pra todos os servidores (canal de logs gerais ou DM do dono)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('titulo')
            .setDescription('Título do comunicado')
            .setRequired(true)
            .setMaxLength(200))
        .addStringOption(opt => opt.setName('mensagem')
            .setDescription('Corpo do comunicado (markdown suportado)')
            .setRequired(true)
            .setMaxLength(3900))
        .addStringOption(opt => opt.setName('confirmar')
            .setDescription(`Digite "${CONFIRM_PHRASE}" para confirmar o envio`)
            .setRequired(true))
        .addAttachmentOption(opt => opt.setName('imagem')
            .setDescription('Imagem opcional pra acompanhar o comunicado')
            .setRequired(false)),

    // client aqui é sempre o bot PRINCIPAL (já está em todos os servidores
    // de cliente) — ver src/systems/core/devBot.js.
    async execute(interaction, client) {
        const startTime = Date.now();
        const { user, options } = interaction;
        const titulo = options.getString('titulo');
        const mensagem = options.getString('mensagem');
        const imagem = options.getAttachment('imagem');
        const confirmacao = options.getString('confirmar');

        if (user.id !== DEVELOPER_ID) {
            db.logActivity(null, user.id, 'broadcast_denied', null, { command: 'broadcast' });
            const denied = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`${EMOJIS.circlealert || '❌'} Este comando é restrito ao desenvolvedor do bot.`)
                .footer('Bot de Developer');
            const { components, flags } = denied.build();
            await interaction.editReply({ components, flags: [flags] });
            return;
        }

        const guilds = [...client.guilds.cache.values()];

        if (confirmacao !== CONFIRM_PHRASE) {
            let comChannel = 0;
            for (const guild of guilds) {
                if (ConfigSystem.getUnifiedGeneralLogChannel(guild.id)) comChannel++;
            }

            const previewBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
            previewBuilder.text([
                `# ${EMOJIS.search || '🔎'} PRÉVIA — AÇÃO NÃO CONFIRMADA`,
                `Digite exatamente **"${CONFIRM_PHRASE}"** no campo \`confirmar\` para enviar de verdade.`,
                '',
                `**Servidores com o bot:** ${guilds.length}`,
                `- Com canal de logs gerais configurado: ${comChannel}`,
                `- Sem canal (cairá em DM pro dono): ${guilds.length - comChannel}`,
                '',
                `**Título:** ${titulo}`,
            ].join('\n'));
            previewBuilder.footer('Bot de Developer — nada foi enviado ainda');
            const { components, flags } = previewBuilder.build();
            await interaction.editReply({ components, flags: [flags] });
            return;
        }

        try {
            const payload = buildAnnouncementPayload(titulo, mensagem, imagem);
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
