/**
 * DOMRenderer — Optional automatic lyric display in the DOM.
 *
 * Renders the current word and line to DOM elements,
 * with built-in karaoke-style highlighting.
 */
export class DOMRenderer {
    /**
     * @param {object} config
     * @param {string|HTMLElement} [config.lineEl]   - Selector or element for current line
     * @param {string|HTMLElement} [config.wordEl]   - Selector or element for current word
     * @param {string}             [config.wordClass='sl-word-active'] - CSS class for active word
     * @param {string}             [config.lineClass='sl-line-active'] - CSS class for active line
     * @param {boolean}            [config.karaoke=false] - Enable karaoke word-by-word highlight
     */
    constructor(config = {}) {
        this._lineEl    = this._resolve(config.lineEl);
        this._wordEl    = this._resolve(config.wordEl);
        this._wordClass = config.wordClass ?? 'sl-word-active';
        this._lineClass = config.lineClass ?? 'sl-line-active';
        this._karaoke   = config.karaoke   ?? false;

        this._prevLineId = null;
        this._prevWordIdx = -1;
    }

    /**
     * Render the current word
     * @param {object|null} word
     * @param {number} wordIdx
     */
    renderWord(word, wordIdx) {
        if (!word || wordIdx === this._prevWordIdx) return;
        this._prevWordIdx = wordIdx;

        if (this._wordEl) {
            this._wordEl.textContent = word.word;
            this._wordEl.classList.add(this._wordClass);
            // Remove class after word ends (approximate)
            clearTimeout(this._wordTimer);
            const duration = Math.max(100, (word.end - word.start) * 1000);
            this._wordTimer = setTimeout(() => {
                this._wordEl?.classList.remove(this._wordClass);
            }, duration);
        }
    }

    /**
     * Render the current line
     * @param {object|null} line
     */
    renderLine(line) {
        const lineId = line?.id ?? null;
        if (lineId === this._prevLineId) return;
        this._prevLineId = lineId;

        if (this._lineEl) {
            if (line) {
                this._lineEl.textContent = line.text;
                this._lineEl.classList.add(this._lineClass);
            } else {
                this._lineEl.classList.remove(this._lineClass);
            }
        }
    }

    _resolve(selector) {
        if (!selector) return null;
        if (typeof selector === 'string') return document.querySelector(selector);
        return selector;
    }

    destroy() {
        clearTimeout(this._wordTimer);
    }
}
