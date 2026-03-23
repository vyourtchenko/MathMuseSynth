# MathMuse | Hear the Shape of Math

MathMuse is an interactive web application that translates mathematical functions directly into a sound form in real-time. It provides a visual and auditory playground to explore how equations sound and look by offering a math input interface, an interactive waveform graph, and real-time audio synthesis.

## Inspiration

MathMuse was directly inspired by Desmos. While Desmos allows users to explore the visual landscape of equations and play the sound of functions by mapping their outputs to audible frequencies, its sonification approach is constrained. MathMuse was built to take this a step further: instead of representing changing values as varying pitches, MathMuse lets you literally listen to the *fundamental sound form* (waveform amplitude) of any function you choose. 

## Features

- **Mathematical Input:** Powered by MathLive and Math.js, users can input complex equations using standard mathematical notation (e.g., `\sin(100 \cdot x) + \cos(200 \cdot x)`).
- **Real-Time Audio Synthesis:** The web application seamlessly maps the numerical output of your function across a chosen mathematical domain directly into an audio buffer using the Web Audio API. 
- **Dynamic Variables:** MathMuse intelligently parses your equation to find any custom variables (like `a` or `b`). It automatically brings up interactive sliders. Variables now support:
  - Custom Min, Max, and Step boundaries.
  - Dedicated variable animation playback loops with config modes (Oscillate, Loop, Play Once, Continuous) and adjustable dynamic multiplier speeds.
- **Piano Mode Synthesizer:** Transform any mathematical function into a fully playable instrument. By mapping your QWERTY keyboard (A-L for white keys, W-P for black keys), Piano Mode spawns polyphonic musical pitches bounded by automated ADSR volume envelopes for smooth playability.
- **Interactive Waveform Graph:** 
  - **Pan & Zoom:** Click and drag to pan across the graph. Scroll with your mouse wheel or trackpad to zoom in and out of the X-axis. 
  - **Y-Axis Controls:** Dedicated zoom in (+) and zoom out (-) buttons for the Y-axis.
  - **Sync to View:** A single click instantly locks your function's audio domain boundary securely to your active visual window framing!
  - **Reset View:** Quickly return to the default viewing perspective securely where boundaries are clearly visible.
- **Advanced Playback Controls:**
  - Standard Play, Pause, and Loop toggles.
  - Adjustable duration (in seconds) to define how long it takes to traverse the chosen domain.
  - Smooth audio fade-ins and fade-outs to prevent popping sounds.
  - Visual playhead that tracks exactly where you are in the mathematical domain as the audio plays.
- **Modern UI/Glassmorphism Design:** A beautiful split-layout built with vanilla CSS featuring a futuristic dark mode, animated background blooms, and a custom favicon.

## Technologies Used

- HTML5, CSS3, Vanilla JavaScript
- [MathLive](https://cortexjs.io/mathlive/) for the rich equation editor.
- [Math.js](https://mathjs.org/) for mathematical expression parsing and evaluation.
- HTML5 Canvas for performant graph rendering.
- Web Audio API for continuous audio sonification.
- [Phosphor Icons](https://phosphoricons.com/) for UI iconography. 

## How To Run

Simply open `index.html` in your web browser to run the application. No build step or local server is required.
