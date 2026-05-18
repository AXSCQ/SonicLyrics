/**
 * LineTracker — Tracks active lyric lines based on audio currentTime.
 */
export class LineTracker {
    constructor() {
        /** @type {Array<{id, text, start, end}>} */
        this._lines = [];
        this._activeIdx = -1;
        this._listeners = [];
    }

    load(lines) {
        this._lines = [...lines].sort((a, b) => a.start - b.start);
        this._activeIdx = -1;
        return this;
    }

    onLine(fn) {
        this._listeners.push(fn);
        return () => {
            this._listeners = this._listeners.filter(l => l !== fn);
        };
    }

    /**
     * @param {number} currentTime
     * @returns {object|null} Active line or null
     */
    update(currentTime) {
        let newIdx = -1;

        for (let i = 0; i < this._lines.length; i++) {
            const line = this._lines[i];
            if (currentTime >= line.start && currentTime <= line.end) {
                newIdx = i;
                break;
            }
        }

        if (newIdx !== this._activeIdx) {
            this._activeIdx = newIdx;
            const line = newIdx >= 0 ? this._lines[newIdx] : null;
            this._listeners.forEach(fn => {
                try { fn(line, newIdx); } catch (e) { /* */ }
            });
        }

        return newIdx >= 0 ? this._lines[newIdx] : null;
    }

    /**
     * Progress (0–1) within the current line
     * @param {number} currentTime
     */
    lineProgress(currentTime) {
        const line = this.activeLine;
        if (!line) return 0;
        return Math.min(1, Math.max(0,
            (currentTime - line.start) / (line.end - line.start)
        ));
    }

    get activeLine() {
        return this._activeIdx >= 0 ? this._lines[this._activeIdx] : null;
    }

    get nextLine() {
        return this._lines[this._activeIdx + 1] ?? null;
    }

    reset() {
        this._activeIdx = -1;
    }
}
