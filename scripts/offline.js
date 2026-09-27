/* WoordWise — offline.js
 * Shared word-data loader for offline games. Include AFTER base.js.
 *
 * Data files (each assigns a global):
 *   data/nouns.js       → window.WOORDWISE_NOUNS        [{ en, nl, article }]
 *   data/adjectives.js  → window.WOORDWISE_ADJECTIVES   [{ en, nl }]
 *   data/verbs.js       → window.WOORDWISE_VERBS        [{ en, nl, conjugation }]
 *
 * Exposes:
 *   WoordWise.Offline.loadGroup('nouns'|'adjectives'|'verbs') → Promise<array>
 *   WoordWise.Offline.loadAll()                                → Promise<array>
 *   WoordWise.Offline.loadSelected(groups[])                   → Promise<array>
 *   WoordWise.Offline.buildSession(pool, n)                    → shuffled slice
 */

(function () {
    'use strict';

    var FILES = {
        nouns:      { url: 'data/nouns.js',      global: 'WOORDWISE_NOUNS',      requireArticle: true  },
        adjectives: { url: 'data/adjectives.js', global: 'WOORDWISE_ADJECTIVES', requireArticle: false },
        verbs:      { url: 'data/verbs.js',      global: 'WOORDWISE_VERBS',      requireArticle: false }
    };

    var groupCache = {};
    var allCache   = null;

    function validate(data, requireArticle) {
        if (!Array.isArray(data)) throw new Error('word data must be an array.');

        return data.filter(function (w) {
            if (!w) return false;
            if (typeof w.en !== 'string' || !w.en.trim()) return false;
            if (typeof w.nl !== 'string' || !w.nl.trim()) return false;
            if (requireArticle && w.article !== 'de' && w.article !== 'het') return false;
            return true;
        });
    }

    function injectScript(url) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = url;
            s.onload  = resolve;
            s.onerror = function () { reject(new Error('Could not load ' + url)); };
            document.head.appendChild(s);
        });
    }

    function loadGroup(name) {
        if (!FILES[name]) return Promise.reject(new Error('Unknown group: ' + name));
        if (groupCache[name]) return Promise.resolve(groupCache[name]);

        var meta = FILES[name];

        function finish() {
            var raw = window[meta.global];
            if (!Array.isArray(raw)) {
                if (name === 'verbs' || name === 'adjectives') {
                    groupCache[name] = [];
                    return groupCache[name];
                }
                throw new Error('data file for "' + name + '" did not define ' + meta.global);
            }
            var clean = validate(raw, meta.requireArticle);
            groupCache[name] = clean;
            return clean;
        }

        if (Array.isArray(window[meta.global])) {
            try { return Promise.resolve(finish()); }
            catch (e) { return Promise.reject(e); }
        }

        return injectScript(meta.url).then(function () {
            try { return finish(); }
            catch (e) { throw e; }
        });
    }

    function loadAll() {
        if (allCache) return Promise.resolve(allCache);
        return Promise.all([
            loadGroup('nouns'),
            loadGroup('adjectives'),
            loadGroup('verbs')
        ]).then(function (groups) {
            allCache = groups[0].concat(groups[1], groups[2]);
            return allCache;
        });
    }

    /**
     * Load only the requested groups and merge them into one pool.
     * Groups that were deselected are never fetched.
     */
    function loadSelected(groups) {
        if (!Array.isArray(groups) || !groups.length) {
            return Promise.resolve([]);
        }

        var promises = groups.map(function (name) {
            return loadGroup(name).catch(function () { return []; });
        });

        return Promise.all(promises).then(function (results) {
            var merged = [];
            results.forEach(function (arr) {
                if (Array.isArray(arr)) merged = merged.concat(arr);
            });
            return merged;
        });
    }

    function buildSession(pool, n) {
        return window.WoordWise.shuffle(pool).slice(0, Math.min(n, pool.length));
    }

    window.WoordWise = window.WoordWise || {};
    window.WoordWise.Offline = {
        loadGroup: loadGroup,
        loadAll: loadAll,
        loadSelected: loadSelected,
        buildSession: buildSession
    };
})();