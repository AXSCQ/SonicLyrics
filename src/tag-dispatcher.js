/**
 * TagDispatcher — Routes word events to tag-specific callbacks.
 *
 * Words in the lyrics JSON can have a `tags` array:
 *   { word: "Ben", start: 18.2, end: 18.8, tags: ["key", "chorus-start"] }
 *
 * You can subscribe to any tag and receive a callback when that word fires.
 */
export class TagDispatcher {
    constructor() {
        /** @type {Map<string, Function[]>} */
        this._tagListeners = new Map();

        /** @type {Function[]} */
        this._anyTagListeners = [];
    }

    /**
     * Subscribe to a specific tag
     * @param {string} tag
     * @param {Function} fn - Called with (wordObj, tag)
     * @returns {Function} unsubscribe
     */
    on(tag, fn) {
        if (!this._tagListeners.has(tag)) {
            this._tagListeners.set(tag, []);
        }
        this._tagListeners.get(tag).push(fn);
        return () => {
            const arr = this._tagListeners.get(tag);
            if (arr) {
                const idx = arr.indexOf(fn);
                if (idx !== -1) arr.splice(idx, 1);
            }
        };
    }

    /**
     * Subscribe to ALL tagged words (any tag)
     * @param {Function} fn - Called with (wordObj, tag[])
     * @returns {Function} unsubscribe
     */
    onAny(fn) {
        this._anyTagListeners.push(fn);
        return () => {
            this._anyTagListeners = this._anyTagListeners.filter(l => l !== fn);
        };
    }

    /**
     * Dispatch a word that just fired — routes to tag listeners
     * @param {object} wordObj
     */
    dispatch(wordObj) {
        const tags = wordObj.tags;
        if (!tags || !tags.length) return;

        // Fire any-tag listeners
        if (this._anyTagListeners.length) {
            this._anyTagListeners.forEach(fn => {
                try { fn(wordObj, tags); } catch (e) { /* */ }
            });
        }

        // Fire specific tag listeners
        tags.forEach(tag => {
            const listeners = this._tagListeners.get(tag);
            if (listeners) {
                listeners.forEach(fn => {
                    try { fn(wordObj, tag); } catch (e) { /* */ }
                });
            }
        });
    }

    /**
     * Clear all listeners
     */
    clear() {
        this._tagListeners.clear();
        this._anyTagListeners = [];
    }
}
