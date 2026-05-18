#!/usr/bin/env node
/**
 * SonicLyrics CLI — Generate word-timestamped lyrics.json from audio files.
 *
 * Uses whisper-node (which wraps openai-whisper) to transcribe and align.
 *
 * Usage:
 *   soniclyrics generate --audio vocals.mp3 --output lyrics.json
 *   soniclyrics generate --audio vocals.mp3 --model small --lang es
 *   soniclyrics tag --input lyrics.json --output lyrics.tagged.json
 */

import { existsSync, writeFileSync, readFileSync } from 'fs';
import { resolve, basename } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const cmd  = args[0];

function parseArgs(argList) {
    const out = {};
    for (let i = 0; i < argList.length; i++) {
        if (argList[i].startsWith('--')) {
            const key = argList[i].slice(2);
            out[key] = argList[i + 1] ?? true;
            i++;
        }
    }
    return out;
}

// ─── Command: generate ─────────────────────────────────────────────────────

async function cmdGenerate(opts) {
    const audioPath  = opts.audio  ?? opts.a;
    const outputPath = opts.output ?? opts.o ?? 'lyrics.json';
    const model      = opts.model  ?? 'small';
    const lang       = opts.lang   ?? opts.language ?? 'en';

    if (!audioPath) {
        console.error('[SonicLyrics] --audio <file> is required');
        process.exit(1);
    }
    if (!existsSync(audioPath)) {
        console.error(`[SonicLyrics] File not found: ${audioPath}`);
        process.exit(1);
    }

    console.log(`[SonicLyrics] Transcribing: ${audioPath}`);
    console.log(`[SonicLyrics] Model: ${model} | Language: ${lang}`);
    console.log('[SonicLyrics] This may take 30–120 seconds on first run (model download)...\n');

    let whisperOutput;

    // Try whisper-node first
    try {
        const { whisper } = require('whisper-node');
        whisperOutput = await whisper(audioPath, {
            modelName:      model,
            whisperOptions: {
                word_timestamps: true,
                language: lang,
            }
        });
    } catch (e) {
        // Fallback: try Python whisper via child_process
        try {
            const { execSync } = require('child_process');
            const tmpOut = outputPath.replace('.json', '.whisper.json');
            execSync(
                `whisper "${audioPath}" --model ${model} --language ${lang}` +
                ` --word_timestamps True --output_format json --output_dir /tmp`,
                { stdio: 'inherit' }
            );
            const raw = JSON.parse(readFileSync(
                `/tmp/${basename(audioPath, '.mp3')}.json`, 'utf8'
            ));
            whisperOutput = convertPythonWhisperOutput(raw);
        } catch (e2) {
            console.error('[SonicLyrics] Neither whisper-node nor Python whisper found.');
            console.error('Install one of:');
            console.error('  npm install -g whisper-node');
            console.error('  pip install openai-whisper');
            process.exit(1);
        }
    }

    const lyrics = buildLyricsJSON(whisperOutput, {
        audioFile: basename(audioPath),
        model,
        lang,
    });

    writeFileSync(outputPath, JSON.stringify(lyrics, null, 2));
    console.log(`\n[SonicLyrics] ✅ Saved: ${resolve(outputPath)}`);
    console.log(`[SonicLyrics] Words: ${lyrics.words.length} | Lines: ${lyrics.lines.length}`);
    console.log('\n[SonicLyrics] Next steps:');
    console.log(`  1. Review ${outputPath} and add "tags" to key words`);
    console.log(`  2. Use in your component:\n`);
    console.log(`     import SonicLyrics from 'soniclyrics';`);
    console.log(`     const lyrics = SonicLyrics.create({ src: '${outputPath}', sonic });`);
    console.log(`     lyrics.onTag('chorus', (word) => triggerEffect());`);
}

// ─── Command: tag ──────────────────────────────────────────────────────────

async function cmdTag(opts) {
    const inputPath  = opts.input  ?? opts.i;
    const outputPath = opts.output ?? opts.o;

    if (!inputPath) {
        console.error('[SonicLyrics] --input <lyrics.json> is required');
        process.exit(1);
    }

    const data = JSON.parse(readFileSync(inputPath, 'utf8'));

    console.log('\n[SonicLyrics] Interactive tagger');
    console.log('─────────────────────────────────');
    console.log('Words in lyrics:');
    data.words.forEach((w, i) => {
        const tags = w.tags?.length ? ` [${w.tags.join(', ')}]` : '';
        console.log(`  ${String(i).padStart(3)}: ${w.start.toFixed(2)}s "${w.word}"${tags}`);
    });
    console.log('\nEdit the JSON file directly to add "tags" arrays to words.');
    console.log('Example: { "word": "Ben", "start": 18.2, "end": 18.8, "tags": ["key", "chorus"] }');

    if (outputPath) {
        writeFileSync(outputPath, JSON.stringify(data, null, 2));
        console.log(`\nCopied to: ${outputPath}`);
    }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildLyricsJSON(whisperResult, meta = {}) {
    const words  = [];
    const lines  = [];
    let lineId   = 0;

    // whisper-node returns array of segments with words
    const segments = Array.isArray(whisperResult)
        ? whisperResult
        : (whisperResult.segments ?? []);

    for (const segment of segments) {
        const segWords = segment.words ?? [];
        const lineWords = [];

        for (const w of segWords) {
            // whisper-node format: { word, start, end, probability }
            // python whisper format: { word, start, end, probability }
            const wordObj = {
                word:       (w.word ?? w.text ?? '').trim().replace(/^[,.\s]+|[,.\s]+$/g, ''),
                start:      parseFloat((w.start ?? w.startTime ?? 0).toFixed(3)),
                end:        parseFloat((w.end   ?? w.endTime   ?? 0).toFixed(3)),
                confidence: parseFloat((w.probability ?? w.confidence ?? 1).toFixed(3)),
                line:       lineId,
                tags:       [],
            };

            if (wordObj.word) {
                words.push(wordObj);
                lineWords.push(wordObj.word);
            }
        }

        if (lineWords.length > 0) {
            const lineStart = segWords[0]?.start ?? segment.start;
            const lineEnd   = segWords[segWords.length - 1]?.end ?? segment.end;
            lines.push({
                id:    lineId,
                text:  lineWords.join(' '),
                start: parseFloat(lineStart.toFixed(3)),
                end:   parseFloat(lineEnd.toFixed(3)),
            });
            lineId++;
        }
    }

    return {
        title:    meta.audioFile ?? '',
        language: meta.lang      ?? 'en',
        model:    meta.model     ?? 'small',
        generatedAt: new Date().toISOString(),
        words,
        lines,
        phrases: [],
    };
}

function convertPythonWhisperOutput(raw) {
    // Python whisper JSON has segments[].words[]
    return raw.segments ?? [];
}

// ─── Main dispatch ──────────────────────────────────────────────────────────

const opts = parseArgs(args.slice(1));

switch (cmd) {
    case 'generate':
        await cmdGenerate(opts);
        break;
    case 'tag':
        await cmdTag(opts);
        break;
    default:
        console.log(`
SonicLyrics CLI v1.0.0

Commands:
  generate  Transcribe audio and generate word-timestamped lyrics.json
  tag       Inspect lyrics.json and guide tagging of key words

Options (generate):
  --audio   <file>     Audio file to transcribe (vocals stem recommended)
  --output  <file>     Output JSON path (default: lyrics.json)
  --model   <name>     Whisper model: tiny, base, small, medium (default: small)
  --lang    <code>     Language code: en, es, fr, etc. (default: en)

Examples:
  soniclyrics generate --audio Ben/vocals.mp3 --output Ben/lyrics.json
  soniclyrics generate --audio BillieJean/vocals.mp3 --model medium --lang en
  soniclyrics tag --input Ben/lyrics.json
`);
}
