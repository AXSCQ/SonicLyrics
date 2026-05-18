/**
 * WordScheduler — Precision word-level event scheduler.
 *
 * Given a sorted array of word objects { word, start, end, ... },
 * fires callbacks at the right moment based on currentTime polling.
 * Uses a binary-search cursor to avoid O(n) scanning every frame.
 */
export class WordScheduler {
    /**
     * @param {object} config
     * @param {number} [config.lookahead=0.08] - Seconds to fire before the word starts (for animation pre-roll)
     * @param {number} [config.overlap=0.05]   - Seconds past word.end before it's considered "done"
     */
    constructor(config = {}) {
        this._lookahead = config.lookahead ?? 0.08;
        this._overlap   = config.overlap   ?? 0.05;

        /** @type {Array<{word, start, end, confidence, line, tags, ...}>} */
        this._words = [];

        /** @type {Map<Function, {fired: Set<number>}>} */
        this._listeners = new Map();

        /** Index of the next word to potentially fire */
        this._cursor = 0;

        /** Currently "active" word index (-1 = none) */
        this._activeIdx = -1;
    }

    /**
     * Load words array (sorted by start time)
     * @param {Array} words
     */
    load(words) {
        // Sort defensively
        this._words = [...words].sort((a, b) => a.start - b.start);
        this.reset();
        return this;
    }

    /**
     * Register a callback for every word
     * @param {Function} fn - Called with (wordObj, index)
     */
    onWord(fn) {
        this._listeners.set(fn, { fired: new Set() });
        return () => this._listeners.delete(fn);
    }

    /**
     * Update — call every animation frame with the current audio time.
     * @param {number} currentTime - Audio currentTime in seconds
     */
    update(currentTime) {
        const words = this._words;
        if (!words.length) return null;

        // Seek forward if we jumped (play) or backward if we seeked back
        if (currentTime < this._lastTime - 0.5) {
            // Seeked backward — rewind cursor
            this._cursor = this._binarySearch(currentTime);
            this._activeIdx = -1;
            // Clear "fired" state for all listeners
            this._listeners.forEach(state => state.fired.clear());
        }
        this._lastTime = currentTime;

        // Advance cursor forward efficiently
        let newActive = null;

        for (let i = this._cursor; i < words.length; i++) {
            const w = words[i];

            // Past this word entirely — advance cursor
            if (currentTime > w.end + this._overlap) {
                this._cursor = i + 1;
                continue;
            }

            // Too early for next word
            if (currentTime < w.start - this._lookahead) break;

            // Word is in the lookahead-to-end window → it's "active"
            const isActive = currentTime >= w.start - this._lookahead &&
                             currentTime <= w.end + this._overlap;

            if (isActive) {
                newActive = w;

                // Fire each listener if not already fired for this word index
                this._listeners.forEach((state, fn) => {
                    if (!state.fired.has(i)) {
                        state.fired.add(i);
                        try { fn(w, i); } catch (e) { /* */ }
                    }
                });
                break;
            }
        }

        if (newActive) {
            this._activeIdx = this._words.indexOf(newActive);
        }

        return newActive;
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
        return this._words[this._activeIdx + 1] ?? null;
    }

    /**
     * Reset state (e.g. when audio restarts)
     */
    reset() {
        this._cursor    = 0;
        this._activeIdx = -1;
        this._lastTime  = -1;
        this._listeners.forEach(state => state.fired.clear());
    }

    // Binary search: find index of first word whose start >= time
    _binarySearch(time) {
        let lo = 0, hi = this._words.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this._words[mid].start < time) lo = mid + 1;
            else hi = mid;
        }
        return Math.max(0, lo - 1);
    }

    get wordCount() { return this._words.length; }
}
