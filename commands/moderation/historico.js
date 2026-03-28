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

        // ==========================================================
        // REMOVIDO: interaction.deferReply (Já feito no interactionCreate)
        // ==========================================================

        // 2. Inicializa a Sessão usando .create() (Nome correto do seu novo manager)
        session.create(interaction.user.id, { 
            type: 'history', 
            targetId: target.id,
            guildId: guildId 
        });

        try {
            // 3. Busca os dados
            const history = await PunishmentSystem.getUserHistory(guildId, target.id, 1);
            
            // 4. Gera a UI
            const embed = PunishmentSystem.generateHistoryEmbed(target, history, 1);
            const buttons = PunishmentSystem.generateHistoryButtons(target.id, 1, history.totalPages);

            // 5. USA editReply (Pois o deferReply já foi dado pelo evento principal)
            await interaction.editReply({ 
                embeds: [embed], 
                components: buttons ? [buttons] : [] 
            });

        } catch (err) {
            ErrorLogger.log('Command_Historico', err);
            console.error(`[History Error]`, err);
            
            // editReply aqui também para garantir
            await interaction.editReply({ 
                content: `${EMOJIS.ERRO || '❌'} **Falha ao carregar o histórico:**\n\`${err.message || 'Erro de conexão com o banco de dados.'}\`` 
            });
        }
    }
};