/* WoordWise — match.js
 * Pair EN ↔ NL cards by dragging OR tapping.
 * Requires base.js + offline.js + warmup.js + effects.js.
 *
 * Tap rules:
 *   - Tap a card → highlight it.
 *   - Tap the same card again → deselect.
 *   - Tap another card on the SAME side → move highlight to it.
 *   - Tap a card on the OTHER side → attempt the match.
 *   - Drag cancels any active selection.
 *
 * Correct pairs vanish; a wrong drop removes the dragged card and its real
 * partner. 10 pairs per session.
 */

(function () {
    'use strict';

    var SESSION_SIZE = 10;
    var CORRECT_FEEDBACK_MS = 700;
    var WRONG_FEEDBACK_MS = 1000;
    var DRAG_THRESHOLD_PX = 8;

    var CLS = {
        hover: 'is-hover',
        drag: 'is-dragging',
        correct: 'is-correct',
        wrong: 'is-wrong',
        gone: 'is-gone',
        selected: 'is-selected'
    };

    var ALL = [];
    var session = [];
    var consumed = 0;
    var okCount = 0;
    var badCount = 0;
    var locked = false;
    var audio = {};
    var reduceMotion = false;
    var selectedCard = null;

    var drag = {
        active: false,
        card: null,
        pointerId: null,
        startX: 0,
        startY: 0,
        side: null,
        hover: null,
        moved: false
    };

    var els = {};

    function $(id) { return document.getElementById(id); }
    function clearNode(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    /* ---------------- Progress + score ---------------- */

    function buildProgress(n) {
        clearNode(els.progress);
        for (var i = 0; i < n; i++) {
            var seg = document.createElement('span');
            seg.className = 'match-seg';
            els.progress.appendChild(seg);
        }
        if (els.progress.firstChild) els.progress.firstChild.classList.add('is-active');
    }

    function markProgress(i, kind) {
        var seg = els.progress.children[i];
        if (seg) {
            seg.classList.remove('is-active');
            seg.classList.add(kind === 'ok' ? 'is-ok' : 'is-bad');
        }
        var next = els.progress.children[i + 1];
        if (next) next.classList.add('is-active');
    }

    function updateScore() {
        els.scoreOk.textContent = okCount;
        els.scoreBad.textContent = badCount;
    }

    /* ---------------- Selection (tap mode) ---------------- */

    function setSelected(card) {
        if (selectedCard && selectedCard !== card) {
            selectedCard.classList.remove(CLS.selected);
        }
        selectedCard = card;
        if (card) card.classList.add(CLS.selected);
    }

    function clearSelected() {
        if (selectedCard) selectedCard.classList.remove(CLS.selected);
        selectedCard = null;
    }

    function handleTap(card) {
        if (!card || card.classList.contains(CLS.gone)) return;

        /* Same card → deselect */
        if (selectedCard === card) { clearSelected(); return; }

        /* Nothing selected → select this */
        if (!selectedCard) { setSelected(card); return; }

        /* Same side → move highlight */
        if (selectedCard.dataset.side === card.dataset.side) {
            setSelected(card);
            return;
        }

        /* Opposite side → attempt match */
        var first = selectedCard;
        clearSelected();
        resolveMatch(first, card);
    }

    /* ---------------- Flow ---------------- */

    function startFlow() {
        WoordWise.Warmup.categoryPicker({
            title: 'Match',
            subtitle: 'Which words do you want to practice?',
            categories: [
                { id: 'nouns', label: 'Nouns', hint: 'zelfstandige naamwoorden (de / het)' },
                { id: 'adjectives', label: 'Adjectives', hint: 'bijvoeglijke naamwoorden' },
                { id: 'verbs', label: 'Verbs', hint: 'werkwoorden' }
            ],
            storageKey: 'dutch.pool.match',
            onStart: function (selected) {
                if (!selected || !selected.length) return;
                loadAndBegin(selected);
            },
            onCancel: function () {
                location.href = 'index.html';
            }
        });
    }

    function loadAndBegin(groups) {
        showLoading();
        WoordWise.Offline.loadSelected(groups)
            .then(function (words) {
                if (!words.length) throw new Error('No words in the selected categories.');
                ALL = words;
                startSession();
            })
            .catch(function (err) {
                var msg = (err && err.message) ? err.message : 'unknown error';
                showError('Could not load word data (' + msg + ').');
            });
    }

    function showLoading() {
        clearNode(els.groupEn);
        clearNode(els.groupNl);
        var old = els.board.querySelector('.match-loading');
        if (old) old.parentNode.removeChild(old);

        var d = document.createElement('div');
        d.className = 'match-loading';
        d.textContent = 'Loading words\u2026';
        els.board.appendChild(d);
        els.board.classList.add('is-loading');
    }

    function showError(msg) {
        clearNode(els.groupEn);
        clearNode(els.groupNl);
        var old = els.board.querySelector('.match-loading');
        if (old) old.parentNode.removeChild(old);

        var d = document.createElement('div');
        d.className = 'match-loading match-loading-error';
        d.textContent = msg;
        els.board.appendChild(d);
        els.board.classList.add('is-loading');
    }

    /* ---------------- Session ---------------- */

    function startSession() {
        document.body.classList.remove('is-ended');
        if (!ALL.length) return;

        session = WoordWise.Offline.buildSession(ALL, SESSION_SIZE);
        consumed = 0;
        okCount = 0;
        badCount = 0;
        locked = false;
        clearSelected();

        drag.active = false;
        drag.card = null;
        drag.hover = null;
        drag.moved = false;

        updateScore();
        buildProgress(session.length);
        els.endScreen.hidden = true;

        renderBoard();
    }

    /* ---------------- Board ---------------- */

    function renderBoard() {
        var old = els.board.querySelector('.match-loading');
        if (old) old.parentNode.removeChild(old);
        els.board.classList.remove('is-loading');

        clearNode(els.groupEn);
        clearNode(els.groupNl);

        var enCards = [], nlCards = [];
        for (var i = 0; i < session.length; i++) {
            enCards.push({ pair: i, side: 'en', text: session[i].en });
            nlCards.push({ pair: i, side: 'nl', text: session[i].nl });
        }
        enCards = WoordWise.shuffle(enCards);
        nlCards = WoordWise.shuffle(nlCards);

        enCards.forEach(function (c) { els.groupEn.appendChild(makeCard(c)); });
        nlCards.forEach(function (c) { els.groupNl.appendChild(makeCard(c)); });

        requestAnimationFrame(function () {
            var cards = els.board.querySelectorAll('.match-card');
            for (var j = 0; j < cards.length; j++) {
                var textEl = cards[j].querySelector('.match-card-text');
                WoordWise.fitText(textEl, cards[j], { max: 18, min: 9, step: 1 });
            }
        });
    }

    function makeCard(c) {
        var el = document.createElement('div');
        el.className = 'match-card';
        el.dataset.pair = c.pair;
        el.dataset.side = c.side;
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', 'Card: ' + c.text);

        var s = document.createElement('span');
        s.className = 'match-card-text';
        s.textContent = c.text;
        el.appendChild(s);

        return el;
    }

    /* ---------------- Pointer: drag OR tap ---------------- */

    function onPointerDown(e) {
        if (locked) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        var card = e.target.closest('.match-card');
        if (!card) return;
        if (card.classList.contains(CLS.gone)) return;

        e.preventDefault();

        drag.active = true;
        drag.card = card;
        drag.pointerId = e.pointerId;
        drag.startX = e.clientX;
        drag.startY = e.clientY;
        drag.side = card.dataset.side;
        drag.moved = false;

        card.classList.add(CLS.drag);
        card.style.pointerEvents = 'none';
    }

    function onPointerMove(e) {
        if (!drag.active || e.pointerId !== drag.pointerId) return;

        var dx = e.clientX - drag.startX;
        var dy = e.clientY - drag.startY;

        if (!drag.moved) {
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < DRAG_THRESHOLD_PX) return;
            drag.moved = true;
            clearSelected();   /* real drag → discard tap selection */
        }

        drag.card.style.transform =
            'translate(' + dx + 'px, ' + dy + 'px) scale(1.04)';

        setHover(findDropTarget(e.clientX, e.clientY));
    }

    function onPointerUp(e) {
        if (!drag.active || e.pointerId !== drag.pointerId) return;

        var card = drag.card;
        var wasMove = drag.moved;
        var target = wasMove ? findDropTarget(e.clientX, e.clientY) : null;

        card.classList.remove(CLS.drag);
        card.style.transform = '';
        card.style.pointerEvents = '';

        setHover(null);

        drag.active = false;
        drag.card = null;
        drag.side = null;
        drag.pointerId = null;
        drag.moved = false;

        if (wasMove) {
            if (target) resolveMatch(card, target);
        } else {
            handleTap(card);
        }
    }

    function findDropTarget(x, y) {
        if (!drag.side) return null;
        var el = document.elementFromPoint(x, y);
        if (!el) return null;
        var card = el.closest('.match-card');
        if (!card) return null;
        if (card.classList.contains(CLS.gone)) return null;
        if (card.dataset.side === drag.side) return null;
        return card;
    }

    function setHover(el) {
        if (drag.hover === el) return;
        if (drag.hover) drag.hover.classList.remove(CLS.hover);
        drag.hover = el;
        if (el) el.classList.add(CLS.hover);
    }

    /* ---------------- Resolution ---------------- */

    function resolveMatch(dragged, target) {
        if (dragged.dataset.pair === target.dataset.pair) {
            handleCorrect(dragged, target);
        } else {
            handleWrong(dragged);
        }
    }

    function handleCorrect(a, b) {
        locked = true;
        okCount++;
        updateScore();
        markProgress(consumed, 'ok');
        WoordWise.playSound(audio, 'correct');

        a.classList.add(CLS.correct);
        b.classList.add(CLS.correct);

        var wait = reduceMotion ? 150 : CORRECT_FEEDBACK_MS;
        setTimeout(function () {
            goGone(a);
            goGone(b);
            consumed++;
            locked = false;
            checkEnd();
        }, wait);
    }

    function handleWrong(dragged) {
        locked = true;
        badCount++;
        updateScore();
        markProgress(consumed, 'bad');
        WoordWise.playSound(audio, 'incorrect');

        var partnerSide = dragged.dataset.side === 'en' ? 'nl' : 'en';
        var partner = els.board.querySelector(
            '.match-card[data-side="' + partnerSide + '"]' +
            '[data-pair="' + dragged.dataset.pair + '"]' +
            ':not(.' + CLS.gone + ')'
        );

        dragged.classList.add(CLS.wrong);
        if (partner) partner.classList.add(CLS.correct);

        var wait = reduceMotion ? 150 : WRONG_FEEDBACK_MS;
        setTimeout(function () {
            goGone(dragged);
            if (partner) goGone(partner);
            consumed++;
            locked = false;
            checkEnd();
        }, wait);
    }

    function goGone(el) {
        el.classList.add(CLS.gone);
        el.classList.remove(CLS.selected);
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('tabindex', '-1');
    }

    /* ---------------- End ---------------- */

    function checkEnd() {
        if (consumed >= session.length) setTimeout(showEnd, 400);
    }

    function showEnd() {
        document.body.classList.add('is-ended');

        var total = session.length;
        els.endScore.textContent = okCount + ' / ' + total;

        var parts = [];
        if (okCount) parts.push(okCount + ' correct');
        if (badCount) parts.push(badCount + ' wrong');
        els.endBreakdown.textContent = parts.join(' \u00B7 ');

        var pct = total ? okCount / total : 0;
        var msg;
        if (okCount === total) msg = 'Perfect! \uD83C\uDF89';
        else if (pct >= 0.8) msg = 'Great job!';
        else if (pct >= 0.5) msg = 'Nice \u2014 keep going.';
        else msg = 'Keep practicing!';
        els.endMsg.textContent = msg;

        els.endScreen.hidden = false;
        if (WoordWise.effects) WoordWise.effects.celebrate(okCount, total);
    }

    /* ---------------- Boot ---------------- */

    function init() {
        els.progress = $('progress');
        els.board = $('board');
        els.groupEn = $('group-en');
        els.groupNl = $('group-nl');
        els.scoreOk = $('score-ok');
        els.scoreBad = $('score-bad');
        els.endScreen = $('end-screen');
        els.endScore = $('end-score');
        els.endBreakdown = $('end-breakdown');
        els.endMsg = $('end-msg');

        try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
        catch (e) { reduceMotion = false; }

        audio = WoordWise.preloadSounds();

        els.board.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('pointercancel', onPointerUp);

        $('btn-again').addEventListener('click', function () {
            if (WoordWise.effects) WoordWise.effects.stop();
            startFlow();
        });

        startFlow();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();