// node --test — SonicLyrics (programador de palabras, línea de tiempo, instancia).
import test from 'node:test';
import assert from 'node:assert/strict';
import { WordScheduler } from '../src/word-scheduler.js';
import { SonicLyrics, LyricsTimeline } from '../src/soniclyrics.js';

// palabras pegadas, como las de Whisper/WhisperX
const W = [
    { word: 'y', start: 1.0, end: 1.2, line: 0 },
    { word: 'el', start: 1.2, end: 1.4, line: 0 },
    { word: 'sol', start: 1.4, end: 1.9, line: 0 },
    { word: 'me', start: 3.0, end: 3.2, line: 1 },
];

/** Recorre el tiempo a 60 fps y anota cuándo se dispara cada palabra. */
function play(s, from, to) {
    const fired = [];
    s.onWord((w) => fired.push([w.word, +t.toFixed(3)]));
    let t = from;
    for (; t <= to; t += 1 / 60) s.update(t);
    return fired;
}

test('con palabras pegadas cada una se dispara ANTES de empezar (lookahead), no tarde', () => {
    const s = new WordScheduler({ lookahead: 0.08 }).load(W);
    const fired = play(s, 0, 4);
    assert.deepEqual(fired.map(f => f[0]), ['y', 'el', 'sol', 'me']);
    for (const [word, t] of fired) {
        const start = W.find(w => w.word === word).start;
        assert.ok(t <= start - 0.08 + 1 / 60 && t >= start - 0.08, `${word} a ${t} (empieza ${start})`);
    }
});

test('palabras apiladas en el mismo instante se disparan todas, en orden', () => {
    const s = new WordScheduler().load([
        { word: 'I', start: 5, end: 5, line: 0 }, { word: 'got', start: 5, end: 5, line: 0 },
        { word: 'the', start: 5, end: 5, line: 0 }, { word: 'groove', start: 6, end: 6.4, line: 0 },
    ]);
    assert.deepEqual(play(s, 4, 7).map(f => f[0]), ['I', 'got', 'the', 'groove']);
});

test('un salto hacia adelante no dispara en ráfaga lo que quedó atrás', () => {
    const s = new WordScheduler().load(W);
    const fired = [];
    s.onWord((w) => fired.push(w.word));
    s.update(0.5);
    s.update(2.9);   // seek
    s.update(3.0);
    assert.deepEqual(fired, ['me']);
});

test('un salto hacia atrás vuelve a disparar las palabras desde ahí', () => {
    const s = new WordScheduler().load(W);
    const fired = [];
    s.onWord((w) => fired.push(w.word));
    for (let t = 0; t <= 3.5; t += 1 / 60) s.update(t);
    fired.length = 0;
    for (let t = 1.1; t <= 1.6; t += 1 / 60) s.update(t);
    assert.deepEqual(fired, ['el', 'sol']);
});

test('activeWord es la palabra que suena', () => {
    const s = new WordScheduler().load(W);
    s.update(1.5);
    assert.equal(s.activeWord.word, 'sol');
    s.update(2.5);
    assert.equal(s.activeWord, null);
});

test('LyricsTimeline: frase y palabra activas por tiempo', () => {
    const tl = new LyricsTimeline({ words: W });
    assert.equal(tl.getActiveLine(1.3).text, 'y el sol');
    assert.equal(tl.getActiveWord(1.3).word, 'el');
    assert.equal(tl.getActiveLine(2.6), null);
});

test('instancia: sin "lines" en el JSON arma las líneas desde las palabras', async () => {
    const sl = SonicLyrics.create({ src: { words: W } });
    await sl.ready;
    assert.equal(sl._lineTracker._lines.length, 2);
    assert.equal(sl._lineTracker._lines[0].text, 'y el sol');
    sl._lineTracker.update(3.1);
    assert.equal(sl.currentLine.text, 'me');
});

test('instancia: una carga fallida queda en `error`, sin rechazo sin capturar', async () => {
    const orig = console.error; console.error = () => {};
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    const sl = SonicLyrics.create({ src: '/no-existe.json' });
    await sl.ready;
    console.error = orig;
    assert.match(String(sl.error), /404/);
});
