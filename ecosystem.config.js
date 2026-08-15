// ecosystem.config.js
//
// Configuração do PM2 pro processo único do bot — Discord.js (gateway) +
// dashboard web (Express) + SQLite (better-sqlite3) + processamento de
// imagem (sharp), tudo rodando junto no mesmo processo Node (ver CLAUDE.md).
//
// Pedido do dono (2026-08-15, depois de corrigir a falta de retry/log na
// resolução de imagens): "não deveriamos ter talvez uma manutenção para
// melhorar esses processo?" — duas camadas de proteção contra o processo
// degradar/travar aos poucos por pressão de memória na VPS (952MB RAM +
// 2GB de swap desde 2026-08-11, ver memória vps_low_memory_no_swap_freeze —
// incidente anterior de "Invalid Webhook Token" já rastreado até esse
// mesmo mecanismo):
//   - max_memory_restart: reinicia sozinho SE o processo passar desse teto
//     de memória, na hora que acontece, não importa o horário. Ataca a
//     causa raiz (memória alta -> GC trava a thread principal) antes dela
//     virar um travamento visível.
//   - cron_restart: reinicia de qualquer forma 1x por dia, de madrugada
//     (pouco jogador online) — limpeza preventiva, mesmo que a memória
//     nunca bata no teto acima.
//
// 600M é um ponto de partida, não um número medido — ajuste depois de
// observar o uso real (`pm2 list`, coluna MEM) por alguns dias: se o
// contador de reinícios (coluna ↺ de `pm2 status`) subir muito mais que 1
// por dia, o teto tá baixo demais pro uso normal do processo, suba pra
// 700M/750M.
module.exports = {
    apps: [
        {
            name: 'discord-bot',
            script: 'index.js',
            cwd: __dirname,
            max_memory_restart: '600M',
            cron_restart: '0 6 * * *',
        },
    ],
};
