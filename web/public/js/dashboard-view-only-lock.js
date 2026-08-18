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
//
// :not([data-staff-editable]) (pedido do dono, 2026-08-17): a seção de
// Buffs em moderacao.ejs é a 1ª exceção à regra "isAdmin" desta página —
// qualquer cargo de staff configurado pode mexer nela (mesma regra do
// Discord, ver buffPanelSystem.js), não só Administrador. Sem essa
// exceção, um staff não-admin veria os formulários de Buffs desabilitados
// mesmo o servidor aceitando a requisição. Marcador presente = sempre
// isento (moderacao.ejs só emite `data-staff-editable` dentro de um form
// que a própria rota do servidor já trata como staff-editável).
(function () {
    if (document.body.dataset.viewOnly !== 'true') return;

    document.querySelectorAll('form[method="POST"]:not([data-staff-editable]) input, form[method="POST"]:not([data-staff-editable]) textarea, form[method="POST"]:not([data-staff-editable]) select, form[method="POST"]:not([data-staff-editable]) button')
        .forEach(function (el) { el.disabled = true; });
})();
