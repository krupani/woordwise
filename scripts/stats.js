/* WoordWise — stats.js
 * Hidden maintenance modal, opened by long-pressing the version number
 * on the home page. Shows counts of every cache in localStorage and
 * offers per-section clearing.
 *
 * Load AFTER base.js + learnt.js + cache.js.
 * Only does anything if a #version-display element exists (i.e. index.html).
 */

(function () {
    'use strict';

    var LONG_PRESS_MS = 5000;
    var MOVEMENT_PX = 12;

    var modalEl = null;

    function $(sel, root) { return (root || document).querySelector(sel); }
    function clearNode(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    /* ---------------- Long-press ---------------- */

    function attachLongPress(el, onLongPress) {
        var timer = null;
        var startX = 0, startY = 0;

        function begin(e) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;

            startX = e.clientX;
            startY = e.clientY;
            el.classList.add('is-pressing');

            timer = setTimeout(function () {
                timer = null;
                el.classList.remove('is-pressing');
                onLongPress();
            }, LONG_PRESS_MS);
        }

        function cancel() {
            if (timer) { clearTimeout(timer); timer = null; }
            el.classList.remove('is-pressing');
        }

        function move(e) {
            if (!timer) return;
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            if (Math.sqrt(dx * dx + dy * dy) > MOVEMENT_PX) cancel();
        }

        el.addEventListener('pointerdown', begin);
        el.addEventListener('pointerup', cancel);
        el.addEventListener('pointercancel', cancel);
        el.addEventListener('pointerleave', cancel);
        el.addEventListener('pointermove', move);
    }

    /* ---------------- Modal lifecycle ---------------- */

    function openStats() {
        if (modalEl) return;

        modalEl = document.createElement('div');
        modalEl.className = 'ww-modal-backdrop';

        var inner = document.createElement('div');
        inner.className = 'ww-modal ww-stats-modal';

        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'ww-modal-close';
        close.setAttribute('aria-label', 'Close');
        close.textContent = '\u00D7';
        close.addEventListener('click', closeStats);
        inner.appendChild(close);

        var h = document.createElement('h2');
        h.textContent = 'Data';
        inner.appendChild(h);

        var sub = document.createElement('p');
        sub.className = 'ww-modal-sub';
        sub.textContent = 'WoordWise v' + (window.WOORDWISE_VERSION || '?');
        inner.appendChild(sub);

        var body = document.createElement('div');
        body.className = 'ww-stats-body';
        renderBody(body);
        inner.appendChild(body);

        modalEl.appendChild(inner);
        document.body.appendChild(modalEl);

        modalEl.addEventListener('mousedown', function (e) {
            if (e.target === modalEl) closeStats();
        });

        document.addEventListener('keydown', onKey);
    }

    function closeStats() {
        document.removeEventListener('keydown', onKey);
        if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
        modalEl = null;
    }

    function onKey(e) {
        if (e.key === 'Escape') closeStats();
    }

    /* ---------------- Rendering ---------------- */

    function renderBody(container) {
        clearNode(container);

        container.appendChild(buildKeysSection());
        container.appendChild(buildLearntSection());
        container.appendChild(buildCacheSection(
            'Cached sentences',
            'Used by Re-Order and Sentence when the AI is unreachable.',
            WoordWise.Cache ? WoordWise.Cache.buckets('sentences') : [],
            function () { WoordWise.Cache.clearNamespace('sentences'); }
        ));
        container.appendChild(buildCacheSection(
            'Niet / Geen cache',
            'Used by Niet / Geen when the AI is unreachable.',
            WoordWise.Cache ? WoordWise.Cache.buckets('nietgeen') : [],
            function () { WoordWise.Cache.clearNamespace('nietgeen'); }
        ));
        container.appendChild(buildDangerZone());
    }

    function buildSection(title, hint, rows, onClear, clearLabel) {
        var section = document.createElement('div');
        section.className = 'ww-stats-section';

        var h = document.createElement('h3');
        h.className = 'ww-stats-section-title';
        h.textContent = title;
        section.appendChild(h);

        if (hint) {
            var p = document.createElement('p');
            p.className = 'ww-stats-section-hint';
            p.textContent = hint;
            section.appendChild(p);
        }

        var list = document.createElement('div');
        list.className = 'ww-stats-list';
        rows.forEach(function (row) {
            var r = document.createElement('div');
            r.className = 'ww-stats-row';

            var left = document.createElement('span');
            left.className = 'ww-stats-row-label';
            left.textContent = row.label;

            var right = document.createElement('span');
            right.className = 'ww-stats-row-value';
            if (row.tone) right.classList.add('is-' + row.tone);
            right.textContent = row.value;

            r.appendChild(left);
            r.appendChild(right);
            list.appendChild(r);
        });
        section.appendChild(list);

        if (onClear) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ww-stats-clear';
            btn.textContent = clearLabel || 'Clear';
            btn.addEventListener('click', function () {
                if (!window.confirm('Clear this data? This cannot be undone.')) return;
                onClear();
                rerender();
            });
            section.appendChild(btn);
        }

        return section;
    }

    function rerender() {
        var body = $('.ww-stats-body');
        if (body) renderBody(body);
    }

    function buildKeysSection() {
        var providers = (WoordWise.Online && WoordWise.Online.PROVIDERS) || [];
        var rows = providers.map(function (p) {
            var saved = false;
            try { saved = !!localStorage.getItem(p.keyStorage); } catch (e) { }
            return {
                label: p.label,
                value: saved ? '\u2713 saved' : 'not set',
                tone: saved ? 'ok' : null
            };
        });
        if (!rows.length) rows.push({ label: '(none)', value: '' });
        return buildSection(
            'API keys',
            'Managed in the AI settings modal. Not affected by the buttons below.',
            rows,
            null
        );
    }

    function buildLearntSection() {
        if (!WoordWise.Learnt) {
            return buildSection('Learnt words', 'Learnt module not loaded.', [], null);
        }

        var stats = WoordWise.Learnt.stats();
        var rows = [];
        var total = 0, totalWrong = 0;

        ['nouns', 'adjectives', 'verbs'].forEach(function (cat) {
            var s = (stats.categories && stats.categories[cat]) || { total: 0, wrong: 0, mastered: 0 };
            var label = cat.charAt(0).toUpperCase() + cat.slice(1);
            var value = s.total + (s.wrong ? ' \u00B7 ' + s.wrong + ' to review' : '');
            rows.push({ label: label, value: value, tone: s.wrong ? 'warn' : null });
            total += s.total;
            totalWrong += s.wrong;
        });

        rows.push({
            label: 'Total',
            value: total + (totalWrong ? ' \u00B7 ' + totalWrong + ' to review' : ''),
            tone: totalWrong ? 'warn' : null
        });

        return buildSection(
            'Learnt words',
            'Tracked by Vocabulary. Used by Practice mode in Match, Conjugate, Spell It.',
            rows,
            function () { WoordWise.Learnt.clearAll(); },
            'Clear all learnt words'
        );
    }

    function buildCacheSection(title, hint, bucketList, onClear) {
        var rows = [];
        var total = 0;

        if (bucketList && bucketList.length) {
            bucketList.forEach(function (b) {
                rows.push({ label: b.name, value: String(b.count) });
                total += b.count;
            });
            rows.push({ label: 'Total', value: String(total) });
        } else {
            rows.push({ label: '(empty)', value: '0' });
        }

        return buildSection(title, hint, rows, onClear, 'Clear');
    }

    function buildDangerZone() {
        var section = document.createElement('div');
        section.className = 'ww-stats-section ww-stats-danger';

        var h = document.createElement('h3');
        h.className = 'ww-stats-section-title';
        h.textContent = 'Danger zone';
        section.appendChild(h);

        var p = document.createElement('p');
        p.className = 'ww-stats-section-hint';
        p.textContent = 'Clears learnt words and all cached sentences. API keys and preferences are kept.';
        section.appendChild(p);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ww-stats-clear ww-stats-clear-all';
        btn.textContent = 'Clear everything';
        btn.addEventListener('click', function () {
            if (!window.confirm('Clear all learnt words and cached sentences? This cannot be undone.')) return;
            if (WoordWise.Learnt) WoordWise.Learnt.clearAll();
            if (WoordWise.Cache) WoordWise.Cache.clearAll();
            rerender();
        });
        section.appendChild(btn);

        return section;
    }

    /* ---------------- Boot ---------------- */

    function init() {
        var v = document.getElementById('version-display');
        if (!v) return;
        attachLongPress(v, openStats);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.WoordWise = window.WoordWise || {};
    window.WoordWise.Stats = {
        open: openStats,
        close: closeStats
    };

})();