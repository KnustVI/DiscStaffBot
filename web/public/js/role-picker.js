// web/public/js/role-picker.js
// Comportamento de todo [data-role-picker] da página (ver partials/
// role-picker.ejs) — adicionar/remover cargo vira chip, sem reload, até o
// limite do tier (data-limit). Um script só cobre quantos pickers a página
// tiver (ex: Moderador + Supervisor em moderacao.ejs).
(function () {
    function initPicker(root) {
        var dataEl = root.querySelector('script.role-picker-data');
        var roles = [];
        try { roles = JSON.parse(dataEl.textContent); } catch (err) { roles = []; }

        var name = root.getAttribute('data-name');
        var limit = parseInt(root.getAttribute('data-limit'), 10) || 1;
        var chipsEl = root.querySelector('[data-chips]');
        var rowEl = root.querySelector('[data-row]');
        var selectEl = root.querySelector('[data-select]');
        var addBtn = root.querySelector('[data-add]');
        var counterEl = root.querySelector('[data-counter]');

        function selectedIds() {
            return Array.from(chipsEl.querySelectorAll('.role-chip')).map(function (c) {
                return c.getAttribute('data-role-id');
            });
        }

        function refreshSelectOptions() {
            var chosen = selectedIds();
            var current = selectEl.value;
            selectEl.innerHTML = '';
            var placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '— selecione um cargo —';
            selectEl.appendChild(placeholder);
            roles.forEach(function (r) {
                if (chosen.indexOf(r.id) !== -1) return;
                var opt = document.createElement('option');
                opt.value = r.id;
                opt.textContent = r.name;
                selectEl.appendChild(opt);
            });
            if (chosen.indexOf(current) === -1) selectEl.value = current;
        }

        function refreshCounterAndRow() {
            var count = selectedIds().length;
            counterEl.textContent = count + '/' + limit + ' cargos';
            rowEl.style.display = count >= limit ? 'none' : '';
        }

        function addChip(roleId, roleName) {
            var chip = document.createElement('span');
            chip.className = 'role-chip';
            chip.setAttribute('data-role-id', roleId);
            chip.innerHTML =
                '<span class="role-chip-name"></span>' +
                '<button type="button" class="role-chip-remove" aria-label="Remover cargo"><i data-lucide="x"></i></button>' +
                '<input type="hidden" name="' + name + '" value="' + roleId + '">';
            chip.querySelector('.role-chip-name').textContent = roleName;
            chipsEl.appendChild(chip);
            if (window.lucide) window.lucide.createIcons();
        }

        addBtn.addEventListener('click', function () {
            var roleId = selectEl.value;
            if (!roleId) return;
            if (selectedIds().length >= limit) return;
            var role = roles.find(function (r) { return r.id === roleId; });
            if (!role) return;
            addChip(role.id, role.name);
            refreshSelectOptions();
            refreshCounterAndRow();
        });

        chipsEl.addEventListener('click', function (e) {
            var btn = e.target.closest('.role-chip-remove');
            if (!btn) return;
            var chip = btn.closest('.role-chip');
            if (!chip) return;
            chip.remove();
            refreshSelectOptions();
            refreshCounterAndRow();
        });
    }

    document.querySelectorAll('[data-role-picker]').forEach(initPicker);
})();
