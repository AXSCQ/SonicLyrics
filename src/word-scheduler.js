/**
 * WordScheduler — Precision word-level event scheduler.
 *
 * Given an array of word objects { word, start, end, ... }, fires callbacks
 * at the right moment based on currentTime polling (every frame).
 *
 * - A word fires once, `lookahead` seconds before its start (animation
 *   pre-roll), even when the previous word is still sounding: sung lyrics
 *   are contiguous (one word ends where the next starts), and waiting for
 *   the previous word to finish made every word fire late.
 * - Words already over when reached (a seek forward, a slow frame of more
 *   than `overlap` past their end) are skipped, not fired in a burst.
 * - Words collapsed on the same timestamp (a Whisper artifact) are spread
 *   over the gap to the next word, so each one fires (see repairTiming).
 * - Seeking backward rewinds; the words from there on fire again.
 */
import { repairTiming } from './lyrics-timeline.js';

export class WordScheduler {
    /**
     * @param {object} config
     * @param {number} [config.lookahead=0.08] - Seconds to fire before the word starts (for animation pre-roll)
     * @param {number} [config.overlap=0.05]   - Seconds past word.end a late word may still fire
     */
    constructor(config = {}) {
        this._lookahead = config.lookahead ?? 0.08;
        this._overlap   = config.overlap   ?? 0.05;

        /** @type {Array<{word, start, end, confidence, line, tags, ...}>} */
        this._words = [];

        /** @type {Set<Function>} */
        this._listeners = new Set();

        /** Index of the next word to fire */
        this._cursor = 0;

        /** Currently "active" word index (-1 = none) */
        this._activeIdx = -1;
        this._lastTime = -1;
    }

    /**
     * Load words (any order; repaired and sorted by start time)
     * @param {Array} words
     */
    load(words) {
        this._words = repairTiming([...words].sort((a, b) => a.start - b.start));
        this.reset();
        return this;
    }

    /**
     * Register a callback for every word
     * @param {Function} fn - Called with (wordObj, index)
     * @returns {Function} unsubscribe
     */
    onWord(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    /**
     * Update — call every animation frame with the current audio time.
     * @param {number} currentTime - Audio currentTime in seconds
     * @returns {object|null} the active word
     */
    update(currentTime) {
        const words = this._words;
        if (!words.length) return null;

        // Seeked backward: rewind to the first word that has not started yet
        if (currentTime < this._lastTime - 0.25) {
            this._cursor = this._firstStartingAfter(currentTime - this._lookahead);
        }
        this._lastTime = currentTime;

        // Fire every word whose pre-roll has begun
        while (this._cursor < words.length && words[this._cursor].start - this._lookahead <= currentTime) {
            const i = this._cursor++;
            const w = words[i];
            if (currentTime > w.end + this._overlap) continue;   // already over: skip
            this._listeners.forEach(fn => { try { fn(w, i); } catch (e) { /* */ } });
        }

        // Active word: the latest one that started (with pre-roll) and has not ended
        this._activeIdx = -1;
        for (let i = this._cursor - 1; i >= 0; i--) {
            const w = words[i];
            if (currentTime <= w.end + this._overlap) { this._activeIdx = i; break; }
            if (w.end + this._overlap < currentTime - 5) break;   // far behind: stop looking
        }
        return this.activeWord;
    }

    /**
     * Get the currently active word
     */
    get activeWord() {
        return this._activeIdx >= 0 ? this._words[this._activeIdx] : null;
    }

    /**
     * Get next upcoming word
     */
    get nextWord() {
        return this._words[this._cursor] ?? null;
    }

    /**
     * Reset state (e.g. when audio restarts)
     */
    reset() {
        this._cursor    = 0;
        this._activeIdx = -1;
        this._lastTime  = -1;
    }

    // First index whose start is > time
    _firstStartingAfter(time) {
        let lo = 0, hi = this._words.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this._words[mid].start <= time) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    get wordCount() { return this._words.length; }
}
