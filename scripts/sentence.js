/* WoordWise — sentence.js
 * English prompt → user types the Dutch sentence.
 * Requires base.js + online.js + warmup.js + effects.js.
 *
 * Correction tiers (per-word Levenshtein, position-matched):
 *   ok      — every word matches exactly (case + punctuation ignored)
 *   almost  — up to 2 words with 1-char edit distance,
 *             AND up to 2 accent-only differences, AND no other errors
 *   bad     — everything else (word count mismatch, ordering, larger typos)
 *
 * Flow:
 *   1. Warmup modal — grammar rules (min 3) + difficulty Short/Medium/Long.
 *   2. AI generates a pool; play 10 rounds.
 *   3. Play again → warmup modal again, previous choices pre-set.
 */

(function () {
    'use strict';

    /* ---------------- Config ---------------- */

    var SESSION_SIZE = 10;
    var MIN_RULES_SELECTED = 3;
    var MIN_RULES_PER_SESSION = 3;
    var FEEDBACK_MS = { ok: 2000, almost: 5000, bad: 5000 };
    var OUTER_TIMEOUT_MS = 45000;
    var MAX_TYPOS_FOR_ALMOST = 2;
    var MAX_ACCENTS_FOR_ALMOST = 2;

    var STORAGE_RULES_KEY = 'dutch.pool.sentence';
    var STORAGE_DIFF_KEY = 'dutch.setting.sentence.difficulty';

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
    var almostCount = 0;
    var badCount = 0;
    var locked = false;
    var audio = {};
    var reduceMotion = false;
    var feedbackTimer = null;
    var generationToken = 0;
    var hasSession = false;

    var ticker = null;
    var activeRules = WoordWise.Online.GRAMMAR_RULES.slice();
    var activeDifficulty = 'medium';

    var currentWord = null;
    var els = {};

    function $(id) { return document.getElementById(id); }
    function clearNode(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    /* ---------------- Text utilities ---------------- */

    function stripEdgePunct(w) {
        return String(w || '').replace(/^[.,!?;:«»""''`]+|[.,!?;:«»""''`]+$/g, '');
    }

    function normalizeWord(w) {
        return stripEdgePunct(w).toLowerCase();
    }

    function splitWords(s) {
        return String(s || '').trim().split(/\s+/).filter(Boolean);
    }

    function stripDiacritics(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function levenshtein(a, b) {
        if (a === b) return 0;
        var m = a.length, n = b.length;
        if (!m) return n;
        if (!n) return m;
        var prev = new Array(n + 1);
        var curr = new Array(n + 1);
        for (var j = 0; j <= n; j++) prev[j] = j;
        for (var i = 1; i <= m; i++) {
            curr[0] = i;
            for (var k = 1; k <= n; k++) {
                var cost = (a[i - 1] === b[k - 1]) ? 0 : 1;
                curr[k] = Math.min(
                    prev[k] + 1,
                    curr[k - 1] + 1,
                    prev[k - 1] + cost
                );
            }
            var tmp = prev; prev = curr; curr = tmp;
        }
        return prev[n];
    }

    /* ---------------- Classification ---------------- */

    function classify(userText, correctText) {
        var userWords = splitWords(userText).map(normalizeWord);
        var correctWords = splitWords(correctText).map(normalizeWord);

        if (userWords.length !== correctWords.length) {
            return { kind: 'bad', reason: 'length', diffs: [] };
        }

        var typos = 0;
        var accents = 0;
        var wrongs = 0;
        var diffs = [];

        for (var i = 0; i < userWords.length; i++) {
            var u = userWords[i];
            var c = correctWords[i];

            if (u === c) { diffs.push({ idx: i, type: 'ok' }); continue; }

            if (stripDiacritics(u) === stripDiacritics(c)) {
                accents++;
                diffs.push({ idx: i, type: 'accent' });
                continue;
            }

            var d = levenshtein(u, c);
            if (d === 1) {
                typos++;
                diffs.push({ idx: i, type: 'typo' });
                continue;
            }

            wrongs++;
            diffs.push({ idx: i, type: 'wrong' });
        }

        if (wrongs > 0) {
            return { kind: 'bad', diffs: diffs, typos: typos, accents: accents, wrongs: wrongs };
        }
        if (typos === 0 && accents === 0) {
            return { kind: 'ok', diffs: diffs };
        }
        if (typos <= MAX_TYPOS_FOR_ALMOST && accents <= MAX_ACCENTS_FOR_ALMOST) {
            return { kind: 'almost', diffs: diffs, typos: typos, accents: accents };
        }
        return { kind: 'bad', diffs: diffs, typos: typos, accents: accents, wrongs: 0 };
    }

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
        almostCount = 0;
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
            title: 'Sentence',
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

        /* Rules list */
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
        els.endScreen.hidden = true;
        els.loading.hidden = false;
        els.content.hidden = true;
        els.error.hidden = true;
        els.card.classList.remove('is-ok', 'is-almost', 'is-bad');
        WoordWise.Cache.hideBadge(els.card);

        ticker = WoordWise.Online.loadingTicker(els.loadingText, {
            messages: [
                'Contacting the AI\u2026',
                'Asking for A2 Dutch sentences\u2026',
                'Matching your chosen rules\u2026',
                'Request sent \u2014 awaiting response\u2026',
                'Reading the sentences\u2026',
                'Preparing English prompts\u2026',
                'Formatting rounds\u2026',
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
    }

    function showError(msg) {
        if (ticker) { ticker.stop(); ticker = null; }
        els.endScreen.hidden = true;
        els.loading.hidden = true;
        els.content.hidden = true;
        els.error.hidden = false;
        els.errorMsg.textContent = msg;
        els.card.classList.remove('is-ok', 'is-almost', 'is-bad');
    }

    /* ---------------- Progress + score ---------------- */

    function buildProgress(n) {
        clearNode(els.progress);
        for (var i = 0; i < n; i++) {
            var seg = document.createElement('span');
            seg.className = 'sentence-seg';
            els.progress.appendChild(seg);
        }
        if (els.progress.firstChild) els.progress.firstChild.classList.add('is-active');
    }

    function markProgress(i, kind) {
        var seg = els.progress.children[i];
        if (seg) {
            seg.classList.remove('is-active');
            seg.classList.add('is-' + kind);
        }
        var next = els.progress.children[i + 1];
        if (next) next.classList.add('is-active');
    }

    function updateScore() {
        /* ok + almost both count as ✓ in the chip */
        var correctTotal = okCount + almostCount;
        els.scoreOk.textContent = correctTotal;
        els.scoreBad.textContent = badCount;
    }

    /* ---------------- Rounds ---------------- */

    function nextRound() {
        if (currentIndex >= session.length) { showEnd(); return; }

        var s = session[currentIndex];
        currentWord = s;

        els.card.classList.remove('is-ok', 'is-almost', 'is-bad');
        els.promptEn.textContent = s.en;
        els.feedback.hidden = true;
        els.grammarReveal.hidden = true;
        els.grammarReveal.textContent = '';
        els.hintBtn.hidden = false;
        els.fbCorrectBlock.hidden = true;
        clearNode(els.fbCorrect);
        els.fbExplain.textContent = '';
        els.fbIcon.textContent = '';
        els.fbMsg.textContent = '';

        els.answer.value = '';
        els.answer.disabled = false;
        els.btnCheck.disabled = true;

        locked = false;

        requestAnimationFrame(function () {
            WoordWise.fitText(els.promptEn, els.promptEn.parentElement, { max: 22, min: 15 });
            try { els.answer.focus(); } catch (e) { }
        });
    }

    function onInputChanged() {
        if (locked) return;
        els.btnCheck.disabled = !splitWords(els.answer.value).length;
    }

    function onKeyDown(e) {
        if (e.key !== 'Enter') return;
        /* Enter submits, Shift+Enter inserts a newline */
        if (e.shiftKey) return;
        e.preventDefault();
        if (!locked && splitWords(els.answer.value).length) submit();
    }

    /* ---------------- Submit + feedback ---------------- */

    function submit() {
        if (locked || !currentWord) return;
        if (!splitWords(els.answer.value).length) return;

        locked = true;
        els.answer.disabled = true;
        els.btnCheck.disabled = true;

        var result = classify(els.answer.value, currentWord.correct);

        if (result.kind === 'ok') {
            okCount++;
            WoordWise.playSound(audio, 'correct');
            els.card.classList.add('is-ok');
            els.fbIcon.textContent = '\u2713';
            els.fbMsg.textContent = 'Correct!';
            els.fbCorrectBlock.hidden = true;
        } else if (result.kind === 'almost') {
            almostCount++;
            WoordWise.playSound(audio, 'almost');
            els.card.classList.add('is-almost');
            els.fbIcon.textContent = '~';
            els.fbMsg.textContent = 'Almost \u2014 mind the accents / spelling';
            renderCorrect(currentWord.correct, result.diffs);
        } else {
            badCount++;
            WoordWise.playSound(audio, 'incorrect');
            els.card.classList.add('is-bad');
            els.fbIcon.textContent = '\u2717';
            els.fbMsg.textContent = 'Not quite';
            renderCorrect(currentWord.correct, result.diffs);
        }

        els.fbExplain.textContent = currentWord.explain;

        /* Reveal the grammar hint automatically after answering. */
        revealGrammarHint();

        els.feedback.hidden = false;
        updateScore();
        markProgress(currentIndex, result.kind);

        var delay = reduceMotion ? 700 : (FEEDBACK_MS[result.kind] || 3000);
        feedbackTimer = setTimeout(function () {
            currentIndex++;
            nextRound();
        }, delay);
    }

    function renderCorrect(correctText, diffs) {
        els.fbCorrectBlock.hidden = false;
        clearNode(els.fbCorrect);

        var words = splitWords(correctText);
        words.forEach(function (w, i) {
            var span = document.createElement('span');
            span.className = 'word';
            span.textContent = w;
            var d = diffs && diffs[i];
            if (d) {
                if (d.type === 'accent') span.classList.add('is-accent');
                else if (d.type === 'typo') span.classList.add('is-typo');
                else if (d.type === 'wrong') span.classList.add('is-wrong');
            }
            els.fbCorrect.appendChild(span);
        });
    }

    function revealGrammarHint() {
        els.grammarReveal.textContent = '\uD83D\uDCA1 ' + currentWord.grammar;
        els.grammarReveal.hidden = false;
        els.hintBtn.hidden = true;
    }

    /* ---------------- End ---------------- */

    function showEnd() {
        var total = session.length;
        var score = okCount + almostCount;
        els.endScore.textContent = score + ' / ' + total;

        var parts = [];
        if (okCount) parts.push(okCount + ' correct');
        if (almostCount) parts.push(almostCount + ' almost');
        if (badCount) parts.push(badCount + ' wrong');
        els.endBreakdown.textContent = parts.join(' \u00B7 ');

        var pct = total ? score / total : 0;
        var msg;
        if (okCount === total) msg = 'Perfect! \uD83C\uDF89';
        else if (score === total && almostCount) msg = 'All correct \u2014 watch the accents.';
        else if (pct >= 0.8) msg = 'Great job!';
        else if (pct >= 0.5) msg = 'Nice \u2014 keep going.';
        else msg = 'Keep practicing!';
        els.endMsg.textContent = msg;

        els.endScreen.hidden = false;
        if (WoordWise.effects) WoordWise.effects.celebrate(score, total);
    }

    /* ---------------- Boot ---------------- */

    function init() {
        els.progress = $('progress');
        els.card = $('card');
        els.loading = $('loading');
        els.loadingText = $('loading-text');
        els.content = $('content');
        els.promptEn = $('prompt-en');
        els.grammarReveal = $('grammar-reveal');
        els.hintBtn = $('hint-btn');
        els.answerForm = $('answer-form');
        els.answer = $('answer');
        els.btnCheck = $('btn-check');
        els.feedback = $('feedback');
        els.fbIcon = $('fb-icon');
        els.fbMsg = $('fb-msg');
        els.fbCorrectBlock = $('fb-correct-block');
        els.fbCorrect = $('fb-correct');
        els.fbExplain = $('fb-explain');
        els.error = $('error');
        els.errorMsg = $('error-msg');
        els.btnRetry = $('btn-retry');
        els.btnSettings = $('btn-settings');
        els.scoreOk = $('score-ok');
        els.scoreBad = $('score-bad');
        els.endScreen = $('end-screen');
        els.endScore = $('end-score');
        els.endBreakdown = $('end-breakdown');
        els.endMsg = $('end-msg');

        try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
        catch (e) { reduceMotion = false; }

        audio = WoordWise.preloadSounds();

        els.answer.addEventListener('input', onInputChanged);
        els.answer.addEventListener('keydown', onKeyDown);
        els.answerForm.addEventListener('submit', function (e) {
            e.preventDefault();
            submit();
        });

        els.hintBtn.addEventListener('click', revealGrammarHint);
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