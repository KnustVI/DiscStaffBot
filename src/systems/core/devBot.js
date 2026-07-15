// src/systems/core/devBot.js
/**
 * Bot de developer — Application SEPARADA no Discord Developer Portal (token/
 * CLIENT_ID próprios, ver DEV_TOKEN/DEV_CLIENT_ID no .env), convidada só no
 * servidor privado do dono (DEV_GUILD_ID). Carrega SÓ os comandos de
 * src/commands/developer/*.js — reset-db, reset-reports, premium-admin,
 * combat-config — que deixaram de ser comandos do bot principal (ver
 * index.js) exatamente pra sumirem da lista de comandos de qualquer staff
 * de qualquer servidor de cliente, não só ficarem "recusados depois de
 * clicar" como antes.
 *
 * Roda no MESMO processo do bot principal (mesmo banco de dados, sem
 * duplicar nenhuma lógica de negócio) — só o client/token/registro de
 * comando são de fato separados. Os comandos de developer recebem o CLIENT
 * PRINCIPAL como segundo argumento de execute(interaction, client) (não este
 * client privado): é o principal quem está em todo servidor de cliente, então
 * client.guilds.cache.get(servidorId) continua funcionando exatamente como
 * antes, só que a partir de um `servidor_id` passado como parâmetro em vez
 * de interaction.guild (que aqui sempre é o servidor PRIVADO, nunca o
 * servidor alvo). A resposta da interação (editReply) sempre sai pelo
 * webhook da própria interação — webhook de aplicação, não depende de qual
 * client buscou os dados — então aparece corretamente como ESTE bot privado,
 * mesmo usando o client principal por baixo pra tudo que é specific de guild.
 *
 * Falha em silêncio se DEV_TOKEN não estiver configurado — mesmo padrão já
 * usado pro dashboard/integração PoT em ready.js: recurso opcional, não pode
 * impedir o bot principal de subir.
 */
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const ResponseManager = require('../../utils/responseManager');
const { sendSystemLog } = require('./systemLog');

function loadDevCommands() {
    const commands = new Collection();
    const commandsPath = path.join(__dirname, '..', '..', 'commands', 'developer');
    if (!fs.existsSync(commandsPath)) return commands;

    for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
        try {
            const command = require(path.join(commandsPath, file));
            if ('data' in command && 'execute' in command) {
                commands.set(command.data.name, command);
            }
        } catch (error) {
            console.error(`❌ [DevBot] Erro ao carregar comando ${file}:`, error.message);
        }
    }
    return commands;
}

/**
 * @param {import('discord.js').Client} mainClient - client do bot principal,
 *   já logado e em todo servidor de cliente. Passado pra dentro de todo
 *   command.execute() dos comandos de developer.
 * @returns {import('discord.js').Client|null} o client do bot developer, ou
 *   null se DEV_TOKEN não estiver configurado (recurso não ativado).
 */
function startDevBot(mainClient) {
    const token = process.env.DEV_TOKEN;
    if (!token) {
        console.log('ℹ️ [DevBot] DEV_TOKEN não configurado — bot de developer não iniciado.');
        return null;
    }

    const devClient = new Client({ intents: [GatewayIntentBits.Guilds] });
    devClient.commands = loadDevCommands();

    devClient.once('clientReady', () => {
        console.log(`🔒 [DevBot] Logado como ${devClient.user.tag} — ${devClient.commands.size} comando(s) de developer carregado(s)`);
    });

    devClient.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const command = devClient.commands.get(interaction.commandName);
        if (!command) {
            return ResponseManager.error(interaction, 'Comando não encontrado.');
        }

        try {
            // Sempre ephemeral — não existe versão "pública" de comando de
            // developer (mesmo padrão já usado pra estes 4 comandos no bot
            // principal antes desta separação).
            await interaction.deferReply({ flags: 64 });
            await command.execute(interaction, mainClient);

            sendSystemLog(mainClient, (b) => {
                b.title('🛠️ Comando de Developer', 2);
                b.text(
                    `**Comando:** \`/${interaction.commandName}\`\n` +
                    `**Usuário:** ${interaction.user.tag} \`${interaction.user.id}\``
                );
                b.footer('Bot de Developer');
            });
        } catch (error) {
            console.error(`❌ [DevBot] Erro ao executar /${interaction.commandName}:`, error);
            await ResponseManager.error(interaction, 'Ocorreu um erro ao executar este comando.').catch(() => {});
        }
    });

    devClient.login(token).catch((error) => {
        console.error('❌ [DevBot] Erro ao fazer login:', error.message);
    });

    return devClient;
}

module.exports = { startDevBot };
