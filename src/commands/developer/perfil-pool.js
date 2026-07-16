// src/commands/developer/perfil-pool.js
/**
 * Gerencia os pools de imagens usados na personalização de /perfil (avatar/
 * foto de perfil, plano de fundo, emblema) — complementa os pools estáticos
 * hardcoded em configSystem.js (PLAYER_PHOTO_OPTIONS etc, vindos de arquivos
 * em assets/images/ via imageManager) com entradas adicionadas em runtime,
 * sem precisar editar código/redeployar a cada imagem nova. Ver
 * src/systems/pot/profileImagePool.js pro armazenamento (mesmo padrão de
 * "reenvia pro canal fixo, guarda só o ID da mensagem" já usado pro upload
 * próprio do Raptor em /perfil-edit).
 *
 * "Avatar" aqui é o mesmo conceito de "foto de perfil" no resto do bot (a
 * foto recortada dentro do card) — o tipo interno usado é 'avatar' porque
 * foi assim que o dono pediu, mas alimenta o MESMO pool que o picker "Foto
 * de Perfil" do /perfil-edit já usa. Emblema é liberado em QUALQUER tier de
 * Player Premium; avatar/plano de fundo continuam Compy+ — esse gate é todo
 * checado do lado da SELEÇÃO (configSystem.js), não aqui: este comando só
 * adiciona/remove/lista o que existe no pool.
 *
 * Diferente dos outros comandos de developer (reset-db, reset-reports,
 * premium-admin, combat-config), este NÃO recebe servidor_id: os pools de
 * imagem são globais (não pertencem a nenhum servidor específico), e o canal
 * de armazenamento (BANNER_STORAGE_CHANNEL_ID) é um ID fixo já resolvido
 * direto pelo client principal — não há guild nenhuma pra buscar.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ProfileImagePool = require('../../systems/pot/profileImagePool');
const { uploadAndStoreImage } = require('../../utils/imageStorage');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

const DEVELOPER_ID = '203676076189286412';

const TYPE_CHOICES = [
    { name: 'Avatar (foto de perfil)', value: 'avatar' },
    { name: 'Plano de fundo', value: 'background' },
    { name: 'Emblema', value: 'badge' },
];
const TYPE_LABELS = { avatar: 'Avatar', background: 'Plano de fundo', badge: 'Emblema' };

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('perfil-pool')
        .setDescription('🔒 Gerencia os pools de avatar/plano de fundo/emblema do /perfil (restrito ao desenvolvedor do bot)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('add')
            .setDescription('Adiciona uma nova imagem a um dos pools')
            .addStringOption(opt => opt.setName('tipo').setDescription('Qual pool').setRequired(true).addChoices(...TYPE_CHOICES))
            .addStringOption(opt => opt.setName('nome').setDescription('Nome de exibição (aparece no menu de escolha)').setRequired(true))
            .addAttachmentOption(opt => opt.setName('imagem').setDescription('Imagem (png, jpg ou webp — sem gif)').setRequired(true)))
        .addSubcommand(sub => sub
            .setName('remover')
            .setDescription('Remove uma imagem de um dos pools')
            .addStringOption(opt => opt.setName('tipo').setDescription('Qual pool').setRequired(true).addChoices(...TYPE_CHOICES))
            .addIntegerOption(opt => opt.setName('id').setDescription('ID da imagem (ver /perfil-pool listar)').setRequired(true)))
        .addSubcommand(sub => sub
            .setName('listar')
            .setDescription('Lista as imagens de um dos pools')
            .addStringOption(opt => opt.setName('tipo').setDescription('Qual pool').setRequired(true).addChoices(...TYPE_CHOICES))),

    // client aqui é sempre o bot PRINCIPAL — ver src/systems/core/devBot.js.
    async execute(interaction, client) {
        const { user } = interaction;

        if (user.id !== DEVELOPER_ID) {
            db.logActivity(null, user.id, 'perfil_pool_denied', null, { command: 'perfil-pool' });
            const denied = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`${EMOJIS.circlealert || '❌'} Este comando é restrito ao desenvolvedor do bot.`)
                .footer('Bot de Developer');
            const { components, flags } = denied.build();
            await interaction.editReply({ components, flags: [flags] });
            return;
        }

        const sub = interaction.options.getSubcommand();
        const tipo = interaction.options.getString('tipo');
        const tipoLabel = TYPE_LABELS[tipo];

        let builder;

        if (sub === 'add') {
            const nome = interaction.options.getString('nome');
            const imagem = interaction.options.getAttachment('imagem');
            const result = await uploadAndStoreImage(client, imagem, `${tipoLabel} (pool) — "${nome}" adicionado por \`${user.tag}\``);

            if (!result.ok) {
                builder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                    .text(`${EMOJIS.circlealert || '❌'} ${result.error}`);
            } else {
                const row = ProfileImagePool.addImage(tipo, nome, result.messageId, user.id);
                db.logActivity(null, user.id, 'perfil_pool_add', null, { tipo, id: row.id, nome });

                const availabilityNote = tipo === 'badge'
                    ? 'Já aparece no menu de escolha do `/perfil-edit` em QUALQUER tier (Emblema é liberado pra todos).'
                    : 'Já aparece no menu de escolha do `/perfil-edit` pra jogadores Player Premium Compy ou superior.';

                builder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS })
                    .text([
                        `# ${tipoLabel.toUpperCase()} ADICIONADO AO POOL`,
                        `**ID:** \`${row.id}\``,
                        `**Nome:** ${nome}`,
                        availabilityNote,
                    ].join('\n'));
            }
        } else if (sub === 'remover') {
            const id = interaction.options.getInteger('id');
            const removed = ProfileImagePool.removeImage(tipo, id);
            if (!removed) {
                builder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                    .text(`${EMOJIS.circlealert || '❌'} Nenhuma imagem de tipo **${tipoLabel}** com ID \`${id}\` encontrada.`);
            } else {
                db.logActivity(null, user.id, 'perfil_pool_remove', null, { tipo, id });
                builder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS })
                    .text([
                        `# ${tipoLabel.toUpperCase()} REMOVIDO DO POOL`,
                        `**ID:** \`${removed.id}\` — **Nome:** ${removed.label}`,
                        `${EMOJIS.messagesquare || 'ℹ️'} Jogadores que tinham essa imagem escolhida voltam a usar o padrão do tier no próximo \`/perfil\`.`,
                    ].join('\n'));
            }
        } else {
            const rows = ProfileImagePool.listImages(tipo);
            if (rows.length === 0) {
                builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT })
                    .text(`${EMOJIS.messagesquare || 'ℹ️'} Nenhuma imagem de tipo **${tipoLabel}** cadastrada no pool ainda.`);
            } else {
                const lines = rows.map(r => `\`${r.id}\` — ${r.label} (adicionado <t:${Math.floor(r.created_at / 1000)}:R>)`);
                builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT })
                    .text([`# POOL DE ${tipoLabel.toUpperCase()} (${rows.length})`, ...lines].join('\n'));
            }
        }

        builder.footer('Bot de Developer');
        const { components, flags } = builder.build();
        await interaction.editReply({ components, flags: [flags] });
    },
};
