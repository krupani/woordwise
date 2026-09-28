/* WoordWise — warmup.js
 * Reusable pre-game modal host.
 *
 * Two entry points:
 *
 * 1) Generic:
 *    WoordWise.Warmup.open({...})
 *
 * 2) Category picker:
 *    WoordWise.Warmup.categoryPicker({
 *      title, subtitle, categories, storageKey,
 *      modeSelector: {                       // optional
 *        storageKey: 'dutch.setting.<game>.mode',
 *        label: 'Mode',
 *        default: 'play',
 *        options: [
 *          { id: 'allWords',     label: 'All words' },
 *          { id: 'learntWords', label: 'Learnt words' }
 *        ]
 *      },
 *      hideCategoryList: false,              // optional — for verb-only games
 *      onStart: function (state) { ... },
 *      onCancel: function () { ... }
 *    });
 *
 * With modeSelector: onStart receives { categories, mode }.
 * Without:           onStart receives an array of category ids (legacy).
 *
 * Practice-mode validation: if mode === 'practice' and WoordWise.Learnt
 * is loaded, the picker checks that the selected categories have >= 10
 * non-mastered learnt words. Shows an inline message and disables Start
 * if not.
 */

(function () {
    'use strict';

    var current = null;
    var lastFocused = null;

    /* ---------------- Generic open ---------------- */

    function open(config) {
        close();
        config = config || {};
        lastFocused = document.activeElement;

        var backdrop = document.createElement('div');
        backdrop.className = 'ww-warmup-backdrop';

        var modal = document.createElement('div');
        modal.className = 'ww-warmup-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');

        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'ww-warmup-close';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = '\u00D7';

        var title = document.createElement('h2');
        title.className = 'ww-warmup-title';
        title.textContent = config.title || 'Ready?';

        var sub = null;
        if (config.subtitle) {
            sub = document.createElement('p');
            sub.className = 'ww-warmup-sub';
            sub.textContent = config.subtitle;
        }

        var body = document.createElement('div');
        body.className = 'ww-warmup-body';

        var footer = document.createElement('div');
        footer.className = 'ww-warmup-footer';

        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'ww-warmup-cancel';
        cancelBtn.textContent = config.cancelLabel || 'Home';

        var startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.className = 'ww-warmup-start';
        startBtn.textContent = config.startLabel || 'Start';

        footer.appendChild(cancelBtn);
        footer.appendChild(startBtn);

        modal.appendChild(closeBtn);
        modal.appendChild(title);
        if (sub) modal.appendChild(sub);
        modal.appendChild(body);
        modal.appendChild(footer);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        var built = null;
        if (typeof config.build === 'function') {
            try { built = config.build(body); } catch (e) { built = null; }
        }

        function isReady() {
            if (!built || typeof built.validate !== 'function') return true;
            try { return !!built.validate(); } catch (e) { return true; }
        }

        function refreshStart() { startBtn.disabled = !isReady(); }

        body.addEventListener('input', refreshStart);
        body.addEventListener('change', refreshStart);

        function doStart() {
            if (!isReady()) return;
            var state;
            if (built && typeof built.getState === 'function') {
                try { state = built.getState(); } catch (e) { state = undefined; }
            }
            close();
            if (typeof config.onStart === 'function') config.onStart(state);
        }

        function doCancel() {
            close();
            if (typeof config.onCancel === 'function') config.onCancel();
        }

        closeBtn.addEventListener('click', doCancel);
        cancelBtn.addEventListener('click', doCancel);
        startBtn.addEventListener('click', doStart);

        backdrop.addEventListener('mousedown', function (e) {
            if (e.target === backdrop) doCancel();
        });

        function keyHandler(e) {
            if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
        }
        document.addEventListener('keydown', keyHandler);

        current = {
            close: function () {
                document.removeEventListener('keydown', keyHandler);
                if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
                if (lastFocused && typeof lastFocused.focus === 'function') {
                    try { lastFocused.focus(); } catch (e) { }
                }
            }
        };

        refreshStart();

        setTimeout(function () {
            var target = modal.querySelector('input, button.ww-warmup-start');
            if (target) { try { target.focus(); } catch (e) { } }
        }, 30);
    }

    function close() {
        if (current && current.close) {
            try { current.close(); } catch (e) { }
        }
        current = null;
    }

    function isOpen() { return !!current; }

    /* ---------------- Persistence ---------------- */

    function loadSelection(storageKey, validIds) {
        if (!storageKey) return validIds.slice();
        var raw;
        try { raw = localStorage.getItem(storageKey); }
        catch (e) { return validIds.slice(); }
        if (!raw) return validIds.slice();
        var parsed;
        try { parsed = JSON.parse(raw); }
        catch (e) { return validIds.slice(); }
        if (!Array.isArray(parsed)) return validIds.slice();
        var filtered = parsed.filter(function (id) { return validIds.indexOf(id) !== -1; });
        return filtered.length ? filtered : validIds.slice();
    }

    function saveSelection(storageKey, ids) {
        if (!storageKey) return;
        try { localStorage.setItem(storageKey, JSON.stringify(ids)); } catch (e) { }
    }

    function loadMode(modeSelector) {
        var dflt = modeSelector.default
            || (modeSelector.options[0] && modeSelector.options[0].id)
            || 'play';
        if (!modeSelector.storageKey) return dflt;
        try {
            var v = localStorage.getItem(modeSelector.storageKey);
            var valid = modeSelector.options.some(function (o) { return o.id === v; });
            return valid ? v : dflt;
        } catch (e) { return dflt; }
    }

    function saveMode(modeSelector, mode) {
        if (!modeSelector.storageKey) return;
        try { localStorage.setItem(modeSelector.storageKey, mode); } catch (e) { }
    }

    /* ---------------- Category picker preset ---------------- */

    function categoryPicker(config) {
        config = config || {};
        var categories = Array.isArray(config.categories) ? config.categories : [];
        var validIds = categories.map(function (c) { return c.id; });
        var storageKey = config.storageKey;
        var modeSelector = config.modeSelector || null;
        var hideCategoryList = !!config.hideCategoryList;

        var selected = loadSelection(storageKey, validIds);
        var mode = modeSelector ? loadMode(modeSelector) : null;

        return open({
            title: config.title,
            subtitle: config.subtitle,
            startLabel: config.startLabel || 'Start',
            cancelLabel: config.cancelLabel || 'Home',
            build: function (body) {
                var checkboxes = [];
                var hint = null;

                function triggerValidate() {
                    body.dispatchEvent(new Event('change', { bubbles: true }));
                }

                /* Mode selector (Play / Practice) — rendered above categories. */
                if (modeSelector) {
                    body.appendChild(buildModeControl(modeSelector, mode, function (newMode) {
                        mode = newMode;
                        triggerValidate();
                    }));
                }

                /* Category checkboxes */
                if (!hideCategoryList) {
                    var list = document.createElement('div');
                    list.className = 'ww-warmup-list';

                    categories.forEach(function (cat) {
                        var row = document.createElement('label');
                        row.className = 'ww-warmup-item';

                        var cb = document.createElement('input');
                        cb.type = 'checkbox';
                        cb.className = 'ww-warmup-check';
                        cb.value = cat.id;
                        cb.checked = selected.indexOf(cat.id) !== -1;

                        var textWrap = document.createElement('span');
                        textWrap.className = 'ww-warmup-item-text';

                        var labelEl = document.createElement('span');
                        labelEl.className = 'ww-warmup-item-label';
                        labelEl.textContent = cat.label || cat.id;
                        textWrap.appendChild(labelEl);

                        if (cat.hint) {
                            var hintEl = document.createElement('span');
                            hintEl.className = 'ww-warmup-item-hint';
                            hintEl.textContent = cat.hint;
                            textWrap.appendChild(hintEl);
                        }

                        row.appendChild(cb);
                        row.appendChild(textWrap);
                        list.appendChild(row);

                        checkboxes.push({ id: cat.id, cb: cb });
                    });

                    body.appendChild(list);
                }

                hint = document.createElement('p');
                hint.className = 'ww-warmup-hint';
                body.appendChild(hint);

                function getSelectedIds() {
                    if (hideCategoryList && categories.length) {
                        return categories.map(function (c) { return c.id; });
                    }
                    return checkboxes
                        .filter(function (x) { return x.cb.checked; })
                        .map(function (x) { return x.id; });
                }

                return {
                    validate: function () {
                        var sel = getSelectedIds();

                        if (!sel.length) {
                            hint.classList.add('err');
                            hint.textContent = 'Pick at least one category.';
                            return false;
                        }

                        if (modeSelector && mode === 'practice') {
                            var available = (WoordWise.Learnt && typeof WoordWise.Learnt.getForPractice === 'function')
                                ? WoordWise.Learnt.getForPractice(sel, 999).length
                                : 0;
                            if (available < 10) {
                                hint.classList.add('err');
                                hint.textContent = (available === 0)
                                    ? 'No learnt words yet in the selected categories. Build your Vocabulary first.'
                                    : 'Practice needs 10 learnt words. You currently have ' + available + '.';
                                return false;
                            }
                        }

                        hint.classList.remove('err');
                        hint.textContent = '';
                        return true;
                    },
                    getState: function () {
                        var sel = getSelectedIds();
                        if (!hideCategoryList) saveSelection(storageKey, sel);
                        if (modeSelector) {
                            saveMode(modeSelector, mode);
                            return { categories: sel, mode: mode };
                        }
                        return sel;
                    }
                };
            },
            onStart: config.onStart,
            onCancel: config.onCancel
        });
    }

    function buildModeControl(modeSelector, currentMode, onChange) {
        var wrap = document.createElement('div');
        wrap.className = 'ww-warmup-section';

        var label = document.createElement('span');
        label.className = 'ww-warmup-label';
        label.textContent = modeSelector.label || 'Mode';
        wrap.appendChild(label);

        var seg = document.createElement('div');
        seg.className = 'ww-warmup-seg';

        var btns = {};
        modeSelector.options.forEach(function (opt) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = opt.label;
            b.dataset.mode = opt.id;
            if (opt.hint) b.title = opt.hint;
            seg.appendChild(b);
            btns[opt.id] = b;
        });
        wrap.appendChild(seg);

        /* Dynamic helper text — shows the selected option's hint. */
        var helper = document.createElement('p');
        helper.className = 'ww-warmup-helper';
        wrap.appendChild(helper);

        function updateHelper() {
            var active = modeSelector.options.filter(function (o) { return o.id === currentMode; })[0];
            helper.textContent = (active && active.hint) || '';
        }

        function refresh() {
            Object.keys(btns).forEach(function (k) {
                btns[k].classList.toggle('is-active', k === currentMode);
            });
            updateHelper();
        }
        refresh();

        Object.keys(btns).forEach(function (k) {
            btns[k].addEventListener('click', function () {
                currentMode = k;
                refresh();
                onChange(k);
            });
        });

        return wrap;
    }

    window.WoordWise = window.WoordWise || {};
    window.WoordWise.Warmup = {
        open: open,
        close: close,
        isOpen: isOpen,
        categoryPicker: categoryPicker
    };

})();