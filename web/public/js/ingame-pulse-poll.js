// web/public/js/ingame-pulse-poll.js
// Atualiza o componente "IN GAME" (donuts + status de staff) sozinho, sem
// recarregar a página — pedido do dono ("se possível que ele atualize em
// tempo real"). Poll simples (não WebSocket): busca o partial já
// renderizado de novo no servidor (/fragments/ingame-pulse/:guildID, ver
// dashboard.js) e troca o innerHTML do container inteiro — reaproveita
// 100% da mesma renderização EJS usada no carregamento normal da página,
// em vez de duplicar a lógica de montar donuts/chips aqui em JS.
(function () {
    var POLL_MS = 15000;

    function boot() {
        var root = document.getElementById('ingamePulseRoot');
        if (!root) return;

        var guildId = root.dataset.guildId;
        var showRoster = root.dataset.showRoster !== 'false';

        function refresh() {
            fetch('/fragments/ingame-pulse/' + guildId + '?showRoster=' + showRoster)
                .then(function (res) { return res.ok ? res.text() : null; })
                .then(function (html) {
                    if (!html) return; // falha silenciosa — mantém o que já está na tela
                    root.innerHTML = html;
                    if (window.lucide) window.lucide.createIcons();
                })
                .catch(function () { /* rede caiu por um instante — próximo poll tenta de novo */ });
        }

        setInterval(refresh, POLL_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
