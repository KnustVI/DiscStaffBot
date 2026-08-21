// src/systems/pot/ongoingSessionCreditWorker.js
/**
 * Worker periódico de checkpoint de moeda pra sessões AINDA EM ANDAMENTO
 * (pedido do dono, 2026-08-20: "estou com 7 horas de jogo no atlas e 5
 * caçadas no total... não seria interessante fazer uma contagem por hora
 * de jogo completa que fica já resgistrado como hora de jogo nos
 * servidores?"). Ver docblock completo de
 * PlayerRegistry.creditOngoingSessions (potPlayerRegistry.js) pro porquê
 * do gap existir sem isto — resumindo: Caçadas/Ossos/XP só eram
 * creditados quando uma sessão FECHAVA, então um jogador conectado por
 * horas seguidas sem desconectar ficava com 0 de crédito até finalmente
 * sair, mesmo com as horas já aparecendo em tempo real no /perfil.
 *
 * Arquivo separado (mesmo padrão de onlineStatusWorker.js) mas
 * DELIBERADAMENTE independente dele: não depende de Source Query nem de
 * `game_port` configurado — roda pra QUALQUER guild com jogador
 * is_online=1 no banco (webhook sozinho já basta), consultando
 * pot_players direto em vez de iterar guild por guild.
 *
 * Intervalo de 15min: frequente o bastante pra fechar a maior parte do
 * gap relatado (na pior das hipóteses, ~15min de atraso em vez de horas),
 * sem gerar volume de escrita desnecessário no banco pra cada tick.
 */
'use strict';

const cron = require('node-cron');
const PlayerRegistry = require('./potPlayerRegistry');

function startOngoingSessionCreditWorker() {
    console.log('💰 [OngoingSessionCreditWorker] Checkpoint periódico de Caçadas/Ossos/XP em sessão iniciado — 15min');

    cron.schedule('*/15 * * * *', () => {
        try {
            const credited = PlayerRegistry.creditOngoingSessions();
            if (credited > 0) {
                console.log(`💰 [OngoingSessionCreditWorker] Checkpoint aplicado a ${credited} jogador(es) online.`);
            }
        } catch (error) {
            console.error('❌ [OngoingSessionCreditWorker] Erro no checkpoint periódico:', error.message);
        }
    });
}

module.exports = { startOngoingSessionCreditWorker };
