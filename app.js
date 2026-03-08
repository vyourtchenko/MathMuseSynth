// Wait for standard DOM load (MathLive might take a moment to be available on window, but we used defer type=module)
document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const mathField = document.getElementById('formula');
    const errorMsg = document.getElementById('equation-error');
    
    const xMinInput = document.getElementById('x-min');
    const xMaxInput = document.getElementById('x-max');
    const durationInput = document.getElementById('duration');
    const volumeInput = document.getElementById('volume');
    
    const canvas = document.getElementById('waveform-canvas');
    const ctx = canvas.getContext('2d');
    const playhead = document.getElementById('playhead');
    
    const btnPlay = document.getElementById('btn-play');
    const iconPlay = btnPlay.querySelector('.icon-play');
    const iconPause = btnPlay.querySelector('.icon-pause');
    const btnText = btnPlay.querySelector('.btn-text');
    
    const btnLoop = document.getElementById('btn-loop');
    const btnDraw = document.getElementById('btn-draw');

    // Audio Context and Node Setup
    let audioCtx = null;
    let sourceNode = null;
    let gainNode = null;
    
    // Playback state
    let isPlaying = false;
    let isLooping = false;
    let animationFrameId = null;
    let startTime = 0;
    let activeDuration = 0;
    
    // Dynamic variables
    const variablesContainer = document.getElementById('variables-container');
    let customVariables = {}; // e.g. { a: 1, b: 2 }
    
    // Last successfully compiled math function
    let compiledMath = null;
    // Current rendered shape points
    let currentWaveformPoints = [];
    
    // Constants
    const SAMPLE_RATE = 44100;
    
    // --- Initial Setup ---
    function init() {
        resizeCanvas();
        window.addEventListener('resize', () => {
            resizeCanvas();
            drawWaveform();
        });
        
        // Wait custom event for when MathLive is full attached (or immediately if available)
        // Set up input listeners
        mathField.addEventListener('input', () => {
            parseAndDraw();
            if (isPlaying) updateAudioLive();
        });

        xMinInput.addEventListener('input', () => {
            parseAndDraw();
            if (isPlaying) updateAudioLive();
        });
        
        xMaxInput.addEventListener('input', () => {
            parseAndDraw();
            if (isPlaying) updateAudioLive();
        });

        durationInput.addEventListener('input', () => {
            if (isPlaying) updateAudioLive();
        });

        btnDraw.addEventListener('click', () => {
            parseAndDraw();
            if (isPlaying) updateAudioLive();
        });
        
        btnPlay.addEventListener('click', togglePlayback);
        btnLoop.addEventListener('click', toggleLoop);
        
        volumeInput.addEventListener('input', (e) => {
            if (gainNode) {
                // Exponential volume scaling sounds more natural
                gainNode.gain.value = Math.pow(parseFloat(e.target.value), 2);
            }
        });

        // Add a slight delay to ensure everything is parsed initially
        setTimeout(() => {
            parseAndDraw();
        }, 500);
    }

    // --- Parser & Logic ---
    function parseAndDraw() {
        if (!mathField || typeof mathField.getValue !== 'function') return;
        
        errorMsg.textContent = '';
        const asciiMath = mathField.getValue('ascii-math');
        
        try {
            // Replace implicit multiplication or weird tokens if necessary, though math.js handles them mostly
            // MathLive's ascii-math sometimes uses spaces or `*`. math.js `.compile` builds a callable node
            const node = math.parse(asciiMath);
            compiledMath = node.compile();
            
            // Extract custom variables from AST
            extractVariables(node);

            // Create evaluation scope combining 'x' and our custom slider values
            const scope = { x: 0, ...customVariables };
            
            // Validate it runs with a dummy variable
            compiledMath.evaluate(scope);
            
            // If success, calculate waveform and draw
            calculatePathPoints();
            drawWaveform();
        } catch (e) {
            console.error("Math Parsing Error: ", e);
            errorMsg.textContent = "Invalid mathematical expression.";
            compiledMath = null;
        }
    }

    function calculatePathPoints() {
        currentWaveformPoints = [];
        if (!compiledMath) return;

        const xMin = parseFloat(xMinInput.value);
        const xMax = parseFloat(xMaxInput.value);
        
        if (xMin >= xMax || isNaN(xMin) || isNaN(xMax)) {
            errorMsg.textContent = "Invalid domain: xMin must be less than xMax.";
            return;
        }

        // Calculate points for visual purposes (lower resolution than audio)
        // E.g., 2000 points across the canvas width
        const resolution = 2000;
        const widthRange = xMax - xMin;
        const step = widthRange / resolution;
        
        let minY = Infinity;
        let maxY = -Infinity;

        for (let i = 0; i <= resolution; i++) {
            const currentX = xMin + (i * step);
            try {
                const scope = { x: currentX, ...customVariables };
                const y = compiledMath.evaluate(scope);
                // Only consider finite numbers
                if (isFinite(y)) {
                    currentWaveformPoints.push({ x: currentX, y: y });
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                } else {
                     currentWaveformPoints.push({ x: currentX, y: 0 });
                }
            } catch(e) {
                 currentWaveformPoints.push({ x: currentX, y: 0 });
            }
        }
        
        // Find maximum absolute amplitude to normalize visually if needed
        let maxAmp = Math.max(Math.abs(minY), Math.abs(maxY));
        if (maxAmp === 0) maxAmp = 1;
        
        // Normalize points for drawing visually
        for(let pt of currentWaveformPoints) {
            pt.normalizedY = pt.y / maxAmp; // Ranges -1 to +1
        }
    }

    function resizeCanvas() {
        // High DPI canvas drawing
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    function drawWaveform() {
        const rect = canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        
        ctx.clearRect(0, 0, w, h);
        
        // Draw baseline
        ctx.beginPath();
        ctx.moveTo(0, h/2);
        ctx.lineTo(w, h/2);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();

        if (currentWaveformPoints.length === 0) return;

        const xMin = parseFloat(xMinInput.value);
        const xMax = parseFloat(xMaxInput.value);
        const domainSpan = xMax - xMin;

        ctx.beginPath();
        ctx.strokeStyle = '#38bdf8'; // var(--wave-color) equivalent
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';

        currentWaveformPoints.forEach((pt, index) => {
            // Map x to pixel width
            const pixelX = ((pt.x - xMin) / domainSpan) * w;
            // Map normalized y to pixel height, flipped so positive is UP
            const pixelY = (h / 2) - (pt.normalizedY * (h / 2) * 0.9); // 0.9 padding

            if (index === 0) {
                ctx.moveTo(pixelX, pixelY);
            } else {
                ctx.lineTo(pixelX, pixelY);
            }
        });
        
        ctx.stroke();
    }

    // --- Audio Synthesis ---
    async function generateAudioBuffer() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }

        const duration = parseFloat(durationInput.value);
        if (duration <= 0 || isNaN(duration)) {
            errorMsg.textContent = "Invalid duration.";
            return null;
        }

        const frameCount = Math.floor(audioCtx.sampleRate * duration);
        const buffer = audioCtx.createBuffer(1, frameCount, audioCtx.sampleRate);
        const channelData = buffer.getChannelData(0);

        const xMin = parseFloat(xMinInput.value);
        const xMax = parseFloat(xMaxInput.value);
        const domainSpan = xMax - xMin;

        // Generate audio directly from function
        let minY = Infinity, maxY = -Infinity;
        
        for (let i = 0; i < frameCount; i++) {
            // Calculate progress (0 to 1)
            const progress = i / frameCount;
            // Map to function domain x
            const currentX = xMin + (progress * domainSpan);
            
            let y = 0;
            try {
                const scope = { x: currentX, ...customVariables };
                y = compiledMath.evaluate(scope);
                if (!isFinite(y)) y = 0;
            } catch (e) {
                y = 0;
            }
            channelData[i] = y;

            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }

        // Normalize Audio to fit strictly between -1.0 and 1.0
        const maxAmp = Math.max(Math.abs(minY), Math.abs(maxY));
        if (maxAmp > 0) {
            for (let i = 0; i < frameCount; i++) {
                channelData[i] = channelData[i] / maxAmp;
            }
        }

        // Apply a tiny fade-in and fade-out envelope directly to the buffer to prevent looping pops
        // 5 milliseconds is usually enough to stop a pop without changing the sound character
        const fadeSamples = Math.min(Math.floor(audioCtx.sampleRate * 0.005), Math.floor(frameCount / 4));
        
        for (let i = 0; i < fadeSamples; i++) {
            const ratio = i / fadeSamples;
            // Fade-in front end
            channelData[i] *= ratio;
            // Fade-out back end
            channelData[frameCount - 1 - i] *= ratio;
        }

        return buffer;
    }

    // --- Dynamic Variables ---
    function extractVariables(node) {
        const foundSymbols = new Set();
        
        // Traverse AST to find symbols
        node.traverse(function (child, path, parent) {
            if (child.isSymbolNode) {
                const name = child.name;
                // Exclude 'x' (our independent variable), and known math functions/constants (like 'sin', 'pi', 'e')
                if (name !== 'x' && typeof math[name] === 'undefined') {
                    foundSymbols.add(name);
                }
            }
        });

        const newSymbols = Array.from(foundSymbols);
        let changed = false;

        // Remove old sliders that are no longer in the equation
        const currentKeys = Object.keys(customVariables);
        for (const key of currentKeys) {
            if (!newSymbols.includes(key)) {
                delete customVariables[key];
                changed = true;
            }
        }

        // Add new symbols with a default value of 1
        for (const symbol of newSymbols) {
            if (customVariables[symbol] === undefined) {
                customVariables[symbol] = 1;
                changed = true;
            }
        }

        if (changed) {
            renderVariableSliders();
        }
    }

    function renderVariableSliders() {
        if (Object.keys(customVariables).length === 0) {
            variablesContainer.style.display = 'none';
            variablesContainer.innerHTML = '';
            return;
        }

        variablesContainer.style.display = 'flex';
        variablesContainer.innerHTML = ''; // Clear existing

        for (const [symbol, value] of Object.entries(customVariables)) {
            const group = document.createElement('div');
            group.className = 'variable-control-group control-group';
            
            const header = document.createElement('div');
            header.className = 'variable-header';
            
            const label = document.createElement('label');
            label.textContent = symbol + " = ";
            
            const numInput = document.createElement('input');
            numInput.type = 'number';
            numInput.className = 'variable-number-input';
            numInput.step = '0.1';
            numInput.value = value;
            
            header.appendChild(label);
            header.appendChild(numInput);
            
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'variable-slider';
            slider.min = '-10';
            slider.max = '10';
            slider.step = '0.1';
            slider.value = value;

            // Sync interactions
            const updateVar = (newVal) => {
                const parsed = parseFloat(newVal);
                if (!isNaN(parsed)) {
                    customVariables[symbol] = parsed;
                    slider.value = parsed;
                    numInput.value = parsed;
                    parseAndDraw();
                    if (isPlaying) updateAudioLive();
                }
            };

            slider.addEventListener('input', (e) => updateVar(e.target.value));
            numInput.addEventListener('input', (e) => updateVar(e.target.value));

            group.appendChild(header);
            group.appendChild(slider);
            variablesContainer.appendChild(group);
        }
    }

    function toggleLoop() {
        isLooping = !isLooping;
        if (isLooping) {
            btnLoop.classList.add('active');
        } else {
            btnLoop.classList.remove('active');
        }
        if (sourceNode) {
            sourceNode.loop = isLooping;
        }
    }

    async function togglePlayback() {
        if (isPlaying) {
            stopAudio();
        } else {
            await playAudio();
        }
    }

    async function playAudio() {
        if (!compiledMath) {
            parseAndDraw();
            if(!compiledMath) return; // if still fails
        }

        // Initial audio context require user gesture
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        // Generate buffer
        btnPlay.classList.add('loading');
        btnText.textContent = "Loading...";
        
        // Optional slight delay here could prevent UI thread blocking for large buffers
        // but since duration shouldn't be too huge, we'll run it synchronously
        const buffer = await generateAudioBuffer();
        if (!buffer) {
            btnPlay.classList.remove('loading');
            btnText.textContent = "Play";
            return;
        }

        // Setup Nodes
        sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = buffer;
        sourceNode.loop = isLooping;

        if (!gainNode) {
            gainNode = audioCtx.createGain();
            gainNode.connect(audioCtx.destination);
        }
        
        gainNode.gain.value = Math.pow(parseFloat(volumeInput.value), 2);
        sourceNode.connect(gainNode);

        // Events
        sourceNode.onended = () => {
            if (!isLooping) stopAudio();
        };

        // Start
        startTime = audioCtx.currentTime;
        activeDuration = parseFloat(durationInput.value);
        if (isNaN(activeDuration) || activeDuration <= 0) activeDuration = 5;
        sourceNode.start();
        isPlaying = true;

        // UI Updates
        btnPlay.classList.remove('loading');
        iconPlay.style.display = 'none';
        iconPause.style.display = 'block';
        btnText.textContent = "Pause";
        
        playhead.style.display = 'block';
        updatePlayhead();
    }

    async function updateAudioLive() {
        if (!isPlaying || !audioCtx) return;

        let elapsed = audioCtx.currentTime - startTime;
        if (isLooping && activeDuration > 0) {
            elapsed = elapsed % activeDuration;
        }
        let fraction = activeDuration > 0 ? elapsed / activeDuration : 0;
        if (!isFinite(fraction) || fraction < 0) fraction = 0;
        if (!isLooping && fraction > 1.0) fraction = 1.0;

        const buffer = await generateAudioBuffer();
        if (!buffer) return;

        const newDuration = parseFloat(durationInput.value);
        if (isNaN(newDuration) || newDuration <= 0) return;

        const oldNode = sourceNode;
        
        sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = buffer;
        sourceNode.loop = isLooping;
        if (gainNode) sourceNode.connect(gainNode);
        
        const offset = fraction * newDuration;
        sourceNode.start(0, offset);
        
        startTime = audioCtx.currentTime - offset;
        activeDuration = newDuration;

        if (oldNode) {
            oldNode.onended = null; // Prevent it from stopping the new node
            try { oldNode.stop(0); } catch(e) {}
            oldNode.disconnect();
        }
        
        sourceNode.onended = () => {
            if (!isLooping) stopAudio();
        };
    }

    function stopAudio() {
        if (sourceNode) {
            try { sourceNode.stop(); } catch(e) {}
            sourceNode.disconnect();
            sourceNode = null;
        }
        isPlaying = false;
        
        // UI Updates
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
        btnText.textContent = "Play";
        
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        playhead.style.display = 'none';
        playhead.style.left = '0';
    }

    function updatePlayhead() {
        if (!isPlaying || !audioCtx || !sourceNode) return;

        const duration = activeDuration;
        let elapsed = audioCtx.currentTime - startTime;

        if (isLooping && duration > 0) {
            elapsed = elapsed % duration;
        }

        // Calculate fraction from 0.0 to 1.0
        let fraction = duration > 0 ? elapsed / duration : 0;
        
        if (fraction > 1.0) {
            fraction = 1.0; 
            // It will stop automatically due to onended if not looping
        } else {
            // Schedule next frame
            animationFrameId = requestAnimationFrame(updatePlayhead);
        }

        // Move playhead
        const rect = canvas.getBoundingClientRect();
        const pixelPosition = fraction * rect.width;
        playhead.style.transform = `translateX(${pixelPosition}px)`;
    }

    // Run
    init();
});
