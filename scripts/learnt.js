/* WoordWise — learnt.js
 * Rolling cache of learnt vocabulary across games, per word category.
 * Load AFTER base.js.
 *
 * Storage layout (localStorage):
 *   dutch.learnt.version             — schema version (bump = wipe all)
 *   dutch.learnt.nouns               — { "<nl>": record, ... }
 *   dutch.learnt.adjectives          — same
 *   dutch.learnt.verbs               — same
 *
 * Record shape:
 *   {
 *     en: string,
 *     nl: string,
 *     category: 'nouns' | 'adjectives' | 'verbs',
 *     shown: number,        // learning-phase displays (once per session)
 *     tested: number,       // test-phase questions seen
 *     correct: number,      // right answers in test
 *     mistakes: number,     // wrong answers in test
 *     lastSeen: number      // unix ms
 *   }
 *
 * Mastery rule: mistakes === 0 && correct >= 2
 *
 * Only the Vocabulary game writes to this cache. Match / Conjugate /
 * Spell It in Practice mode read from it and never write back — see
 * CONTRIBUTING.md for the reasoning.
 *
 * Exposes on WoordWise.Learnt:
 *   ensure(category, word)              → creates record if missing
 *   increment(category, word, field)    → bump one counter
 *   markTested(category, word, correct) → tested+1 (+ correct or mistakes+1)
 *   get(category, nl), getCategory(cat), countByCategory(cat)
 *   isMastered(record)
 *   getForRelearn(categories, max, min) → wrong-first list for Vocabulary
 *   getForPractice(categories, limit)   → for Match / Conjugate / Spell It
 *   stats()                             → per-category summary
 *   clearCategory(cat), clearAll()
 */

(function () {
    'use strict';

    var PREFIX = 'dutch.learnt.';
    var VERSION_KEY = PREFIX + 'version';
    var VERSION = '1';
    var MAX_PER_CATEGORY = 200;

    var CATEGORIES = ['nouns', 'adjectives', 'verbs'];

    /* ---------------- safe localStorage ---------------- */

    function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function safeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function safeDel(k) { try { localStorage.removeItem(k); } catch (e) { } }

    /* ---------------- version guard ---------------- */

    function ensureVersion() {
        var v = safeGet(VERSION_KEY);
        if (v !== VERSION) {
            clearAll();
            safeSet(VERSION_KEY, VERSION);
        }
    }

    /* ---------------- bucket IO ---------------- */

    function bucketKey(category) {
        return PREFIX + category;
    }

    function loadCategory(category) {
        var raw = safeGet(bucketKey(category));
        if (!raw) return {};
        try {
            var obj = JSON.parse(raw);
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
            return obj;
        } catch (e) { return {}; }
    }

    function saveCategory(category, records) {
        /* FIFO cap by lastSeen — drop oldest when over MAX_PER_CATEGORY. */
        var keys = Object.keys(records);
        if (keys.length > MAX_PER_CATEGORY) {
            keys.sort(function (a, b) {
                return (records[a].lastSeen || 0) - (records[b].lastSeen || 0);
            });
            var toDrop = keys.slice(0, keys.length - MAX_PER_CATEGORY);
            toDrop.forEach(function (k) { delete records[k]; });
        }
        safeSet(bucketKey(category), JSON.stringify(records));
    }

    /* ---------------- record shape ---------------- */

    function newRecord(word, category) {
        return {
            en: word.en || '',
            nl: word.nl || '',
            category: category,
            shown: 0,
            tested: 0,
            correct: 0,
            mistakes: 0,
            streak: 0,
            lastSeen: Date.now()
        };
    }

    /* ---------------- write API ---------------- */

    /**
     * Ensures a record exists for this word. Creates it with counters at
     * zero if missing. Does NOT increment `shown` — the caller decides
     * when to do that (once per session per word in the Vocabulary game).
     * Returns the current record.
     */
    function ensure(category, word) {
        if (!word || !word.nl) return null;
        var all = loadCategory(category);
        var key = word.nl;
        if (!all[key]) {
            all[key] = newRecord(word, category);
            saveCategory(category, all);
        }
        return all[key];
    }

    /**
     * Increment a single counter on a word's record.
     * field = 'shown' | 'tested' | 'correct' | 'mistakes'
     * Also refreshes lastSeen. Creates the record if missing.
     */
    function increment(category, word, field, by) {
        if (!word || !word.nl) return null;
        by = (typeof by === 'number') ? by : 1;

        var all = loadCategory(category);
        var key = word.nl;
        if (!all[key]) all[key] = newRecord(word, category);

        if (typeof all[key][field] !== 'number') all[key][field] = 0;
        all[key][field] += by;
        all[key].lastSeen = Date.now();

        saveCategory(category, all);
        return all[key];
    }

    /**
     * Convenience wrapper for the test phase:
     *   markTested(cat, word, true)  → tested+1, correct+1, lastSeen
     *   markTested(cat, word, false) → tested+1, mistakes+1, lastSeen
     */
    function markTested(category, word, correct) {
        if (!word || !word.nl) return null;
        var all = loadCategory(category);
        var key = word.nl;
        if (!all[key]) all[key] = newRecord(word, category);
        if (typeof all[key].streak !== 'number') all[key].streak = 0;   /* migrate old records */

        all[key].tested = (all[key].tested || 0) + 1;
        if (correct) {
            all[key].correct = (all[key].correct || 0) + 1;
            all[key].streak = (all[key].streak || 0) + 1;
        } else {
            all[key].mistakes = (all[key].mistakes || 0) + 1;
            all[key].streak = 0;
        }
        all[key].lastSeen = Date.now();

        saveCategory(category, all);
        return all[key];
    }


    /* ---------------- read API ---------------- */

    function get(category, nl) {
        var all = loadCategory(category);
        return all[nl] || null;
    }

    function getCategory(category) {
        var all = loadCategory(category);
        return Object.keys(all).map(function (k) { return all[k]; });
    }

    function countByCategory(category) {
        return Object.keys(loadCategory(category)).length;
    }

    function isMastered(rec) {
        if (!rec) return false;
        return (rec.streak || 0) >= 3;
    }

    /* ---------------- selection helpers ---------------- */

    function collectWrong(categories) {
        var pool = [];
        categories.forEach(function (cat) {
            getCategory(cat).forEach(function (rec) {
                if ((rec.mistakes || 0) > 0) pool.push(rec);
            });
        });
        /* Most mistakes first; oldest lastSeen as tiebreaker. */
        pool.sort(function (a, b) {
            if (b.mistakes !== a.mistakes) return b.mistakes - a.mistakes;
            return (a.lastSeen || 0) - (b.lastSeen || 0);
        });
        return pool;
    }

    function collectNonMastered(categories, excludeNls) {
        var excl = {};
        (excludeNls || []).forEach(function (k) { excl[k] = 1; });

        var pool = [];
        categories.forEach(function (cat) {
            getCategory(cat).forEach(function (rec) {
                if (excl[rec.nl]) return;
                if (isMastered(rec)) return;
                pool.push(rec);
            });
        });
        /* Oldest lastSeen first. */
        pool.sort(function (a, b) {
            return (a.lastSeen || 0) - (b.lastSeen || 0);
        });
        return pool;
    }

    /**
     * Words to reuse in the next Vocabulary session.
     * - Up to `max` wrong words (highest mistake count first)
     * - If wrong words exist but fewer than `min`, top up from other
     *   non-mastered cached words to reach `min` total.
     */
    function getForRelearn(categories, max, min) {
        max = (typeof max === 'number') ? max : 5;
        min = (typeof min === 'number') ? min : 3;

        var wrongs = collectWrong(categories);
        var picked = wrongs.slice(0, max);

        if (picked.length > 0 && picked.length < min) {
            var excludeNls = picked.map(function (r) { return r.nl; });
            var others = collectNonMastered(categories, excludeNls);
            var need = min - picked.length;
            picked = picked.concat(others.slice(0, need));
        }
        return picked;
    }

    /**
     * Words for Practice mode in Match / Conjugate / Spell It.
     * Prioritises wrong words, then fills with other non-mastered cached
     * words. Returns fewer than `limit` only if the cache is short.
     */
    function getForPractice(categories, limit) {
        limit = (typeof limit === 'number') ? limit : 10;
        var wrongs = collectWrong(categories);
        var picked = wrongs.slice(0, limit);

        if (picked.length < limit) {
            var excludeNls = picked.map(function (r) { return r.nl; });
            var others = collectNonMastered(categories, excludeNls);
            picked = picked.concat(others.slice(0, limit - picked.length));
        }
        return picked;
    }

    /* ---------------- stats + admin ---------------- */

    function stats() {
        var result = { categories: {}, total: 0 };
        CATEGORIES.forEach(function (cat) {
            var all = loadCategory(cat);
            var keys = Object.keys(all);
            var wrong = 0, mastered = 0;
            keys.forEach(function (k) {
                var rec = all[k];
                if ((rec.mistakes || 0) > 0) wrong++;
                if (isMastered(rec)) mastered++;
            });
            result.categories[cat] = {
                total: keys.length,
                wrong: wrong,
                mastered: mastered
            };
            result.total += keys.length;
        });
        return result;
    }

    function clearCategory(category) {
        safeDel(bucketKey(category));
    }

    function clearAll() {
        CATEGORIES.forEach(function (cat) {
            safeDel(bucketKey(cat));
        });
    }

    /* ---------------- boot ---------------- */

    ensureVersion();

    window.WoordWise = window.WoordWise || {};
    window.WoordWise.Learnt = {
        CATEGORIES: CATEGORIES,

        /* write */
        ensure: ensure,
        increment: increment,
        markTested: markTested,

        /* read */
        get: get,
        getCategory: getCategory,
        countByCategory: countByCategory,
        isMastered: isMastered,

        /* selection */
        getForRelearn: getForRelearn,
        getForPractice: getForPractice,

        /* admin */
        stats: stats,
        clearCategory: clearCategory,
        clearAll: clearAll
    };
})();