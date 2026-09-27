/* WoordWise — reorder.js
 * Unscramble an A2 Dutch sentence by swapping word cards.
 * Requires base.js + online.js + cache.js + warmup.js + effects.js.
 *
 * Flow:
 *   1. Warmup modal — grammar rules (min 3) + Short/Medium/Long difficulty.
 *   2. AI generates a pool; play 10 rounds. English is always shown.
 *   3. Play again → warmup modal again, previous choices pre-set.
 */

(function () {
    'use strict';

    /* ---------------- Config ---------------- */

    var SESSION_SIZE = 10;
    var MIN_RULES_SELECTED = 3;
    var MIN_RULES_PER_SESSION = 3;
    var FEEDBACK_MS = { ok: 2000, bad: 5000 };
    var OUTER_TIMEOUT_MS = 45000;
    var DRAG_THRESHOLD_PX = 8;

    var STORAGE_RULES_KEY = 'dutch.pool.reorder';
    var STORAGE_DIFF_KEY = 'dutch.setting.reorder.difficulty';

    var DIFFICULTY = {
        short: { minWords: 5, maxWords: 8, label: 'Short' },
        medium: { minWords: 8, maxWords: 11, label: 'Medium' },
        long: { minWords: 11, maxWords: 14, label: 'Long' }
    };

    /* ---------------- Storage ---------------- */

    function loadRules() {
        var ALL_RULES = WoordWise.Online.GRAMMAR_RULES;
        try {
            var raw = localStorage.getItem(STORAGE_RULES_KEY);
            if (!raw) return ALL_RULES.slice();
            var arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return ALL_RULES.slice();
            var filtered = arr.filter(function (r) { return ALL_RULES.indexOf(r) !== -1; });
            return filtered.length ? filtered : ALL_RULES.slice();
        } catch (e) {
            return ALL_RULES.slice();
        }
    }

    function saveRules(rules) {
        try { localStorage.setItem(STORAGE_RULES_KEY, JSON.stringify(rules)); } catch (e) { }
    }

    function loadDifficulty() {
        try {
            var v = localStorage.getItem(STORAGE_DIFF_KEY);
            return DIFFICULTY[v] ? v : 'medium';
        } catch (e) {
            return 'medium';
        }
    }

    function saveDifficulty(k) {
        try { localStorage.setItem(STORAGE_DIFF_KEY, DIFFICULTY[k] ? k : 'medium'); } catch (e) { }
    }

    /* ---------------- State ---------------- */

    var session = [];
    var currentIndex = 0;
    var okCount = 0;
    var badCount = 0;
    var locked = false;
    var audio = {};
    var reduceMotion = false;
    var feedbackTimer = null;
    var generationToken = 0;
    var hasSession = false;

    var ticker = null;
    var activeRules = [];
    var activeDifficulty = 'medium';

    var tokens = [];
    var correctSentence = '';
    var grammarLabel = '';
    var englishTranslation = '';
    var explainText = '';
    var selectedIdx = -1;

    var drag = {
        active: false, pointerId: null, el: null, fromIdx: -1,
        startX: 0, startY: 0, dragging: false, dropIdx: -1
    };

    var els = {};

    function $(id) { return document.getElementById(id); }
    function clearNode(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    /* ---------------- Validation ---------------- */

    function isValidSentence(s) {
        if (!s || typeof s !== 'object') return false;
        if (typeof s.correct !== 'string' || !s.correct.trim()) return false;
        if (typeof s.grammar !== 'string' || !s.grammar.trim()) return false;
        if (typeof s.en !== 'string' || !s.en.trim()) return false;
        if (typeof s.explain !== 'string' || !s.explain.trim()) return false;
        if (activeRules.indexOf(s.grammar) === -1) return false;
        return true;
    }

    function pickUsable(data) {
        var arr = (data && Array.isArray(data.sentences)) ? data.sentences : [];
        var valid = arr.filter(isValidSentence);
        if (valid.length < SESSION_SIZE) return null;

        var seen = {};
        var distinct = 0;
        var chosen = [];
        for (var i = 0; i < valid.length && chosen.length < SESSION_SIZE; i++) {
            var s = valid[i];
            if (!seen[s.grammar]) { seen[s.grammar] = 1; distinct++; }
            chosen.push(s);
        }
        if (chosen.length < SESSION_SIZE) return null;
        var need = Math.min(MIN_RULES_PER_SESSION, activeRules.length);
        if (distinct < need) return null;
        return chosen;
    }

    /* ---------------- Generation ---------------- */

    function withOuterTimeout(promise, ms) {
        var id;
        var timeout = new Promise(function (_, reject) {
            id = setTimeout(function () {
                var e = new Error('The AI took too long to respond.');
                e.code = 'TIMEOUT';
                reject(e);
            }, ms);
        });
        return Promise.race([promise, timeout]).then(
            function (v) { clearTimeout(id); return v; },
            function (e) { clearTimeout(id); throw e; }
        );
    }

    function requestSentences() {
        var d = DIFFICULTY[activeDifficulty] || DIFFICULTY.medium;
        var p = WoordWise.Online.buildPrompt({
            grammarRules: activeRules,
            minWords: d.minWords,
            maxWords: d.maxWords
        });
        return withOuterTimeout(
            WoordWise.Online.generate(p.user, { system: p.system, json: true }),
            OUTER_TIMEOUT_MS
        );
    }

    function generateSession() {
        var myToken = ++generationToken;
        showLoading();

        requestSentences()
            .then(function (data1) {
                if (myToken !== generationToken) return null;
                var set1 = pickUsable(data1);
                if (set1) return set1;
                if (ticker) ticker.retry();
                return requestSentences().then(function (data2) {
                    if (myToken !== generationToken) return null;
                    var set2 = pickUsable(data2);
                    if (set2) return set2;
                    throw new Error('The AI returned unusable sentences.');
                });
            })
            .then(function (set) {
                if (myToken !== generationToken) return;
                if (!set) return;
                startWithSet(set, false);
            })
            .catch(function (err) {
                if (myToken !== generationToken) return;
                tryCacheFallback(err);
            });
    }

    function startWithSet(set, fromCache) {
        session = set;
        currentIndex = 0;
        okCount = 0;
        badCount = 0;
        locked = false;
        hasSession = true;
        clearTimeout(feedbackTimer);

        if (!fromCache) {
            set.forEach(function (s) {
                if (s && s.grammar) {
                    WoordWise.Cache.put('sentences', s.grammar, s);
                }
            });
        }

        buildProgress(session.length);
        updateScore();
        showGame();

        if (fromCache) {
            WoordWise.Cache.showBadge(els.card, 'Offline \u2014 using saved questions');
        } else {
            WoordWise.Cache.hideBadge(els.card);
        }

        nextRound();
    }

    function tryCacheFallback(err) {
        var cached = WoordWise.Cache.sessionFromRules('sentences', activeRules, SESSION_SIZE);
        if (cached.length === SESSION_SIZE) {
            startWithSet(cached, true);
            return;
        }

        var msg;
        if (err && err.code === 'NO_KEY') {
            msg = 'Add an AI API key to play this game.';
            try { WoordWise.Online.openKeyModal(); } catch (e) { }
        } else if (err && err.code === 'TIMEOUT') {
            msg = 'The AI took too long to respond. Try again in a moment.';
        } else {
            msg = (err && err.message) || 'Could not reach the AI.';
        }
        showError(msg);
    }

    /* ---------------- Warmup ---------------- */

    function startFlow() {
        var savedRules = loadRules();
        var savedDiff = loadDifficulty();

        WoordWise.Warmup.open({
            title: 'Re-Order',
            subtitle: 'Which grammar rules and difficulty?',
            startLabel: 'Start',
            cancelLabel: 'Home',
            build: function (body) { return buildWarmupBody(body, savedRules, savedDiff); },
            onStart: function (state) {
                saveRules(state.rules);
                saveDifficulty(state.difficulty);
                activeRules = state.rules;
                activeDifficulty = state.difficulty;
                generateSession();
            },
            onCancel: function () {
                location.href = 'index.html';
            }
        });
    }

    function buildWarmupBody(body, savedRules, savedDiff) {
        var selected = savedRules.slice();
        var diff = savedDiff;

        var boxes = [];

        var list = document.createElement('div');
        list.className = 'ww-warmup-rules';

        WoordWise.Online.GRAMMAR_RULES.forEach(function (rule) {
            var row = document.createElement('label');
            row.className = 'ww-warmup-rule';

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = rule;
            cb.checked = selected.indexOf(rule) !== -1;

            var span = document.createElement('span');
            span.textContent = rule;

            row.appendChild(cb);
            row.appendChild(span);
            list.appendChild(row);
            boxes.push(cb);
        });

        body.appendChild(list);

        var hint = document.createElement('p');
        hint.className = 'ww-warmup-hint';
        hint.textContent = 'Pick at least ' + MIN_RULES_SELECTED + ' rules.';
        body.appendChild(hint);

        /* Difficulty segmented control */
        var section = document.createElement('div');
        section.className = 'ww-warmup-section';

        var label = document.createElement('span');
        label.className = 'ww-warmup-label';
        label.textContent = 'Sentence length';
        section.appendChild(label);

        var seg = document.createElement('div');
        seg.className = 'ww-warmup-seg';

        var diffBtns = {};
        ['short', 'medium', 'long'].forEach(function (k) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = DIFFICULTY[k].label;
            b.dataset.diff = k;
            seg.appendChild(b);
            diffBtns[k] = b;
        });
        section.appendChild(seg);
        body.appendChild(section);

        function refreshSeg() {
            Object.keys(diffBtns).forEach(function (k) {
                diffBtns[k].classList.toggle('is-active', diff === k);
            });
        }
        refreshSeg();

        Object.keys(diffBtns).forEach(function (k) {
            diffBtns[k].addEventListener('click', function () { diff = k; refreshSeg(); });
        });

        return {
            validate: function () {
                var n = boxes.filter(function (b) { return b.checked; }).length;
                var ok = n >= MIN_RULES_SELECTED;
                hint.classList.toggle('err', !ok);
                return ok;
            },
            getState: function () {
                var sel = boxes.filter(function (b) { return b.checked; })
                    .map(function (b) { return b.value; });
                return { rules: sel, difficulty: diff };
            }
        };
    }

    /* ---------------- UI states ---------------- */

    function showLoading() {
        if (ticker) ticker.stop();
        document.body.classList.remove('is-ended');
        els.endScreen.hidden = true;
        els.loading.hidden = false;
        els.content.hidden = true;
        els.error.hidden = true;
        els.actions.hidden = true;
        els.result.hidden = true;
        els.card.classList.remove('is-ok', 'is-bad');
        WoordWise.Cache.hideBadge(els.card);

        ticker = WoordWise.Online.loadingTicker(els.loadingText, {
            messages: [
                'Contacting the AI\u2026',
                'Asking for A2 Dutch sentences\u2026',
                'Matching your chosen rules\u2026',
                'Request sent \u2014 awaiting response\u2026',
                'Reading the sentences\u2026',
                'Splitting them into words\u2026',
                'Formatting cards\u2026',
                'Almost there\u2026',
                'Hang on, this one\u2019s taking a while\u2026',
                'Still working \u2014 the AI is having a busy day\u2026'
            ],
            retry: 'Hmm, that mix wasn\u2019t great \u2014 asking once more\u2026'
        });
    }

    function showGame() {
        if (ticker) { ticker.stop(); ticker = null; }
        els.loading.hidden = true;
        els.error.hidden = true;
        els.content.hidden = false;
        els.actions.hidden = false;
    }

    function showError(msg) {
        if (ticker) { ticker.stop(); ticker = null; }
        document.body.classList.remove('is-ended');
        els.endScreen.hidden = true;
        els.loading.hidden = true;
        els.content.hidden = true;
        els.error.hidden = false;
        els.actions.hidden = true;
        els.errorMsg.textContent = msg;
        els.card.classList.remove('is-ok', 'is-bad');
    }

    /* ---------------- Progress + score ---------------- */

    function buildProgress(n) {
        clearNode(els.progress);
        for (var i = 0; i < n; i++) {
            var seg = document.createElement('span');
            seg.className = 'reorder-seg';
            els.progress.appendChild(seg);
        }
        if (els.progress.firstChild) els.progress.firstChild.classList.add('is-active');
    }

    function markProgress(i, correct) {
        var seg = els.progress.children[i];
        if (seg) {
            seg.classList.remove('is-active');
            seg.classList.add(correct ? 'is-ok' : 'is-bad');
        }
        var next = els.progress.children[i + 1];
        if (next) next.classList.add('is-active');
    }

    function updateScore() {
        els.scoreOk.textContent = okCount;
        els.scoreBad.textContent = badCount;
    }

    /* ---------------- Rounds ---------------- */

    function nextRound() {
        if (currentIndex >= session.length) { showEnd(); return; }

        var s = session[currentIndex];
        correctSentence = s.correct;
        grammarLabel = s.grammar;
        englishTranslation = s.en;
        explainText = s.explain;

        tokens = shuffledTokens(correctSentence);

        selectedIdx = -1;
        locked = false;

        els.card.classList.remove('is-ok', 'is-bad');
        els.result.hidden = true;
        els.resultCorrect.textContent = '';
        els.resultExplain.textContent = '';
        els.resultIcon.textContent = '';
        els.resultMsg.textContent = '';

        /* Grammar hint reset. */
        els.grammarBtn.hidden = false;
        els.grammarReveal.hidden = true;
        els.grammarReveal.textContent = '';

        /* English is always visible. */
        els.englishAlways.textContent = englishTranslation;

        els.btnCheck.disabled = false;

        renderCards(null);
    }

    function shuffledTokens(sentence) {
        var words = sentence.trim().split(/\s+/);
        var cards = words.map(function (text, i) {
            return { id: 'c' + i, text: text };
        });
        var shuffled = cards.slice();
        var attempts = 0;
        while (sameOrder(shuffled, cards) && attempts < 30) {
            shuffled = shuffleArr(shuffled);
            attempts++;
        }
        return shuffled;
    }

    function shuffleArr(a) {
        var arr = a.slice();
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
    }

    function sameOrder(a, b) {
        for (var i = 0; i < a.length; i++) if (a[i].id !== b[i].id) return false;
        return true;
    }

    /* ---------------- Rendering ---------------- */

    function renderCards(movedIdxs) {
        clearNode(els.cards);
        tokens.forEach(function (tok, idx) {
            var el = document.createElement('div');
            el.className = 'reorder-word';
            el.dataset.idx = idx;
            el.dataset.cardId = tok.id;
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
            el.setAttribute('aria-label', 'Word: ' + tok.text);
            el.textContent = tok.text;
            if (selectedIdx === idx) el.classList.add('is-selected');
            if (movedIdxs && movedIdxs.indexOf(idx) !== -1) el.classList.add('is-moved');
            els.cards.appendChild(el);
        });
    }

    function swapTokens(a, b) {
        if (a === b || a < 0 || b < 0) return;
        if (a >= tokens.length || b >= tokens.length) return;
        var t = tokens[a]; tokens[a] = tokens[b]; tokens[b] = t;
        renderCards([a, b]);
    }

    /* ---------------- Tap / drag ---------------- */

    function onPointerDown(e) {
        if (locked) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        var card = e.target.closest('.reorder-word');
        if (!card) return;
        e.preventDefault();

        drag.active = true;
        drag.pointerId = e.pointerId;
        drag.el = card;
        drag.fromIdx = parseInt(card.dataset.idx, 10);
        drag.startX = e.clientX;
        drag.startY = e.clientY;
        drag.dragging = false;
        drag.dropIdx = -1;
    }

    function onPointerMove(e) {
        if (!drag.active || e.pointerId !== drag.pointerId) return;
        var dx = e.clientX - drag.startX;
        var dy = e.clientY - drag.startY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (!drag.dragging && dist > DRAG_THRESHOLD_PX) {
            drag.dragging = true;
            drag.el.classList.add('is-dragging');
            drag.el.style.pointerEvents = 'none';
            setSelected(-1);
        }
        if (drag.dragging) {
            drag.el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(1.06)';
            var target = findDropTarget(e.clientX, e.clientY, drag.fromIdx);
            setDropTarget(target);
        }
    }

    function onPointerUp(e) {
        if (!drag.active || e.pointerId !== drag.pointerId) return;
        var el = drag.el;
        var fromIdx = drag.fromIdx;
        var wasDrag = drag.dragging;
        var dropIdx = drag.dropIdx;

        if (el) {
            el.classList.remove('is-dragging');
            el.style.transform = '';
            el.style.pointerEvents = '';
        }
        setDropTarget(-1);

        drag.active = false;
        drag.el = null;
        drag.fromIdx = -1;
        drag.pointerId = null;
        drag.dragging = false;
        drag.dropIdx = -1;

        if (wasDrag) {
            if (dropIdx >= 0 && dropIdx !== fromIdx) swapTokens(fromIdx, dropIdx);
        } else {
            handleTap(fromIdx);
        }
    }

    function findDropTarget(x, y, ignoreIdx) {
        var el = document.elementFromPoint(x, y);
        if (!el) return -1;
        var card = el.closest('.reorder-word');
        if (!card) return -1;
        var idx = parseInt(card.dataset.idx, 10);
        if (isNaN(idx) || idx === ignoreIdx) return -1;
        return idx;
    }

    function setDropTarget(idx) {
        if (drag.dropIdx === idx) return;
        if (drag.dropIdx >= 0) {
            var old = els.cards.querySelector('.reorder-word[data-idx="' + drag.dropIdx + '"]');
            if (old) old.classList.remove('is-drop-target');
        }
        drag.dropIdx = idx;
        if (idx >= 0) {
            var cur = els.cards.querySelector('.reorder-word[data-idx="' + idx + '"]');
            if (cur) cur.classList.add('is-drop-target');
        }
    }

    function handleTap(idx) {
        if (idx < 0) return;
        if (selectedIdx === -1) { setSelected(idx); return; }
        if (selectedIdx === idx) { setSelected(-1); return; }
        var from = selectedIdx;
        setSelected(-1);
        swapTokens(from, idx);
    }

    function setSelected(idx) {
        selectedIdx = idx;
        var words = els.cards.querySelectorAll('.reorder-word');
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            var wIdx = parseInt(w.dataset.idx, 10);
            if (wIdx === idx) w.classList.add('is-selected');
            else w.classList.remove('is-selected');
        }
    }

    function onKeyDown(e) {
        if (locked) return;
        var active = document.activeElement;
        if (!active || !active.classList || !active.classList.contains('reorder-word')) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            var idx = parseInt(active.dataset.idx, 10);
            if (!isNaN(idx)) handleTap(idx);
        } else if (e.key === 'Escape') {
            setSelected(-1);
        }
    }

    /* ---------------- Check / feedback ---------------- */

    function checkAnswer() {
        if (locked) return;
        locked = true;
        els.btnCheck.disabled = true;
        setSelected(-1);

        var userSentence = tokens.map(function (t) { return t.text; }).join(' ').toLowerCase();
        var correctLower = correctSentence.trim().split(/\s+/).join(' ').toLowerCase();
        var correct = (userSentence === correctLower);

        if (correct) {
            okCount++;
            WoordWise.playSound(audio, 'correct');
            els.card.classList.add('is-ok');
            showResult(true);
        } else {
            badCount++;
            WoordWise.playSound(audio, 'incorrect');
            els.card.classList.add('is-bad');
            showResult(false);
        }

        revealGrammarHint();
        updateScore();
        markProgress(currentIndex, correct);

        var delay = reduceMotion ? 700 : (correct ? FEEDBACK_MS.ok : FEEDBACK_MS.bad);
        feedbackTimer = setTimeout(function () {
            currentIndex++;
            nextRound();
        }, delay);
    }

    function showResult(correct) {
        els.result.hidden = false;
        els.resultIcon.textContent = correct ? '\u2713' : '\u2717';
        els.resultMsg.textContent = correct ? 'Correct!' : 'Not quite';
        els.resultCorrect.textContent = correct ? '' : correctSentence;
        els.resultExplain.textContent = explainText;
    }

    function revealGrammarHint() {
        els.grammarReveal.textContent = '\uD83D\uDCA1 ' + grammarLabel;
        els.grammarReveal.hidden = false;
        els.grammarBtn.hidden = true;
    }

    /* ---------------- End ---------------- */

    function showEnd() {
        document.body.classList.add('is-ended');

        var total = session.length;
        els.endScore.textContent = okCount + ' / ' + total;
        els.endBreakdown.textContent = okCount + ' correct \u00B7 ' + badCount + ' wrong';

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
        els.card = $('card');
        els.loading = $('loading');
        els.loadingText = $('loading-text');
        els.content = $('content');
        els.cards = $('cards');
        els.englishAlways = $('english-always');
        els.hints = $('hints');
        els.grammarBtn = $('grammar-btn');
        els.grammarReveal = $('grammar-reveal');
        els.result = $('result');
        els.resultIcon = $('result-icon');
        els.resultMsg = $('result-msg');
        els.resultCorrect = $('result-correct');
        els.resultExplain = $('result-explain');
        els.error = $('error');
        els.errorMsg = $('error-msg');
        els.btnRetry = $('btn-retry');
        els.btnSettings = $('btn-settings');
        els.actions = $('actions');
        els.btnCheck = $('btn-check');
        els.scoreOk = $('score-ok');
        els.scoreBad = $('score-bad');
        els.endScreen = $('end-screen');
        els.endScore = $('end-score');
        els.endBreakdown = $('end-breakdown');
        els.endMsg = $('end-msg');

        try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
        catch (e) { reduceMotion = false; }

        audio = WoordWise.preloadSounds();
        activeRules = loadRules();
        activeDifficulty = loadDifficulty();

        els.cards.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('pointercancel', onPointerUp);
        document.addEventListener('keydown', onKeyDown);

        els.btnCheck.addEventListener('click', checkAnswer);
        els.grammarBtn.addEventListener('click', revealGrammarHint);

        els.btnRetry.addEventListener('click', generateSession);
        els.btnSettings.addEventListener('click', function () {
            if (WoordWise.Online) WoordWise.Online.openKeyModal();
        });

        $('btn-again').addEventListener('click', function () {
            if (WoordWise.effects) WoordWise.effects.stop();
            startFlow();
        });

        window.addEventListener('woordwise:key-saved', function () {
            if (!hasSession) generateSession();
        });

        if (!WoordWise.Online) {
            showError('online.js did not load. Check your script tags.');
            return;
        }
        if (typeof WoordWise.Online.hasAnyKey === 'function' && !WoordWise.Online.hasAnyKey()) {
            showError('Add an AI API key to play this game.');
            try { WoordWise.Online.openKeyModal(); } catch (e) { }
            return;
        }

        startFlow();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();