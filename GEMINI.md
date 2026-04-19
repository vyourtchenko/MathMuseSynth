# MathMuseSynth | AI Developer Context Guide

This document is intended for LLM agents working on **MathMuseSynth** later on. It summarizes the project's architecture, recent feature history, and critical technical caveats necessary to avoid structural bugs.

## Project Summary
MathMuseSynth is a vanilla web application (HTML/CSS/JS) that sonifies mathematical functions using the Web Audio API. Unlike Desmos, which plays pitch based on Y-values, MathMuseSynth buffers the entire X->Y function evaluation as a direct audio waveform.

### Core Architecture
- **Math Inputs:** Rendered via [MathLive](https://cortexjs.io/mathlive/) (`ASCII-math`). Evaluated efficiently using [math.js](https://mathjs.org/) (`AST traversal + evaluate()`).
- **Visual Graph:** HTML5 Canvas mapping the mathematical domain (`xMin`, `xMax`) bounding box into rendered line segments using `requestAnimationFrame`.
- **Audio Engine:** `window.AudioContext`. The core audio loop translates the evaluated function array (capped strictly to normalized floats between -1.0 and 1.0) into a `BufferSourceNode`.
- **Dynamic Variables:** Any symbol in the math function distinct from `x` or standard constants (e.g., `a`, `b`) automatically spawns an interactive slider variable block under the `customVariables` object map. They possess complex states (`value`, `min`, `max`, `step`, `speed`, `mode`, `isAnimating`).

## Critical Implementation Context (What we've learned)

1. **Main-Thread Audio Blocking**
   Generating a 5-second buffer at `44.1kHz` requires executing the `math.js` AST `evaluate()` function ~220,500 times. This is fully synchronous and blocks the main UI thread. 
   - **Rule:** Do *not* continuously invoke `updateAudioLive()` or `generateAudioBuffer()` inside 60FPS loops (like window dragging or variable animations). We must always explicitly throttle it (currently batched to check roughly every ~100ms via `lastAudioUpdate`).

2. **Web Audio Hardware Popping**
   Sudden starts, stops, or loops with AudioBuffers often cause "popping" hardware clicks out of the speakers due to non-zero audio crossings.
   - **Rule:** The primary loop in `generateAudioBuffer()` contains intrinsic 40ms Hann-style cosine fades at the front and back of the raw ArrayBuffer data.
   - If generating arbitrary notes (like in Piano Mode), always attach a dedicated `GainNode` to your `BufferSourceNode` and `linearRampToValueAtTime()` for the Attack (~50ms) and Release (~100ms).

3. **Piano Mode State Handling**
   Piano Mode maps QWERTY keyboard events sequentially to pitch shifted notes. 
   - Polyphony works by maintaining an `activeNotes` tracking object. 
   - Changing Math Equation variables inherently regenerates `pianoBuffer` in the background. Because `AudioBufferSourceNode` buffer properties cannot natively switch once injected, new math shapes only organically take effect on the **next** physical key press. This is a standard synthesizer wavetable behavior.

4. **Variable Scoping**
   To resolve `compiledMath.evaluate(scope)`, always use the `getVariableScope()` mapping function as `...customVariables` is structurally deep (`{ value, min, speed }`) and will crash the parser without extraction.

5. **Aesthetics & DOM**
   Rely on CSS `var(--color)` themes. Icons are implemented synchronously via `<script src="https://unpkg.com/@phosphor-icons/web"></script>`. The project deliberately avoids build-pipelines, React, or frameworks. Keep edits tied purely to native browser APIs.
