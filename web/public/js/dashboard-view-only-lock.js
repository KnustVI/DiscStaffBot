// Trava visualmente todo formulário de EDIÇÃO das páginas de Moderação/
// Reports/Eventos pra quem entrou no dashboard só com cargo de equipe (não
// Administrator) — pedido do dono, 2026-08-06. Só roda quando <body
// data-view-only="true"> (ver dashboard.js resolveAdminMember/isAdmin e
// partials/view-only-banner.ejs).
//
// Alvo é form[method="POST"] especificamente: é a convenção de sempre
// nestas 3 páginas (toda ação que GRAVA algo usa method="POST"; busca e
// paginação usam method="GET", ver partials/reports-list.ejs) — assim a
// busca de reports continua funcionando normalmente pra quem só visualiza.
//
// disabled = true de verdade (não só opacity via CSS): tira o foco por
// teclado, bloqueia digitação e exclui o campo do submit — o bloqueio REAL
// continua sendo no servidor (rotas POST exigem isAdmin), isto aqui é só
// a experiência de não conseguir nem tentar interagir.
(function () {
    if (document.body.dataset.viewOnly !== 'true') return;

    document.querySelectorAll('form[method="POST"] input, form[method="POST"] textarea, form[method="POST"] select, form[method="POST"] button')
        .forEach(function (el) { el.disabled = true; });
})();
