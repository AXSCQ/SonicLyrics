/**
 * LyricsTimeline — seek-safe, query-by-time view of a lyrics.json.
 *
 * SonicLyricsInstance is event-driven (onWord/onLine fire while playing).
 * LyricsTimeline is the stateless counterpart for render loops: ask
 * "which phrase / word is sounding at second t?" as often as you like,
 * jump anywhere in the song, and the answer is always consistent.
 *
 * It also repairs two common Whisper artifacts:
 *  - words with end === start (zero duration) never match a time query,
 *    so every word gets a minimum active window;
 *  - several consecutive words collapsed onto the same timestamp shadow
 *    each other, so each run is spread over the gap to the next word.
 * And it splits over-long "lines" (Whisper sometimes returns a whole song
 * as one line) into readable phrases: on vocal pauses, on punctuation, or
 * at most MAX_PHRASE_WORDS words.
 *
 * Extracted from the LaPazPixelArt example.
 */

const MIN_WORD_WINDOW = 0.15;   // s: minimum window of a zero-duration word
const MAX_WORD_SLOT = 0.30;     // s: max slot per word when spreading a collapsed run
const PHRASE_GAP = 0.7;         // s: a vocal pause longer than this starts a new phrase
const SOFT_PHRASE_WORDS = 7;    // after punctuation, cut once the phrase has this many words
const MAX_PHRASE_WORDS = 11;    // hard cut
const LINE_TAIL = 0.3;          // s: a phrase stays visible a bit after its last word

/**
 * @typedef {object} LyricWord
 * @property {string} word
 * @property {number} start
 * @property {number} end
 * @property {number} line
 * @property {number} [confidence]
 * @property {string[]} [tags]
 */

/**
 * @typedef {object} LyricLine
 * @property {number} lineIndex
 * @property {string} text
 * @property {number} start
 * @property {number} end
 * @property {LyricWord[]} words
 */

/** Repair Whisper timing inside one line (words sorted by start). */
export function repairTiming(rawWords) {
    const words = [];
    for (let i = 0; i < rawWords.length; ) {
        let j = i;
        while (j + 1 < rawWords.length && rawWords[j + 1].start === rawWords[i].start) j++;
        const runLen = j - i + 1;

        if (runLen === 1) {
            const w = rawWords[i];
            const nextStart = rawWords[i + 1]?.start ?? Infinity;
            const end = Math.max(w.end, Math.min(w.start + MIN_WORD_WINDOW, nextStart));
            words.push(end === w.end ? w : { ...w, end });
        } else {
            const runStart = rawWords[i].start;
            const nextStart = rawWords[j + 1]?.start ?? runStart + runLen * MAX_WORD_SLOT;
            const slot = Math.min(nextStart - runStart, runLen * MAX_WORD_SLOT) / runLen;
            for (let k = 0; k < runLen; k++) {
                words.push({ ...rawWords[i + k], start: runStart + k * slot, end: runStart + (k + 1) * slot });
            }
        }
        i = j + 1;
    }
    return words;
}

/** Split a line's words into readable phrases. */
function splitPhrases(words) {
    const phrases = [];
    let cur = [];
    for (const w of words) {
        const prev = cur[cur.length - 1];
        const pause = prev ? w.start - prev.end > PHRASE_GAP : false;
        const punct = prev ? /[,.;:!?]$/.test(prev.word.trim()) : false;
        if (prev && (pause || cur.length >= MAX_PHRASE_WORDS || (punct && cur.length >= SOFT_PHRASE_WORDS))) {
            phrases.push(cur);
            cur = [];
        }
        cur.push(w);
    }
    if (cur.length) phrases.push(cur);
    return phrases;
}

export class LyricsTimeline {
    /**
     * @param {{ words: LyricWord[] }} data - lyrics.json (as produced by the soniclyrics CLI)
     */
    constructor(data) {
        this.data = data;
        /** @type {LyricLine[]} */
        this.lines = [];
        this._build();
    }

    _build() {
        if (!this.data || !Array.isArray(this.data.words)) return;
        const byLine = new Map();
        for (const w of this.data.words) {
            if (!byLine.has(w.line)) byLine.set(w.line, []);
            byLine.get(w.line).push(w);
        }
        this.lines = [...byLine.entries()]
            .sort((a, b) => a[0] - b[0])
            .flatMap(([, raw]) => {
                raw.sort((a, b) => a.start - b.start);
                return splitPhrases(repairTiming(raw)).map(phrase => ({
                    text: phrase.map(w => w.word).join(' ').replace(/\s+/g, ' ').trim(),
                    start: phrase[0]?.start || 0,
                    end: (phrase[phrase.length - 1]?.end || 0) + LINE_TAIL,
                    words: phrase,
                }));
            })
            .map((line, lineIndex) => ({ lineIndex, ...line }));
    }

    /**
     * The phrase sounding at second t: the last one that already started
     * (a phrase's trailing tail never hides the start of the next one).
     * @param {number} t
     * @returns {LyricLine|null}
     */
    getActiveLine(t) {
        for (let i = this.lines.length - 1; i >= 0; i--) {
            const line = this.lines[i];
            if (t >= line.start) return t <= line.end ? line : null;
        }
        return null;
    }

    /**
     * The word sounding at second t.
     * @param {number} t
     * @returns {LyricWord|null}
     */
    getActiveWord(t) {
        const line = this.getActiveLine(t);
        if (!line) return null;
        return line.words.find(w => t >= w.start && t <= w.end) || null;
    }

    /** @returns {LyricLine[]} */
    getAllLines() {
        return this.lines;
    }
}
