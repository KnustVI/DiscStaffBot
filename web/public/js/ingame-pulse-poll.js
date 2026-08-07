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
        // category (pedido do dono, 2026-08-07: roster separado por página
        // — Moderação só mostra Moderador/Supervisor, Eventos só mostra
        // Equipe de Eventos, ver dashboard.js getServerPulse) — opcional,
        // páginas sem data-category (ex: Reports, que nem mostra o roster)
        // caem no comportamento antigo no servidor.
        var category = root.dataset.category || '';

        function refresh() {
            // Preserva o card de staff (partials/ingame-pulse.ejs) ABERTO
            // entre polls — sem isso, o innerHTML inteiro é trocado a cada
            // 15s por HTML novo do servidor, que SEMPRE renderiza o
            // <details> fechado (estado padrão); quem tivesse aberto pra
            // olhar a lista veria ela fechar sozinha no meio da leitura.
            var wasOpen = false;
            var existingCard = root.querySelector('.staff-list-card');
            if (existingCard) wasOpen = existingCard.hasAttribute('open');

            fetch('/fragments/ingame-pulse/' + guildId + '?showRoster=' + showRoster + '&category=' + category)
                .then(function (res) { return res.ok ? res.text() : null; })
                .then(function (html) {
                    if (!html) return; // falha silenciosa — mantém o que já está na tela
                    root.innerHTML = html;
                    if (wasOpen) {
                        var newCard = root.querySelector('.staff-list-card');
                        if (newCard) newCard.setAttribute('open', '');
                    }
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
