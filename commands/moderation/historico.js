const { SlashCommandBuilder } = require('discord.js');
const PunishmentSystem = require('../../systems/punishmentSystem');
const ErrorLogger = require('../../systems/errorLogger');
const { EMOJIS } = require('../../database/emojis');
const session = require('../../systems/sessionManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Consulta a reputação e punições de um usuário.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a consultar').setRequired(true)),

    async execute(interaction) {
        const target = interaction.options.getUser('usuario');
        const guildId = interaction.guildId;

        // 1. Sinaliza ao Discord que estamos processando (Evita o erro de 3s)
        await interaction.deferReply({ ephemeral: true });

        // 2. Inicializa a Sessão para Navegação (Paginação)
        // Usando o padrão .set() do novo sessionManager
        session.set(interaction.user.id, { 
            type: 'history', 
            targetId: target.id,
            guildId: guildId 
        });

        try {
            // 3. Busca os dados usando o Motor do PunishmentSystem (Página 1)
            const history = await PunishmentSystem.getUserHistory(guildId, target.id, 1);
            
            // 4. Gera a Embed e os Botões usando os Helpers
            // Mantendo suas funções originais de geração de UI
            const embed = PunishmentSystem.generateHistoryEmbed(target, history, 1);
            const buttons = PunishmentSystem.generateHistoryButtons(target.id, 1, history.totalPages);

            // 5. Edita a resposta inicial com os dados carregados
            await interaction.editReply({ 
                embeds: [embed], 
                components: buttons ? [buttons] : [] 
            });

        } catch (err) {
            // Log de Sistema e Resposta de Erro Visual
            ErrorLogger.log('Command_Historico', err);
            console.error(`[History Error]`, err);
            
            await interaction.editReply({ 
                content: `${EMOJIS.ERRO || '❌'} **Falha ao carregar o histórico:**\n\`${err.message || 'Erro de conexão com o banco de dados.'}\`` 
            });
        }
    }
};