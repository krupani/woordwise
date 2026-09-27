/* WoordWise — online.js
 * Multi-provider AI wrapper with fallback + preference memory.
 *
 * Supported providers (extend by adding to PROVIDERS array):
 *   - Gemini  (Interactions API)
 *   - Groq    (OpenAI-compatible chat completions)
 *
 * Exposes on WoordWise.Online:
 *   MODELS, PROVIDERS, hasKey, getKey, setKey, clearKey, testKey, generate,
 *   requireKey, openKeyModal, closeKeyModal, updateButtonState, init,
 *   loadingTicker, LOADING_MESSAGES
 *
 * Fallback strategy:
 *   1. Read preferred provider from localStorage (last one that worked).
 *   2. Try preferred provider; on failure, try the other.
 *   3. On success, save the successful provider as the new preference.
 *
 * Security rules baked in:
 *   - API keys NEVER touch console.log.
 *   - LLM/user output must be rendered with textContent (WoordWise.safeText).
 */

(function () {
    'use strict';

    /* ---------------- Provider definitions ---------------- */

    /*
     * Each provider object:
     *   id:          unique string
     *   label:       human name (shown in modal)
     *   keyStorage:  localStorage key for the API key
     *   models:      array of model IDs (tried in order)
     *   timeoutMs:   per-model timeout
     *   call:        function(model, body, apiKey) -> Promise<data>
     *   extract:     function(data) -> string (extract text from response)
     */
    var PROVIDERS = [
        {
            id: 'gemini',
            label: 'Gemini',
            keyStorage: 'dutch.gemini.apiKey',
            models: ['gemini-3.6-flash', 'gemini-3.8-flash'],
            timeoutMs: 20000,
            call: function (model, body, apiKey) {
                var url = 'https://generativelanguage.googleapis.com/v1beta/interactions';

                /* Translate the shared body into Gemini's expected shape. */
                var payload = {
                    model: model,
                    input: body.input
                };
                if (body.system) {
                    payload.system_instruction = String(body.system);
                }
                if (body.json) {
                    payload.response_format = [{
                        type: 'text',
                        mime_type: 'application/json'
                    }];
                }

                return fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': apiKey
                    },
                    body: JSON.stringify(payload)
                }).then(function (r) {
                    if (!r.ok) {
                        return r.json().catch(function () { return {}; }).then(function (j) {
                            var msg = (j.error && j.error.message) || j.message || '';
                            var e = new Error('Gemini error ' + r.status + (msg ? ': ' + msg : ''));
                            e.status = r.status;
                            throw e;
                        });
                    }
                    return r.json();
                });
            },
            extract: function (data) {
                var steps = (data && data.steps) || [];
                var out = '';
                for (var i = 0; i < steps.length; i++) {
                    var step = steps[i];
                    if (step && step.type === 'model_output' && Array.isArray(step.content)) {
                        for (var j = 0; j < step.content.length; j++) {
                            var part = step.content[j];
                            if (part && part.type === 'text' && typeof part.text === 'string') {
                                out += part.text;
                            }
                        }
                    }
                }
                return out;
            }
        },
        {
            id: 'groq',
            label: 'Groq',
            keyStorage: 'dutch.groq.apiKey',
            models: ['openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'qwen/qwen3-32b'],
            timeoutMs: 20000,
            call: function (model, body, apiKey) {
                var url = 'https://api.groq.com/openai/v1/chat/completions';

                var messages = body.messages || [{ role: 'user', content: body.input || '' }];
                if (body.system) {
                    messages = [{ role: 'system', content: body.system }].concat(messages);
                }

                var basePayload = {
                    model: model,
                    messages: messages
                };
                if (body.max_tokens) basePayload.max_tokens = body.max_tokens;

                var jsonPayload = Object.assign({}, basePayload);
                if (body.json) jsonPayload.response_format = { type: 'json_object' };

                function doCall(payload) {
                    return fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + apiKey
                        },
                        body: JSON.stringify(payload)
                    }).then(function (r) {
                        if (!r.ok) {
                            return r.json().catch(function () { return {}; }).then(function (j) {
                                var msg = (j.error && j.error.message) || '';
                                var e = new Error('Groq error ' + r.status + (msg ? ': ' + msg : ''));
                                e.status = r.status;
                                e.groqCode = j.error && j.error.code;
                                throw e;
                            });
                        }
                        return r.json();
                    });
                }

                /* Try with Groq's strict JSON mode first.
                 * If Groq's validator rejects the model's output, retry the same
                 * model without JSON mode — most models produce valid JSON anyway,
                 * and we parse + strip fences ourselves. */
                return doCall(jsonPayload).catch(function (err) {
                    if (body.json && err && err.groqCode === 'json_validate_failed') {
                        return doCall(basePayload);
                    }
                    throw err;
                });
            },
            extract: function (data) {
                if (data && data.choices && data.choices[0] && data.choices[0].message) {
                    return data.choices[0].message.content || '';
                }
                return '';
            }
        }
    ];

    /* ---------------- localStorage helpers ---------------- */

    var PREF_KEY = 'dutch.ai.preferredProvider';

    function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function safeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function safeDel(k) { try { localStorage.removeItem(k); } catch (e) { } }

    function getPreferred() {
        var id = safeGet(PREF_KEY);
        for (var i = 0; i < PROVIDERS.length; i++) {
            if (PROVIDERS[i].id === id) return PROVIDERS[i];
        }
        return PROVIDERS[0];
    }

    function setPreferred(id) {
        safeSet(PREF_KEY, id);
    }

    function hasAnyKey() {
        for (var i = 0; i < PROVIDERS.length; i++) {
            var p = PROVIDERS[i];
            var k = safeGet(p.keyStorage);
            if (k && k.trim()) return true;
        }
        return false;
    }

    /* ---------------- Generic call with fallback ---------------- */

    function callProvider(provider, body, apiKey) {
        var lastErr;
        var idx = 0;

        function tryModel() {
            if (idx >= provider.models.length) {
                return Promise.reject(lastErr || new Error(provider.label + ' failed.'));
            }
            var model = provider.models[idx++];
            var timeoutId;
            var timeout = new Promise(function (_, reject) {
                timeoutId = setTimeout(function () {
                    var e = new Error(provider.label + ' model ' + model + ' timed out.');
                    e.code = 'TIMEOUT';
                    reject(e);
                }, provider.timeoutMs);
            });

            return Promise.race([
                provider.call(model, body, apiKey),
                timeout
            ]).then(
                function (v) { clearTimeout(timeoutId); return v; },
                function (e) {
                    clearTimeout(timeoutId);
                    lastErr = e;
                    // Fallback within provider: try next model on timeout / 404 / 429 / 5xx
                    var s = e.status;
                    if (e.code === 'TIMEOUT' || s === 404 || s === 429 ||
                        s === 500 || s === 502 || s === 503 || s === 504) {
                        return tryModel();
                    }
                    throw e;
                }
            );
        }

        return tryModel();
    }

    /**
     * Generate: try preferred provider first, fall back to the other(s).
     * Returns the extracted text (or parsed JSON if opts.json is true).
     */
    async function generate(prompt, opts) {
        opts = opts || {};

        var preferred = getPreferred();
        var ordered = [preferred].concat(
            PROVIDERS.filter(function (p) { return p.id !== preferred.id; })
        );

        var lastErr;
        for (var i = 0; i < ordered.length; i++) {
            var p = ordered[i];
            var key = (safeGet(p.keyStorage) || '').trim();
            if (!key) continue; // no key for this provider, skip

            var body = { input: String(prompt) };
            if (opts.system) body.system = String(opts.system);
            if (opts.json) body.json = true;

            try {
                var data = await callProvider(p, body, key);
                var text = p.extract(data);
                if (!text) throw new Error(p.label + ' returned empty response.');
                setPreferred(p.id);
                if (opts.json) {
                    try { return JSON.parse(text); }
                    catch (e) { throw new Error('Model returned invalid JSON.'); }
                }
                return text;
            } catch (e) {
                lastErr = e;
                // Continue to next provider
            }
        }

        // No provider succeeded
        if (!hasAnyKey()) {
            var e0 = new Error('NO_KEY');
            e0.code = 'NO_KEY';
            throw e0;
        }
        throw lastErr || new Error('All AI providers failed.');
    }

    /* ---------------- Test key ---------------- */

    async function testKey(providerId, rawKey) {
        var p = null;
        for (var i = 0; i < PROVIDERS.length; i++) {
            if (PROVIDERS[i].id === providerId) { p = PROVIDERS[i]; break; }
        }
        if (!p) return { ok: false, message: 'Unknown provider.' };
        var k = (rawKey || '').trim();
        if (!k) return { ok: false, message: 'Please paste a key first.' };

        try {
            var data = await callProvider(p, { input: 'hi', max_tokens: 1 }, k);
            var text = p.extract(data);
            if (!text && text !== '') {
                return { ok: false, message: 'Empty response — key may be invalid.' };
            }
            return { ok: true, message: 'Key works.' };
        } catch (e) {
            var s = e && e.status;
            if (s === 401 || s === 403) {
                return { ok: false, message: 'Key rejected (HTTP ' + s + ').' };
            }
            if (e && e.code === 'TIMEOUT') {
                return { ok: false, message: 'Request timed out.' };
            }
            if (e && !s) {
                return { ok: false, message: 'Network error.' };
            }
            return { ok: false, message: (e && e.message) || 'Unknown error.' };
        }
    }

    /* ---------------- API object ---------------- */

    var api = {
        PROVIDERS: PROVIDERS,
        hasAnyKey: hasAnyKey,
        generate: generate,
        testKey: testKey,
        // legacy aliases
        hasKey: hasAnyKey,
        getKey: function () {
            // return first available key (for legacy callers)
            for (var i = 0; i < PROVIDERS.length; i++) {
                var k = (safeGet(PROVIDERS[i].keyStorage) || '').trim();
                if (k) return k;
            }
            return '';
        },
        setKey: function (providerId, value) {
            for (var i = 0; i < PROVIDERS.length; i++) {
                if (PROVIDERS[i].id === providerId) {
                    if (!value) { safeDel(PROVIDERS[i].keyStorage); return true; }
                    return safeSet(PROVIDERS[i].keyStorage, String(value).trim());
                }
            }
            return false;
        },
        clearKey: function (providerId) {
            for (var i = 0; i < PROVIDERS.length; i++) {
                if (PROVIDERS[i].id === providerId) {
                    safeDel(PROVIDERS[i].keyStorage);
                    return;
                }
            }
        }
    };

    /* ---------------- Loading ticker (unchanged) ---------------- */

    var LOADING_MESSAGES = {
        default: [
            'Warming up the grammar engine\u2026',
            'Asking the AI nicely\u2026',
            'Request sent \u2014 awaiting response\u2026',
            'Waiting for the AI to think\u2026',
            'Reading the response\u2026',
            'Checking the grammar rules\u2026',
            'Polishing the output\u2026',
            'Almost there\u2026',
            'Hang on, this one\u2019s taking a while\u2026',
            'Still working \u2014 the AI is having a busy day\u2026',
            'Putting the kettle on \u2014 nearly there\u2026'
        ],
        retry: 'Hmm, that didn\u2019t quite work \u2014 asking again\u2026'
    };

    function loadingTicker(textEl, opts) {
        opts = opts || {};
        var messages = (Array.isArray(opts.messages) && opts.messages.length)
            ? opts.messages
            : LOADING_MESSAGES.default;
        var retryMsg = opts.retry || LOADING_MESSAGES.retry;
        var interval = opts.intervalMs || 2200;
        var idx = 0;
        var timer = null;
        var stopped = false;

        function setText(s) { if (textEl) textEl.textContent = s; }

        function schedule(delay) {
            clearTimeout(timer);
            if (stopped) return;
            timer = setTimeout(function () {
                idx = Math.min(idx + 1, messages.length - 1);
                setText(messages[idx]);
                schedule(interval);
            }, delay);
        }

        function start() {
            stopped = false;
            idx = 0;
            setText(messages[0]);
            schedule(interval);
        }

        function retry() {
            clearTimeout(timer);
            if (stopped) return;
            setText(retryMsg);
            schedule(interval);
        }

        function stop() {
            stopped = true;
            clearTimeout(timer);
            timer = null;
        }

        start();
        return { start: start, retry: retry, stop: stop };
    }

    /* ---------------- Grammar prompt builder ----------------
     * Shared by every AI game that generates Dutch sentences.
     * Games pass their selected rules + word range; the function returns
     * { system, user } ready for WoordWise.Online.generate().
     */

    var GRAMMAR_RULES = [
        'simple (SVTOP)',
        'inversion (TVSOP)',
        'modal verbs',
        'separable verbs',
        'closed questions',
        'open questions',
        'reflexive verbs',
        'demonstrative pronouns',
        'want vs omdat',
        'hebben vs zijn (perfect tense)',
        'negation (niet / geen)',
        'time and place order'
    ];

    function buildPrompt(opts) {
        opts = opts || {};
        var count = opts.count || 10;
        var minWords = opts.minWords || 10;
        var maxWords = opts.maxWords || 12;
        var minDistinct = opts.minDistinct || 3;
        var rules = (Array.isArray(opts.grammarRules) && opts.grammarRules.length)
            ? opts.grammarRules
            : GRAMMAR_RULES;

        var rulesList = rules.map(function (r) { return '- ' + r; }).join('\n');
        var need = Math.min(minDistinct, rules.length);

        var system = [
            'You are a Dutch language teacher creating A2-level exercises.',
            'Generate complete, natural, grammatically correct Dutch sentences at CEFR A2 level.',
            '',
            'Choose from this closed list of grammar rules ONLY:',
            rulesList,
            '',
            'Rules for each sentence:',
            '- Between ' + minWords + ' and ' + maxWords + ' words.',
            '- Must end with ".", "!" or "?".',
            '- Must be natural, everyday Dutch.',
            '- Must clearly demonstrate exactly ONE primary grammar rule from the list above.',
            '- Use the "grammar" field with the exact label from the list (copy the label verbatim).',
            '- Provide a short English translation in "en".',
            '- Provide a one-sentence English explanation of the rule in "explain".',
            '',
            'Respond with strict JSON only \u2014 no prose, no markdown fences:',
            '{"sentences":[{"correct":"...","grammar":"...","en":"...","explain":"..."}]}'
        ].join('\n');

        var user = [
            'Generate ' + count + ' sentences.',
            'Use at least ' + need + ' distinct grammar rules from the list.',
            'Return only the JSON object.'
        ].join(' ');

        return { system: system, user: user };
    }

    /* ---------------- Chrome: LLM button ---------------- */

    function injectButton() {
        if (document.getElementById('ww-llm-btn')) return;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'ww-llm-btn';
        btn.className = 'ww-llm-btn';
        btn.title = 'Connect AI';
        btn.innerHTML =
            '<span>\u2726 AI</span>' +
            '<span class="ww-llm-dot" aria-hidden="true"></span>';
        btn.addEventListener('click', openKeyModal);
        document.body.appendChild(btn);
        updateButtonState();
    }

    function updateButtonState() {
        var btn = document.getElementById('ww-llm-btn');
        if (!btn) return;
        btn.classList.toggle('has-key', hasAnyKey());
    }

    /* ---------------- Modal ---------------- */

    var modalEl, statusEl, testBtns, saveBtns, removeBtns, closeBtn;
    var lastFocused = null;

    function buildModal() {
        if (modalEl) return;

        modalEl = document.createElement('div');
        modalEl.className = 'ww-modal-backdrop';
        modalEl.id = 'ww-modal';
        modalEl.hidden = true;

        var rows = '';
        for (var i = 0; i < PROVIDERS.length; i++) {
            var p = PROVIDERS[i];
            rows += [
                '<div class="ww-provider-row" data-provider="' + p.id + '">',
                '  <label>' + p.label + '</label>',
                '  <div class="ww-input-row">',
                '    <input type="password" id="ww-key-' + p.id + '" placeholder="API key..." autocomplete="off" spellcheck="false">',
                '    <button type="button" class="ww-toggle-vis" data-target="ww-key-' + p.id + '" aria-label="Show/hide">\uD83D\uDC41</button>',
                '  </div>',
                '  <div class="ww-provider-actions">',
                '    <button type="button" class="ww-btn-secondary ww-test-btn" data-provider="' + p.id + '">Test</button>',
                '    <button type="button" class="ww-btn-primary ww-save-btn" data-provider="' + p.id + '">Save</button>',
                '    <button type="button" class="ww-btn-danger ww-remove-btn" data-provider="' + p.id + '">Remove</button>',
                '  </div>',
                '  <p class="ww-provider-status" id="ww-status-' + p.id + '" aria-live="polite"></p>',
                '</div>'
            ].join('');
        }

        modalEl.innerHTML = [
            '<div class="ww-modal" role="dialog" aria-modal="true">',
            '  <button type="button" class="ww-modal-close" id="ww-modal-close" aria-label="Close">\u00D7</button>',
            '  <h2>Connect AI</h2>',
            '  <p class="ww-modal-sub">Add one or more provider keys. The first that works is used.</p>',
            rows,
            '  <p class="ww-modal-note">Stored only on this device. Keys are never shared.</p>',
            '</div>'
        ].join('');

        document.body.appendChild(modalEl);

        statusEl = modalEl;
        closeBtn = modalEl.querySelector('#ww-modal-close');
        closeBtn.addEventListener('click', closeKeyModal);
        modalEl.addEventListener('mousedown', function (e) {
            if (e.target === modalEl) closeKeyModal();
        });

        modalEl.querySelectorAll('.ww-toggle-vis').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var input = document.getElementById(btn.dataset.target);
                if (!input) return;
                input.type = input.type === 'password' ? 'text' : 'password';
                input.focus();
            });
        });

        modalEl.querySelectorAll('.ww-test-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var pid = btn.dataset.provider;
                var input = document.getElementById('ww-key-' + pid);
                var status = document.getElementById('ww-status-' + pid);
                status.textContent = 'Testing\u2026';
                btn.disabled = true;
                testKey(pid, input.value).then(function (res) {
                    status.textContent = res.message;
                    status.className = 'ww-provider-status ' + (res.ok ? 'ok' : 'err');
                    btn.disabled = false;
                });
            });
        });

        modalEl.querySelectorAll('.ww-save-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var pid = btn.dataset.provider;
                var input = document.getElementById('ww-key-' + pid);
                var status = document.getElementById('ww-status-' + pid);
                if (!input.value.trim()) {
                    status.textContent = 'Enter a key first.';
                    status.className = 'ww-provider-status err';
                    return;
                }
                if (api.setKey(pid, input.value)) {
                    status.textContent = 'Saved.';
                    status.className = 'ww-provider-status ok';
                    updateButtonState();
                    try { window.dispatchEvent(new CustomEvent('woordwise:key-saved')); } catch (e) { }
                } else {
                    status.textContent = 'Could not save.';
                    status.className = 'ww-provider-status err';
                }
            });
        });

        modalEl.querySelectorAll('.ww-remove-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var pid = btn.dataset.provider;
                api.clearKey(pid);
                var input = document.getElementById('ww-key-' + pid);
                if (input) input.value = '';
                var status = document.getElementById('ww-status-' + pid);
                status.textContent = 'Removed.';
                status.className = 'ww-provider-status ok';
                updateButtonState();
            });
        });

        document.addEventListener('keydown', onModalKeydown);
    }

    function onModalKeydown(e) {
        if (!modalEl || modalEl.hidden) return;
        if (e.key === 'Escape') { e.preventDefault(); closeKeyModal(); }
    }

    function openKeyModal() {
        buildModal();
        lastFocused = document.activeElement;
        modalEl.hidden = false;

        // Pre-fill inputs with any saved keys
        for (var i = 0; i < PROVIDERS.length; i++) {
            var p = PROVIDERS[i];
            var input = document.getElementById('ww-key-' + p.id);
            var status = document.getElementById('ww-status-' + p.id);
            if (!input) continue;
            var saved = (safeGet(p.keyStorage) || '').trim();
            input.value = saved;
            input.type = 'password';
            status.textContent = saved ? 'A key is saved.' : '';
            status.className = 'ww-provider-status' + (saved ? ' ok' : '');
        }

        setTimeout(function () {
            var first = modalEl.querySelector('input');
            if (first) first.focus();
        }, 30);
    }

    function closeKeyModal() {
        if (!modalEl) return;
        modalEl.hidden = true;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    function requireKey() {
        if (hasAnyKey()) return true;
        openKeyModal();
        return false;
    }

    /* ---------------- Public API + boot hook ---------------- */

    api.loadingTicker = loadingTicker;
    api.LOADING_MESSAGES = LOADING_MESSAGES;
    api.GRAMMAR_RULES = GRAMMAR_RULES;
    api.buildPrompt = buildPrompt;
    api.openKeyModal = openKeyModal;
    api.closeKeyModal = closeKeyModal;
    api.requireKey = requireKey;
    api.updateButtonState = updateButtonState;

    api.init = function () {
        injectButton();
    };

    window.WoordWise = window.WoordWise || {};
    window.WoordWise.Online = api;
    window.WoordWise.Gemini = api;

})();