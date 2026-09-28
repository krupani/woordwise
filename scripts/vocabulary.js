/* WoordWise — vocabulary.js
 * Learn-then-test vocabulary game.
 * Requires base.js + offline.js + learnt.js + warmup.js + effects.js.
 *
 * Flow:
 *   1. Warmup — which categories to learn (min 1).
 *   2. Learning phase — 10 cards, Prev/Next navigation.
 *      `shown` increments once per word per session.
 *   3. Test phase — 10 MCQs, one per word, random direction each.
 *      `tested`, `correct`, and `mistakes` increment here.
 *   4. End screen with score.
 *
 * Word selection priority:
 *   - Up to 5 wrong words from the learnt cache (highest mistakes first)
 *   - If wrong words exist but fewer than 3, top up from non-mastered cache
 *   - Remaining slots filled with fresh, never-shown words
 *   - Final shuffle so wrong words aren't always first
 */

(function () {
    'use strict';

    /* ---------------- Config ---------------- */

    var SESSION_SIZE = 10;
    var RELEARN_MAX = 5;
    var RELEARN_MIN = 3;
    var FEEDBACK_MS = { ok: 1400, bad: 2600 };

    /* ---------------- State ---------------- */

    var pool = [];                 // every loaded word (with _category)
    var session = [];              // words for this run
    var visited = {};              // { nl: true } — learning-phase show tracker
    var learnIndex = 0;
    var testIndex = 0;
    var testQuestions = [];
    var okCount = 0;
    var badCount = 0;
    var locked = false;
    var phase = 'learn';
    var audio = {};
    var reduceMotion = false;

    var els = {};

    function $(id) { return document.getElementById(id); }
    function clearNode(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    /* ---------------- Session builder ---------------- */

    function loadAndBegin(groups) {
        showLoading();

        var promises = groups.map(function (cat) {
            return WoordWise.Offline.loadGroup(cat).then(function (words) {
                return (words || []).map(function (w) {
                    return Object.assign({}, w, { _category: cat });
                });
            });
        });

        Promise.all(promises)
            .then(function (results) {
                var all = [];
                results.forEach(function (arr) { all = all.concat(arr); });
                if (all.length < 4) {
                    throw new Error('Need at least 4 words. Select more categories.');
                }
                pool = all;
                session = buildSession(all, groups);
                if (session.length < 4) {
                    throw new Error('Could not build a session with enough words.');
                }
                startLearning();
            })
            .catch(function (err) {
                showError((err && err.message) || 'Could not load words.');
            });
    }

    function buildSession(words, categories) {
        var poolByNl = {};
        words.forEach(function (w) { poolByNl[w.nl] = w; });

        /* 1. Wrong words from cache, wrong-first, topped to min 3 */
        var wrongs = WoordWise.Learnt.getForRelearn(categories, RELEARN_MAX, RELEARN_MIN);

        var seenNl = {};
        var picked = [];

        wrongs.forEach(function (rec) {
            var w = poolByNl[rec.nl];
            if (!w || seenNl[w.nl]) return;
            seenNl[w.nl] = 1;
            picked.push(w);
        });

        /* 2. Words already shown in previous sessions — deprioritise */
        var shownSet = {};
        categories.forEach(function (cat) {
            WoordWise.Learnt.getCategory(cat).forEach(function (rec) {
                if ((rec.shown || 0) > 0) shownSet[rec.nl] = 1;
            });
        });

        /* 3. Fresh words: never shown in cache */
        var fresh = words.filter(function (w) {
            return !seenNl[w.nl] && !shownSet[w.nl];
        });
        fresh = WoordWise.shuffle(fresh);

        var target = Math.min(SESSION_SIZE, words.length);

        fresh.forEach(function (w) {
            if (picked.length >= target) return;
            if (seenNl[w.nl]) return;
            seenNl[w.nl] = 1;
            picked.push(w);
        });

        /* 4. Fill from cached non-mastered words */
        if (picked.length < target) {
            var fill = WoordWise.Learnt.getForPractice(categories, 40);
            fill.forEach(function (rec) {
                if (picked.length >= target) return;
                if (seenNl[rec.nl]) return;
                var w = poolByNl[rec.nl];
                if (!w) return;
                seenNl[w.nl] = 1;
                picked.push(w);
            });
        }

        /* 5. Last resort: anything remaining in the pool */
        if (picked.length < target) {
            words.forEach(function (w) {
                if (picked.length >= target) return;
                if (seenNl[w.nl]) return;
                seenNl[w.nl] = 1;
                picked.push(w);
            });
        }

        return WoordWise.shuffle(picked);
    }

    /* ---------------- Progress + chip ---------------- */

    function buildProgress(n) {
        clearNode(els.progress);
        for (var i = 0; i < n; i++) {
            var seg = document.createElement('span');
            seg.className = 'vocab-seg';
            els.progress.appendChild(seg);
        }
    }

    function resetProgressToLearning() {
        var segs = els.progress.children;
        for (var i = 0; i < segs.length; i++) {
            segs[i].classList.remove('is-active', 'is-seen', 'is-ok', 'is-bad');
        }
    }

    function updateProgressForLearning() {
        var segs = els.progress.children;
        for (var i = 0; i < segs.length; i++) {
            var s = segs[i];
            s.classList.remove('is-active', 'is-seen', 'is-ok', 'is-bad');
            if (i < learnIndex) s.classList.add('is-seen');
            else if (i === learnIndex) s.classList.add('is-active');
        }
    }

    function markTestProgress(i, correct) {
        var seg = els.progress.children[i];
        if (seg) {
            seg.classList.remove('is-active');
            seg.classList.add(correct ? 'is-ok' : 'is-bad');
        }
        var next = els.progress.children[i + 1];
        if (next) next.classList.add('is-active');
    }

    function chipEnterLearning() {
        els.chip.classList.add('is-count');
        els.chipCount.textContent = '';
    }

    function chipUpdateLearning() {
        els.chipCount.textContent = (learnIndex + 1) + ' / ' + session.length;
    }

    function chipEnterTest() {
        els.chip.classList.remove('is-count');
        els.scoreOk.textContent = '0';
        els.scoreBad.textContent = '0';
    }

    function chipUpdateTest() {
        els.scoreOk.textContent = String(okCount);
        els.scoreBad.textContent = String(badCount);
    }

    /* ---------------- Learning phase ---------------- */

    function startLearning() {
        document.body.classList.remove('is-ended');
        phase = 'learn';
        learnIndex = 0;
        visited = {};
        okCount = 0;
        badCount = 0;
        locked = false;

        buildProgress(session.length);
        chipEnterLearning();

        els.endScreen.hidden = true;
        els.learnCard.hidden = false;
        els.testCard.hidden = true;
        els.options.hidden = true;
        els.nav.hidden = false;
        els.error.hidden = true;
        els.loading.hidden = true;

        els.footHint.textContent = 'Browse the cards, then take the test.';

        showLearnCard(0);
    }

    function showLearnCard(idx) {
        learnIndex = idx;
        var w = session[idx];

        els.learnWord.textContent = w.nl || '';
        els.learnEn.textContent = w.en || '';

        renderWordMeta(w);

        var usage = w.usage || {};
        var hasUsage = !!(usage.en || usage.nl);
        els.learnUsage.hidden = !hasUsage;
        els.learnUsageEn.textContent = usage.en || '';
        els.learnUsageNl.textContent = usage.nl || '';

        /* Increment `shown` once per session per word */
        if (!visited[w.nl]) {
            visited[w.nl] = true;
            if (w._category) {
                WoordWise.Learnt.increment(w._category, w, 'shown');
            }
        }

        updateProgressForLearning();
        chipUpdateLearning();

        /* Prev/Next state */
        els.btnPrev.disabled = (idx === 0);
        if (idx === session.length - 1) {
            els.btnNext.innerHTML = 'Let\u2019s Test <span aria-hidden="true">&rarr;</span>';
            els.btnNext.classList.add('is-test');
        } else {
            els.btnNext.innerHTML = 'Next <span aria-hidden="true">&rarr;</span>';
            els.btnNext.classList.remove('is-test');
        }

        requestAnimationFrame(function () {
            WoordWise.fitText(els.learnWord, els.learnWord.parentElement, { max: 44, min: 20 });
        });
    }

    /**
 * Renders category-specific metadata on the learning card:
 *   - Nouns: a small badge showing `de` or `het`
 *   - Verbs: a row of pills showing every conjugation form
 *     (the infinitive is appended if the source data doesn't already
 *      include it in `conjugation`)
 */
    function renderWordMeta(w) {
        var articleEl = els.learnArticle;
        var conjEl = els.learnConj;

        articleEl.hidden = true;
        articleEl.textContent = '';
        conjEl.hidden = true;
        clearNode(conjEl);

        /* Nouns: de / het badge */
        if (w._category === 'nouns' && (w.article === 'de' || w.article === 'het')) {
            articleEl.textContent = w.article;
            articleEl.hidden = false;
        }

        /* Verbs: conjugation pills */
        if (w._category === 'verbs' && Array.isArray(w.conjugation) && w.conjugation.length) {
            var forms = w.conjugation.slice();
            if (w.nl && forms.indexOf(w.nl) === -1) forms.push(w.nl);
            forms.forEach(function (form) {
                var pill = document.createElement('span');
                pill.className = 'vocab-conj-pill';
                pill.textContent = form;
                conjEl.appendChild(pill);
            });
            conjEl.hidden = false;
        }
    }

    function onPrev() {
        if (learnIndex > 0) showLearnCard(learnIndex - 1);
    }

    function onNext() {
        if (learnIndex < session.length - 1) {
            showLearnCard(learnIndex + 1);
        } else {
            startTest();
        }
    }

    /* ---------------- Test phase ---------------- */

    function startTest() {
        phase = 'test';
        testIndex = 0;
        okCount = 0;
        badCount = 0;
        locked = false;

        testQuestions = prepareQuestions();

        resetProgressToLearning();
        chipEnterTest();

        els.learnCard.hidden = true;
        els.testCard.hidden = false;
        els.options.hidden = false;
        els.nav.hidden = true;

        els.footHint.textContent = 'Pick the correct translation.';

        showQuestion(0);
    }

    function prepareQuestions() {
        /* Guarantee a balanced mix: alternating directions, then shuffled.
         * For 10 questions → exactly 5 en2nl and 5 nl2en.
         * For odd counts → the extra one goes to en2nl. */
        var directions = [];
        for (var i = 0; i < session.length; i++) {
            directions.push(i % 2 === 0 ? 'en2nl' : 'nl2en');
        }
        directions = WoordWise.shuffle(directions);

        return session.map(function (w, idx) {
            var dir = directions[idx];
            var prompt, correct, field;
            if (dir === 'en2nl') {
                prompt = w.en;
                correct = w.nl;
                field = 'nl';
            } else {
                prompt = w.nl;
                correct = w.en;
                field = 'en';
            }
            var distractors = pickDistractors(w, field, 3);
            var options = WoordWise.shuffle([correct].concat(distractors));
            return {
                word: w,
                prompt: prompt,
                correct: correct,
                options: options
            };
        });
    }

    function pickDistractors(word, field, n) {
        var seen = {};
        seen[word[field]] = 1;
        var candidates = [];

        function collect(src) {
            src.forEach(function (w) {
                if (w.nl === word.nl) return;
                var v = w[field];
                if (!v || seen[v]) return;
                seen[v] = 1;
                candidates.push(v);
            });
        }

        collect(session);
        if (candidates.length < n) collect(pool);

        return WoordWise.shuffle(candidates).slice(0, n);
    }

    function showQuestion(idx) {
        testIndex = idx;
        var q = testQuestions[idx];

        els.testPrompt.textContent = q.prompt;

        clearNode(els.options);
        q.options.forEach(function (opt) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'vocab-option';
            btn.textContent = opt;
            btn.dataset.value = opt;
            btn.addEventListener('click', function () { onAnswer(btn, opt); });
            els.options.appendChild(btn);
        });

        els.testCard.classList.remove('is-ok', 'is-bad');

        /* Move the active segment */
        var segs = els.progress.children;
        for (var i = 0; i < segs.length; i++) segs[i].classList.remove('is-active');
        if (segs[idx]) segs[idx].classList.add('is-active');

        requestAnimationFrame(function () {
            WoordWise.fitText(els.testPrompt, els.testPrompt.parentElement, { max: 40, min: 18 });
        });
    }

    function onAnswer(btn, value) {
        if (locked) return;
        locked = true;

        var q = testQuestions[testIndex];
        var correct = (value === q.correct);
        var w = q.word;

        var optionBtns = els.options.querySelectorAll('.vocab-option');
        for (var i = 0; i < optionBtns.length; i++) optionBtns[i].disabled = true;

        if (correct) {
            okCount++;
            WoordWise.playSound(audio, 'correct');
            els.testCard.classList.add('is-ok');
            btn.classList.add('is-correct');
        } else {
            badCount++;
            WoordWise.playSound(audio, 'incorrect');
            els.testCard.classList.add('is-bad');
            btn.classList.add('is-wrong');
            for (var j = 0; j < optionBtns.length; j++) {
                if (optionBtns[j].dataset.value === q.correct) {
                    optionBtns[j].classList.add('is-correct');
                }
            }
        }

        if (w._category) {
            WoordWise.Learnt.markTested(w._category, w, correct);
        }

        chipUpdateTest();
        markTestProgress(testIndex, correct);

        var delay = reduceMotion ? 700 : (correct ? FEEDBACK_MS.ok : FEEDBACK_MS.bad);

        function advance() {
            locked = false;
            if (testIndex + 1 >= testQuestions.length) {
                showEnd();
            } else {
                showQuestion(testIndex + 1);
            }
        }

        if (correct) {
            var delay = reduceMotion ? 700 : FEEDBACK_MS.ok;
            setTimeout(advance, delay);
        } else {
            WoordWise.Feedback.waitForNext(els.testCard, {
                isLast: (testIndex + 1 >= testQuestions.length)
            }).then(advance);
        }
    }

    /* ---------------- Loading / error ---------------- */

    function showLoading() {
        document.body.classList.remove('is-ended');
        els.learnCard.hidden = true;
        els.testCard.hidden = true;
        els.options.hidden = true;
        els.nav.hidden = true;
        els.error.hidden = true;
        els.loading.hidden = false;
    }

    function showError(msg) {
        els.learnCard.hidden = true;
        els.testCard.hidden = true;
        els.options.hidden = true;
        els.nav.hidden = true;
        els.loading.hidden = true;
        els.error.hidden = false;
        els.errorMsg.textContent = msg;
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

    /* ---------------- Warmup ---------------- */

    function startFlow() {
        WoordWise.Warmup.categoryPicker({
            title: 'Vocabulary',
            subtitle: 'Which word types do you want to learn?',
            categories: [
                { id: 'nouns', label: 'Nouns', hint: 'zelfstandige naamwoorden (de / het)' },
                { id: 'adjectives', label: 'Adjectives', hint: 'bijvoeglijke naamwoorden' },
                { id: 'verbs', label: 'Verbs', hint: 'werkwoorden' }
            ],
            storageKey: 'dutch.pool.vocabulary',
            onStart: function (selected) {
                if (!selected || !selected.length) return;
                loadAndBegin(selected);
            },
            onCancel: function () {
                location.href = 'index.html';
            }
        });
    }

    /* ---------------- Boot ---------------- */

    function init() {
        els.progress = $('progress');
        els.chip = $('chip');
        els.chipCount = $('chip-count');
        els.scoreOk = $('score-ok');
        els.scoreBad = $('score-bad');

        els.learnCard = $('learn-card');
        els.learnWord = $('learn-word');
        els.learnArticle = $('learn-article');
        els.learnConj = $('learn-conj');
        els.learnEn = $('learn-en');
        els.learnUsage = $('learn-usage');
        els.learnUsageEn = $('learn-usage-en');
        els.learnUsageNl = $('learn-usage-nl');

        els.testCard = $('test-card');
        els.testPrompt = $('test-prompt');
        els.options = $('options');
        els.nav = $('nav');

        els.btnPrev = $('btn-prev');
        els.btnNext = $('btn-next');

        els.loading = $('loading');
        els.error = $('error');
        els.errorMsg = $('error-msg');
        els.btnRetry = $('btn-retry');
        els.footHint = $('foot-hint');

        els.endScreen = $('end-screen');
        els.endScore = $('end-score');
        els.endBreakdown = $('end-breakdown');
        els.endMsg = $('end-msg');

        try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
        catch (e) { reduceMotion = false; }

        audio = WoordWise.preloadSounds();

        els.btnPrev.addEventListener('click', onPrev);
        els.btnNext.addEventListener('click', onNext);
        els.btnRetry.addEventListener('click', function () { startFlow(); });

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