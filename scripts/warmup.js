/* WoordWise — warmup.js
 * Reusable pre-game modal host.
 *
 * Two entry points:
 *
 * 1) Generic:
 *    WoordWise.Warmup.open({
 *      title, subtitle, startLabel, cancelLabel,
 *      build: function (body) {
 *          // Build DOM into `body`.
 *          // Return { validate: fn, getState: fn } (both optional).
 *          // `validate` is re-checked on every input/change event inside body.
 *          // `getState` is called on Start and its return value passed to onStart.
 *      },
 *      onStart: function (state) { ... },
 *      onCancel: function () { ... }
 *    });
 *
 * 2) Category-picker preset:
 *    WoordWise.Warmup.categoryPicker({
 *      title, subtitle,
 *      categories: [
 *        { id: 'nouns',      label: 'Nouns',      hint: '...' },
 *        { id: 'adjectives', label: 'Adjectives', hint: '...' },
 *        { id: 'verbs',      label: 'Verbs',      hint: '...' }
 *      ],
 *      storageKey: 'dutch.pool.spellit',   // remembers last selection
 *      onStart: function (selectedIds) { ... },
 *      onCancel: function () { ... }
 *    });
 *
 * Only one warmup modal can be open at a time. Opening a new one closes the old.
 */

(function () {
    'use strict';

    var current = null;    // { close: fn }
    var lastFocused = null;

    /* ---------------- Public API ---------------- */

    function open(config) {
        close();                            // in case one is already open

        config = config || {};

        lastFocused = document.activeElement;

        /* Backdrop + modal */
        var backdrop = document.createElement('div');
        backdrop.className = 'ww-warmup-backdrop';

        var modal = document.createElement('div');
        modal.className = 'ww-warmup-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');

        /* Close ✕ */
        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'ww-warmup-close';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = '\u00D7';

        /* Header */
        var title = document.createElement('h2');
        title.className = 'ww-warmup-title';
        title.textContent = config.title || 'Ready?';

        var sub = null;
        if (config.subtitle) {
            sub = document.createElement('p');
            sub.className = 'ww-warmup-sub';
            sub.textContent = config.subtitle;
        }

        /* Body — game content lives here */
        var body = document.createElement('div');
        body.className = 'ww-warmup-body';

        /* Footer */
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

        /* Build the game-specific content. */
        var built = null;
        if (typeof config.build === 'function') {
            try {
                built = config.build(body);
            } catch (e) {
                built = null;
            }
        }

        function isReady() {
            if (!built || typeof built.validate !== 'function') return true;
            try { return !!built.validate(); }
            catch (e) { return true; }
        }

        function refreshStart() {
            startBtn.disabled = !isReady();
        }

        /* Re-validate whenever anything inside body changes. */
        body.addEventListener('input', refreshStart);
        body.addEventListener('change', refreshStart);

        /* ---- Actions ---- */

        function doStart() {
            if (!isReady()) return;

            var state;
            if (built && typeof built.getState === 'function') {
                try { state = built.getState(); }
                catch (e) { state = undefined; }
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

        /* Click outside closes */
        backdrop.addEventListener('mousedown', function (e) {
            if (e.target === backdrop) doCancel();
        });

        /* Escape closes */
        function keyHandler(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                doCancel();
            }
        }
        document.addEventListener('keydown', keyHandler);

        /* Register as active */
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

        /* Focus first focusable element inside the modal. */
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

    function isOpen() {
        return !!current;
    }

    /* ---------------- Persistence helpers ---------------- */

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

        var filtered = parsed.filter(function (id) {
            return validIds.indexOf(id) !== -1;
        });
        return filtered.length ? filtered : validIds.slice();
    }

    function saveSelection(storageKey, ids) {
        if (!storageKey) return;
        try { localStorage.setItem(storageKey, JSON.stringify(ids)); }
        catch (e) { }
    }

    /* ---------------- Category-picker preset ---------------- */

    function categoryPicker(config) {
        config = config || {};
        var categories = Array.isArray(config.categories) ? config.categories : [];
        var validIds = categories.map(function (c) { return c.id; });
        var storageKey = config.storageKey;

        var selected = loadSelection(storageKey, validIds);

        return open({
            title: config.title,
            subtitle: config.subtitle,
            startLabel: config.startLabel || 'Start',
            cancelLabel: config.cancelLabel || 'Home',
            build: function (body) {
                var list = document.createElement('div');
                list.className = 'ww-warmup-list';

                var checkboxes = [];

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

                    var label = document.createElement('span');
                    label.className = 'ww-warmup-item-label';
                    label.textContent = cat.label || cat.id;

                    textWrap.appendChild(label);

                    if (cat.hint) {
                        var hint = document.createElement('span');
                        hint.className = 'ww-warmup-item-hint';
                        hint.textContent = cat.hint;
                        textWrap.appendChild(hint);
                    }

                    row.appendChild(cb);
                    row.appendChild(textWrap);
                    list.appendChild(row);

                    checkboxes.push({ id: cat.id, cb: cb });
                });

                body.appendChild(list);

                return {
                    validate: function () {
                        return checkboxes.some(function (x) { return x.cb.checked; });
                    },
                    getState: function () {
                        var sel = checkboxes
                            .filter(function (x) { return x.cb.checked; })
                            .map(function (x) { return x.id; });
                        saveSelection(storageKey, sel);
                        return sel;
                    }
                };
            },
            onStart: config.onStart,
            onCancel: config.onCancel
        });
    }

    window.WoordWise = window.WoordWise || {};
    window.WoordWise.Warmup = {
        open: open,
        close: close,
        isOpen: isOpen,
        categoryPicker: categoryPicker
    };

})();