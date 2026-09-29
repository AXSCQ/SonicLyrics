/**
 * SonicLyrics — Word-level lyrics synchronization for audio-reactive web experiences.
 *
 * Integrates with SonicMotion via currentTime polling at 60fps.
 * Fires callbacks for individual words, lines, and user-defined tags.
 *
 * @version 1.0.0
 */

import { WordScheduler } from './word-scheduler.js';
import { LineTracker }   from './line-tracker.js';
import { TagDispatcher } from './tag-dispatcher.js';
import { DOMRenderer }   from './dom-renderer.js';
import { LyricsTimeline } from './lyrics-timeline.js';

class SonicLyricsInstance {
    /**
     * @param {object} config
     * @param {string|object}      config.src       - URL to lyrics.json OR pre-loaded lyrics object
     * @param {object}             [config.sonic]   - SonicMotion instance (for currentTime sync)
     * @param {HTMLAudioElement}   [config.audio]   - Fallback: raw <audio> element
     * @param {number}             [config.lookahead=0.08] - Seconds to fire before word starts
     * @param {object}             [config.render]  - DOMRenderer config (optional)
     */
    constructor(config = {}) {
        this._config      = config;
        this._sonic       = config.sonic   ?? null;
        this._audio       = config.audio   ?? null;
        this._lookahead   = config.lookahead ?? 0.08;

        this._scheduler   = new WordScheduler({ lookahead: this._lookahead });
        this._lineTracker = new LineTracker();
        this._tagDispatch = new TagDispatcher();
        this._renderer    = config.render ? new DOMRenderer(config.render) : null;

        this._loaded      = false;
        this._rafId       = null;
        this._running     = false;
        this._lyricsData  = null;

        // Word callbacks registered before load
        this._wordQueue     = [];
        this._lineQueue     = [];
        this._phraseListeners = new Map();

        // Load if src provided
        if (config.src) {
            this._loadSource(config.src);
        }
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * Load lyrics from URL or object.
     * @param {string|object} src
     * @returns {Promise<this>}
     */
    async load(src) {
        await this._loadSource(src);
        return this;
    }

    /**
     * Register a callback for EVERY word as it fires.
     * @param {Function} fn - Called with (wordObj)
     * @returns {Function} unsubscribe
     */
    onWord(fn) {
        if (!this._loaded) {
            this._wordQueue.push(fn);
            return () => { this._wordQueue = this._wordQueue.filter(f => f !== fn); };
        }
        return this._scheduler.onWord((word) => {
            this._tagDispatch.dispatch(word); // Route tags
            if (this._renderer) this._renderer.renderWord(word, this._scheduler._cursor);
            fn(word);
        });
    }

    /**
     * Register a callback when the active lyric LINE changes.
     * @param {Function} fn - Called with (lineObj | null)
     * @returns {Function} unsubscribe
     */
    onLine(fn) {
        if (!this._loaded) {
            this._lineQueue.push(fn);
            return () => { this._lineQueue = this._lineQueue.filter(f => f !== fn); };
        }
        return this._lineTracker.onLine((line) => {
            if (this._renderer) this._renderer.renderLine(line);
            fn(line);
        });
    }

    /**
     * Subscribe to words with a specific tag.
     * @param {string}   tag
     * @param {Function} fn - Called with (wordObj, tag)
     * @returns {Function} unsubscribe
     */
    onTag(tag, fn) {
        return this._tagDispatch.on(tag, fn);
    }

    /**
     * Subscribe to any tagged word.
     * @param {Function} fn - Called with (wordObj, tags[])
     * @returns {Function} unsubscribe
     */
    onAnyTag(fn) {
        return this._tagDispatch.onAny(fn);
    }

    /**
     * Subscribe to a named phrase/section.
     * @param {string}   phraseId  - matches phrase.id in lyrics.json
     * @param {Function} fn        - Called with (phraseObj) on enter, null on exit
     * @returns {Function} unsubscribe
     */
    onPhrase(phraseId, fn) {
        if (!this._phraseListeners.has(phraseId)) {
            this._phraseListeners.set(phraseId, []);
        }
        this._phraseListeners.get(phraseId).push(fn);
        return () => {
            const arr = this._phraseListeners.get(phraseId);
            if (arr) {
                const i = arr.indexOf(fn);
                if (i !== -1) arr.splice(i, 1);
            }
        };
    }

    /**
     * Start the sync loop (call after sonic.play()).
     * Usually called automatically if sonic instance is provided.
     */
    start() {
        if (this._running) return this;
        this._running = true;
        this._loop();
        return this;
    }

    /**
     * Stop the sync loop.
     */
    stop() {
        this._running = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        return this;
    }

    /**
     * Seek to a specific time (e.g. after audio seek).
     * @param {number} time
     */
    seek(time) {
        this._scheduler.reset();
        this._lineTracker.reset();
        this._activePhraseIds = new Set();
    }

    /**
     * Get the currently active word object.
     */
    get currentWord() {
        return this._scheduler.activeWord;
    }

    /**
     * Get the currently active line object.
     */
    get currentLine() {
        return this._lineTracker.activeLine;
    }

    /**
     * Progress (0–1) within the current line.
     */
    get lineProgress() {
        return this._lineTracker.lineProgress(this._currentTime);
    }

    /**
     * All loaded lyrics data.
     */
    get data() {
        return this._lyricsData;
    }

    /**
     * Clean up all resources.
     */
    destroy() {
        this.stop();
        this._scheduler    = new WordScheduler();
        this._lineTracker  = new LineTracker();
        this._tagDispatch.clear();
        this._renderer?.destroy();
        this._phraseListeners.clear();
    }

    // ── Internal ────────────────────────────────────────────────────────────

    async _loadSource(src) {
        let data;
        if (typeof src === 'string') {
            const res = await fetch(src);
            if (!res.ok) throw new Error(`SonicLyrics: Failed to load "${src}" (${res.status})`);
            data = await res.json();
        } else {
            data = src;
        }

        this._lyricsData = data;
        this._scheduler.load(data.words ?? []);
        this._lineTracker.load(data.lines ?? []);
        this._phrases = data.phrases ?? [];
        this._activePhraseIds = new Set();
        this._loaded = true;

        // Flush queued callbacks
        this._wordQueue.forEach(fn => this.onWord(fn));
        this._wordQueue = [];
        this._lineQueue.forEach(fn => this.onLine(fn));
        this._lineQueue = [];

        // Auto-start if sonic is provided
        if (this._sonic || this._audio) {
            this.start();
        }

        return data;
    }

    _loop() {
        if (!this._running) return;

        const t = this._getTime();
        this._currentTime = t;

        if (t >= 0) {
            // Word scheduler
            this._scheduler.update(t);

            // Line tracker
            this._lineTracker.update(t);

            // Phrase tracker
            this._trackPhrases(t);
        }

        this._rafId = requestAnimationFrame(() => this._loop());
    }

    _getTime() {
        if (this._sonic && typeof this._sonic.currentTime === 'number') {
            return this._sonic.currentTime;
        }
        if (this._audio) {
            return this._audio.currentTime;
        }
        return -1;
    }

    _trackPhrases(t) {
        for (const phrase of this._phrases) {
            const wasActive = this._activePhraseIds.has(phrase.id);
            const isActive  = t >= phrase.start && t <= phrase.end;

            if (isActive && !wasActive) {
                // Entered phrase
                this._activePhraseIds.add(phrase.id);
                const listeners = this._phraseListeners.get(phrase.id);
                if (listeners) listeners.forEach(fn => {
                    try { fn(phrase); } catch (e) { /* */ }
                });
            } else if (!isActive && wasActive) {
                // Exited phrase
                this._activePhraseIds.delete(phrase.id);
                const listeners = this._phraseListeners.get(phrase.id);
                if (listeners) listeners.forEach(fn => {
                    try { fn(null); } catch (e) { /* */ }
                });
            }
        }
    }
}

// ── Static Factory ──────────────────────────────────────────────────────────

const SonicLyrics = {
    /**
     * Create a SonicLyrics instance.
     * @param {object} config
     * @returns {SonicLyricsInstance}
     */
    create(config = {}) {
        return new SonicLyricsInstance(config);
    },

    /**
     * Seek-safe, query-by-time view of a lyrics object (for render loops).
     * @param {object} data - lyrics.json contents
     * @returns {LyricsTimeline}
     */
    timeline(data) {
        return new LyricsTimeline(data);
    },

    version: '1.1.0'
};

export default SonicLyrics;
export { SonicLyricsInstance, SonicLyrics, LyricsTimeline };
