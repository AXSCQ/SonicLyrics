# SonicLyrics

Letra sincronizada palabra por palabra para experiencias audio-reactivas. Se integra con [SonicMotion](https://github.com/AXSCQ/SonicMotion).

```js
import SonicLyrics, { LyricsTimeline } from 'soniclyrics';

// Por eventos: dispara cada palabra (con 80 ms de anticipación) y cada línea
const lyrics = SonicLyrics.create({ src: '/audio/vocals.json', sonic });
await lyrics.ready;                    // lyrics.error si no se pudo cargar
lyrics.onWord((w) => console.log(w.word));
lyrics.onLine((line) => show(line?.text));

// Por consulta (bucles de render, seek seguro)
const tl = SonicLyrics.timeline(data);
tl.getActiveLine(t); tl.getActiveWord(t);
```

Formato: `{ words: [{ word, start, end, line, confidence?, tags? }], lines?, phrases? }` (el que genera Whisper/WhisperX). Si no trae `lines`, se arman desde las palabras.

## Cambios v1.2.0

- **`WordScheduler`**: con palabras pegadas (el fin de una es el inicio de la siguiente, como en toda letra cantada) cada palabra se dispara `lookahead` antes de empezar; antes esperaba que terminara la anterior y llegaba ~50 ms TARDE. Las palabras apiladas en el mismo instante (artefacto de Whisper) se disparan todas. Un salto adelante no dispara en ráfaga lo que quedó atrás.
- **`onLine`** funciona con el formato de Whisper (sin `lines`): arma las líneas desde las palabras.
- **`ready` / `error`**: una carga fallida desde el constructor ya no deja una promesa rechazada sin capturar.
- `whisper-node` (solo lo usa la CLI) pasa a dependencia opcional.
- Pruebas: `npm test` (node:test).
