// Poller genérico: qualquer elemento com [data-poll-url] busca o fragmento
// renderizado no servidor a cada 15s e substitui seu próprio innerHTML.
// Usado por #moderationStatsRoot e #reportsListRoot (ver dashboard.js e
// moderacao.ejs/reports.ejs). Mesma cadência do padrão já usado em
// ingame-pulse-poll.js.
(function () {
    var POLL_MS = 15000;

    function initPoller(root) {
        var url = root.dataset.pollUrl;
        if (!url) return;

        function refresh() {
            fetch(url)
                .then(function (res) { return res.ok ? res.text() : null; })
                .then(function (html) {
                    if (!html) return;
                    root.innerHTML = html;
                    if (window.lucide) window.lucide.createIcons();
                })
                .catch(function () {});
        }

        setInterval(refresh, POLL_MS);
    }

    function boot() {
        document.querySelectorAll('[data-poll-url]').forEach(initPoller);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
