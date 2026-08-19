// src/commands/moderation/rcon-teste.js
/**
 * /rcon-teste — aplica a ação em jogo (RCON) de um nível de punição já
 * cadastrado, SEM registrar punição nenhuma (sem pontos, sem entrada em
 * /historico, sem afetar reputação) — só pra confirmar que o comando RCON
 * está funcionando de verdade E ver a mensagem real que aparece pro
 * jogador. Pedido do dono, 2026-08-14, durante a investigação de um ban
 * que não aplicou em jogo (jogador 250-488-341, guild
 * 1470636597929050255) — o bot só confere se o comando foi ENVIADO sem
 * erro de transporte, nunca se o servidor do jogo de fato reconheceu o
 * comando (ver docblock de PunishmentSystem.applyIngameAction).
 *
 * Restrito a ADMINISTRADOR de verdade do servidor (não Moderador/
 * Supervisor como o /strike — confirmado com o dono) — é uma ferramenta
 * de diagnóstico que aplica uma ação REAL em jogo sem nenhum registro no
 * banco, então o alcance é mais estreito que o de uma punição normal.
 * `/ingame-comandos.js` documenta que kick/ban/unban/ServerMute/
 * ServerUnmute são excluídos de propósito da família geral /ingame-*
 * (ficam exclusivos de /strike/`/unstrike`, pra todo ban real ter
 * registro) — este comando reabre essa fatia só pra Admin, com aviso
 * explícito de TESTE, mantendo a intenção original (nenhum Moderador
 * comum ganha acesso a ban cru).
 *
 * SEM confirmação em 2 passos (diferente do /strike, que sempre estagia
 * + confirma) — o próprio nome/descrição do comando e o aviso "TESTE" já
 * deixam claro o efeito; uma etapa de confirmação só atrasaria o
 * diagnóstico que é o objetivo do comando.
 *
 * Resposta PÚBLICA (pedido do dono) — este comando não entra na lista
 * `ephemeralCommands` de src/systems/core/handlers.js, então a resposta
 * de handleCommand já sai não-efêmera por padrão.
 *
 * SEM registro = SEM /unstrike possível — se o teste banir/mutar o
 * jogador errado, não existe punição pra /unstrike desfazer. A resposta
 * anexa um botão "Desfazer" (Ban/ServerMute com sucesso) que chama
 * PunishmentSystem.undoIngameAction diretamente — único outro caminho
 * que o bot expõe pra unban/ServerUnmute.
 */
const { SlashCommandBuilder } = require('discord.js');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const PunishmentLevels = require('../../systems/moderation/punishmentLevels');
const PunishmentSystem = require('../../systems/moderation/punishmentSystem');
const { getPlayerByAlderonId, getPlayerByDiscordId, getPlayerNameByAlderonId } = require('../../systems/pot/potPlayerRegistry');

let emojis = {};
try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rcon-teste')
        .setDescription('🧪 Testa a ação em jogo (RCON) de um nível, SEM registrar punição nenhuma.')
        // null (não Administrator): mesmo raciocínio do /strike (ver
        // comentário completo em strike/index.js) — o default do Discord é
        // só um ponto de partida, a checagem real (Administrador de
        // verdade) acontece dentro de execute().
        .setDefaultMemberPermissions(null)
        .addStringOption(opt => opt.setName('nivel').setDescription('Nível de punição a testar (comece a digitar pra ver as opções)').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo — texto que o JOGADOR vê em jogo, mesmo formato do /strike.').setRequired(true).setMaxLength(120))
        .addUserOption(opt => opt.setName('usuario').setDescription('Membro no Discord a testar (informe este e/ou agid)').setRequired(false))
        .addStringOption(opt => opt.setName('agid').setDescription('Alderon ID do jogador a testar (informe este e/ou usuario)').setRequired(false)),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== 'nivel') return interaction.respond([]).catch(() => {});

        const guildId = interaction.guildId;
        if (!guildId || !PremiumSystem.isGuildAtLeast(guildId, 'rastreador')) {
            return interaction.respond([]).catch(() => {});
        }

        const query = String(focused.value || '').toLowerCase();
        const levels = PunishmentLevels.getLevels(guildId)
            .filter((l) => l.name.toLowerCase().includes(query))
            .slice(0, 25);

        await interaction.respond(levels.map((l) => ({
            name: `${l.name} (${l.severity} · ${l.action || 'sem ação em jogo'})`.slice(0, 100),
            value: String(l.id),
        }))).catch(() => {});
    },

    async execute(interaction, client) {
        const { guild, options, member } = interaction;
        const guildId = guild.id;

        try {
            const ConfigSystem = require('../../systems/core/configSystem');
            if (!ConfigSystem.memberIsGuildAdmin(guildId, member)) {
                return await ResponseManager.error(interaction, 'Este comando é restrito a Administradores do servidor (ferramenta de teste, aplica ação real em jogo sem registro).');
            }

            if (!PremiumSystem.getGuildLimits(guildId).autoRcon) {
                return await ResponseManager.error(interaction, 'Este comando requer o plano Rastreador ou superior (ação em jogo via RCON). Veja /premium.');
            }

            const targetUserOption = options.getUser('usuario');
            const agidOption = options.getString('agid')?.trim() || null;
            const reason = options.getString('motivo');
            const nivelOption = options.getString('nivel');

            if (!targetUserOption && !agidOption) {
                return await ResponseManager.error(interaction, 'Informe `usuario` e/ou `agid` pra identificar o jogador a testar.');
            }

            const level = PunishmentLevels.getLevelByIdOrName(guildId, nivelOption);
            if (!level) {
                return await ResponseManager.error(interaction, 'Este nível não existe (pode ter sido apagado ou o nome não bate exatamente) — selecione um da lista de autocomplete.');
            }
            if (!level.action) {
                return await ResponseManager.error(interaction, `O nível **${level.name}** não tem ação em jogo configurada (ver /config punishments) — nada pra testar via RCON.`);
            }

            // ── Resolve o AGID: agid direto tem prioridade (mesma regra do
            // /strike); usuario sozinho precisa de vínculo já existente —
            // diferente do /strike, aqui NÃO existe alvo sintético "só em
            // jogo" (isso existe lá pra permitir REGISTRAR uma punição sem
            // conta Discord; aqui não há registro nenhum, só precisa de um
            // AGID válido pra mandar o RCON). ──────────────────────────────
            let alderonId = agidOption;
            let targetLabel;
            if (targetUserOption && agidOption) {
                targetLabel = `${targetUserOption} \`${agidOption}\``;
            } else if (agidOption) {
                const link = getPlayerByAlderonId(agidOption);
                const playerName = link?.player_name || getPlayerNameByAlderonId(guildId, agidOption) || null;
                targetLabel = playerName ? `${playerName} \`${agidOption}\`` : `\`${agidOption}\``;
            } else {
                const link = getPlayerByDiscordId(targetUserOption.id);
                if (!link) {
                    return await ResponseManager.error(interaction, `${targetUserOption} não possui Alderon ID vinculado. Refaça o comando informando \`agid\`.`);
                }
                alderonId = link.alderon_id;
                targetLabel = `${targetUserOption} \`${alderonId}\``;
            }

            const { command, ingameActionResult, rconResponse } = await PunishmentSystem.applyIngameAction({
                guildId, jogoAct: level.action, targetId: targetUserOption?.id || null, alderonId,
                durationStr: level.duration_str || '', reason, levelName: level.name, staffTag: interaction.user.tag,
                reportId: null, actorMention: interaction.user.toString(), source: '/rcon-teste',
            });

            const succeeded = !!ingameActionResult?.startsWith('Ação in-game executada');
            const builder = new AdvancedContainerBuilder({ accentColor: succeeded ? COLORS.SUCCESS : COLORS.ERROR });
            builder.title(`${emojis.rcon || '🔗'} Teste de RCON — ${level.name}`, 2);
            builder.text(
                `**Alvo:** ${targetLabel}\n` +
                `**Nível:** ${level.name} (${level.severity}) → **Ação:** ${level.action}${level.duration_str ? ` (${level.duration_str})` : ''}\n` +
                `**Motivo testado:** ${reason}`
            );
            if (command) builder.text(`**Comando RCON enviado:**\n\`\`\`\n${command}\n\`\`\``);
            builder.text(`**Resultado:** ${ingameActionResult || 'Nada foi enviado.'}`);
            // Mensagem CRUA que o servidor do jogo respondeu (BUG REAL
            // corrigido, pedido do dono, 2026-08-19: "não consigo me banir
            // pra testar" — este comando já prometia mostrar "a mensagem
            // real que aparece pro jogador" desde que foi criado, mas nunca
            // exibia de verdade, só sucesso/falha do transporte RCON). É a
            // única forma de confirmar se o servidor ACEITOU o formato do
            // comando (ex: o timestamp de duração de um Ban/ServerMute) sem
            // precisar aplicar a ação numa conta de verdade — o servidor
            // pode não devolver nada (`rcon-client` cai pro texto 'OK'
            // nesse caso, ver PoTRconClient.sendCommand), então só mostra
            // esta linha quando existe algo além do genérico 'OK'.
            if (rconResponse && rconResponse !== 'OK') {
                builder.text(`**Resposta do servidor:**\n\`\`\`\n${rconResponse}\n\`\`\``);
            }
            builder.separator();
            builder.text(`${emojis.trianglealert || '⚠️'} **TESTE** — nenhuma punição foi registrada (não aparece em \`/historico\`, não afeta reputação).`);

            if (succeeded && (level.action === 'Ban' || level.action === 'ServerMute')) {
                builder.buttons(AdvancedContainerBuilder.dangerButton(
                    `punishment:undo-rcon-test:${level.action}:${alderonId}`,
                    '↩️ Desfazer (unban/unmute)',
                ));
            }

            await interaction.editReply(builder.build());
        } catch (error) {
            console.error('❌ Erro no /rcon-teste:', error);
            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao executar o teste de RCON. A equipe foi notificada.');
        }
    },
};
