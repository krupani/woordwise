/* WoordWise — spellit.js
 * Type the Dutch word for a shown English word.
 * Requires base.js + offline.js + warmup.js + effects.js.
 *
 * Flow:
 *   1. Warmup category picker → user chooses which word groups to include.
 *   2. Load only those groups via WoordWise.Offline.loadSelected().
 *   3. Play 10 rounds.
 *   4. Play again → warmup picker again (remembers last selection).
 */

(function () {
    'use strict';

    var SESSION_SIZE = 10;
    var FEEDBACK_MS = { ok: 600, almost: 1100, bad: 1500 };

    var ALL = [];
    var session = [];
    var currentIndex = 0;
    var currentWord = null;

    var okCount = 0;
    var almostCount = 0;
    var badCount = 0;

    var audio = {};
    var reduceMotion = false;
    var locked = false;
    var feedbackTimer = null;

    var els = {};

    function $(id) { return document.getElementById(id); }
    function clearNode(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    /* ---------------- Classification ---------------- */

    function stripDiacritics(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function normalize(s) {
        return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function classify(input, answer) {
        var a = normalize(input);
        var b = normalize(answer);
        if (!a) return 'bad';
        if (a === b) return 'ok';
        if (stripDiacritics(a) === stripDiacritics(b)) return 'almost';
        return 'bad';
    }

    /* ---------------- Progress + score ---------------- */

    function buildProgress(n) {
        clearNode(els.progress);
        for (var i = 0; i < n; i++) {
            var seg = document.createElement('span');
            seg.className = 'spellit-seg';
            els.progress.appendChild(seg);
        }
        if (els.progress.firstChild) els.progress.firstChild.classList.add('is-active');
    }

    function markProgress(i, kind) {
        var seg = els.progress.children[i];
        if (seg) {
            seg.classList.remove('is-active');
            seg.classList.add('is-' + (kind === 'ok' ? 'ok' : kind === 'almost' ? 'almost' : 'bad'));
        }
        var next = els.progress.children[i + 1];
        if (next) next.classList.add('is-active');
    }

    function updateScore() {
        els.scoreOk.textContent = okCount;
        els.scoreBad.textContent = badCount;
    }

    /* ---------------- Flow ---------------- */

    function startFlow() {
        WoordWise.Warmup.categoryPicker({
            title: 'Spell It',
            subtitle: 'Which words and how?',
            categories: [
                { id: 'nouns', label: 'Nouns', hint: 'zelfstandige naamwoorden' },
                { id: 'adjectives', label: 'Adjectives', hint: 'bijvoeglijke naamwoorden' },
                { id: 'verbs', label: 'Verbs', hint: 'werkwoorden' }
            ],
            storageKey: 'dutch.pool.spellit',
            modeSelector: {
                storageKey: 'dutch.setting.spellit.mode',
                label: 'Mode',
                default: 'play',
                options: [
                    { id: 'play', label: 'All words', hint: 'All words from the full list available in the app. Exploring & Challenging.' },
                    { id: 'practice', label: 'Learnt words', hint: 'Only words you have learnt through vocabulary page. Revision & Practice' }
                ]
            },
            onStart: function (state) {
                var groups, mode;
                if (Array.isArray(state)) { groups = state; mode = 'play'; }
                else { groups = state.categories; mode = state.mode; }
                if (!groups || !groups.length) return;
                loadAndBegin(groups, mode);
            },
            onCancel: function () { location.href = 'index.html'; }
        });
    }

    function loadAndBegin(groups, mode) {
        showLoading();

        if (mode === 'practice') {
            var records = WoordWise.Learnt.getForPractice(groups, 10);
            if (records.length < 10) {
                showError('Not enough learnt words in the selected categories.');
                return;
            }
            ALL = records.map(function (r) {
                return { en: r.en, nl: r.nl };
            });
            startSession();
            return;
        }

        WoordWise.Offline.loadSelected(groups)
            .then(function (words) {
                if (!words.length) {
                    throw new Error('No words in the selected categories.');
                }
                ALL = words;
                startSession();
            })
            .catch(function (err) {
                var msg = (err && err.message) ? err.message : 'unknown error';
                showError('Could not load word data (' + msg + ').');
            });
    }

    function showLoading() {
        els.card.classList.remove('is-ok', 'is-almost', 'is-bad');
        els.cardEn.classList.remove('is-error');
        els.cardEn.classList.add('is-status');
        els.cardEn.textContent = 'Loading words\u2026';
        els.fbAnswer.hidden = true;

        els.answer.disabled = true;
        els.btnCheck.disabled = true;
    }

    /* ---------------- Rounds ---------------- */

    function startSession() {
        if (!ALL.length) return;

        session = WoordWise.Offline.buildSession(ALL, SESSION_SIZE);
        currentIndex = 0;
        okCount = almostCount = badCount = 0;
        locked = false;
        clearTimeout(feedbackTimer);

        updateScore();
        buildProgress(session.length);
        els.endScreen.hidden = true;

        nextRound();
    }

    function nextRound() {
        if (currentIndex >= session.length) { showEnd(); return; }

        currentWord = session[currentIndex];

        els.card.classList.remove('is-ok', 'is-almost', 'is-bad');
        els.cardEn.hidden = false;
        els.fbAnswer.hidden = true;
        els.cardEn.classList.remove('is-status', 'is-error');
        els.cardEn.textContent = currentWord.en || '';

        els.answer.value = '';
        els.answer.disabled = false;
        els.btnCheck.disabled = true;

        locked = false;

        requestAnimationFrame(function () {
            WoordWise.fitText(els.cardEn, els.cardEn.parentElement, { max: 48, min: 18 });
            try { els.answer.focus(); } catch (e) { }
        });
    }

    function submit() {
        if (locked || !currentWord) return;
        if (!normalize(els.answer.value)) return;

        locked = true;
        els.answer.disabled = true;
        els.btnCheck.disabled = true;

        var result = classify(els.answer.value, currentWord.nl);

        if (result === 'ok') {
            okCount++;
            WoordWise.playSound(audio, 'correct');
            showFeedback('ok', 'Correct!', '', false);
        } else if (result === 'almost') {
            okCount++;
            almostCount++;
            WoordWise.playSound(audio, 'almost');
            showFeedback('almost', 'Almost!', currentWord.nl, true);
        } else {
            badCount++;
            WoordWise.playSound(audio, 'incorrect');
            showFeedback('bad', 'Not quite', currentWord.nl, true);
        }

        updateScore();
        markProgress(currentIndex, result);

        var delay = reduceMotion ? 500 : (FEEDBACK_MS[result] || 900);

        if (result === 'ok') {
            var delay = reduceMotion ? 500 : FEEDBACK_MS.ok;
            feedbackTimer = setTimeout(function () {
                currentIndex++;
                nextRound();
            }, delay);
        } else {
            WoordWise.Feedback.waitForNext(els.card, {
                isLast: (currentIndex === session.length - 1)
            }).then(function () {
                currentIndex++;
                nextRound();
            });
        }
    }

    function showFeedback(kind, msg, answer, showAnswer) {
        els.card.classList.add('is-' + kind);

        els.fbIcon.textContent = kind === 'ok' ? '\u2713' :
            kind === 'almost' ? '~' : '\u2717';
        els.fbMsg.textContent = msg;

        if (showAnswer) {
            els.fbAnswer.hidden = false;
            els.fbAnswer.textContent = answer;
            requestAnimationFrame(function () {
                WoordWise.fitText(els.fbAnswer, els.fbAnswer.parentElement, { max: 42, min: 16 });
            });
        } else {
            els.fbAnswer.hidden = true;
            els.fbAnswer.textContent = '';
        }
    }

    /* ---------------- End ---------------- */

    function showEnd() {
        var total = session.length;
        var score = okCount;
        els.endScore.textContent = score + ' / ' + total;

        var fullyCorrect = okCount - almostCount;
        var parts = [];
        if (fullyCorrect) parts.push(fullyCorrect + ' correct');
        if (almostCount) parts.push(almostCount + ' almost');
        if (badCount) parts.push(badCount + ' wrong');
        els.endBreakdown.textContent = parts.join(' \u00B7 ');

        var pct = total ? score / total : 0;
        var msg;
        if (score === total && almostCount === 0) msg = 'Perfect! \uD83C\uDF89';
        else if (score === total && almostCount > 0) msg = 'All correct \u2014 watch the accents.';
        else if (pct >= 0.8) msg = 'Great job!';
        else if (pct >= 0.5) msg = 'Nice \u2014 keep going.';
        else msg = 'Keep practicing!';
        els.endMsg.textContent = msg;

        els.endScreen.hidden = false;

        if (WoordWise.effects) WoordWise.effects.celebrate(score, total);
    }

    function showError(msg) {
        els.card.classList.remove('is-ok', 'is-almost', 'is-bad');
        els.cardEn.classList.add('is-status', 'is-error');
        els.cardEn.textContent = msg;
        els.fbAnswer.hidden = true;

        els.answer.disabled = true;
        els.btnCheck.disabled = true;
    }

    /* ---------------- Boot ---------------- */

    function init() {
        els.progress = $('progress');
        els.card = $('card');
        els.cardEn = $('card-en');
        els.fbIcon = $('fb-icon');
        els.fbMsg = $('fb-msg');
        els.fbAnswer = $('fb-answer');
        els.answer = $('answer');
        els.btnCheck = $('btn-check');
        els.form = $('answer-form');
        els.scoreOk = $('score-ok');
        els.scoreBad = $('score-bad');
        els.endScreen = $('end-screen');
        els.endScore = $('end-score');
        els.endBreakdown = $('end-breakdown');
        els.endMsg = $('end-msg');

        try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
        catch (e) { reduceMotion = false; }

        audio = WoordWise.preloadSounds();

        els.answer.addEventListener('input', function () {
            if (locked) return;
            els.btnCheck.disabled = !normalize(els.answer.value);
        });

        els.form.addEventListener('submit', function (e) {
            e.preventDefault();
            submit();
        });

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