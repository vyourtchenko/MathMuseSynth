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
    const btnResetView = document.getElementById('btn-reset-view');
    const btnZoomYIn = document.getElementById('btn-zoom-y-in');
    const btnZoomYOut = document.getElementById('btn-zoom-y-out');
    const btnSyncDomain = document.getElementById('btn-sync-domain');

    // Audio Context and Node Setup
    let audioCtx = null;
    let sourceNode = null;
    let fadeNode = null;
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
    
    // Piano Mode State
    const btnPianoMode = document.getElementById('btn-piano-mode');
    const pianoInstructions = document.getElementById('piano-instructions');
    let isPianoMode = false;
    let pianoBuffer = null;
    let activeNotes = {};
    const KEY_TO_SEMITONE = {
        'KeyA': 0, 'KeyW': 1, 'KeyS': 2, 'KeyE': 3, 'KeyD': 4, 'KeyF': 5, 'KeyT': 6, 'KeyG': 7, 'KeyY': 8, 'KeyH': 9, 'KeyU': 10, 'KeyJ': 11, 'KeyK': 12, 'KeyO': 13, 'KeyL': 14, 'KeyP': 15, 'Semicolon': 16, 'Quote': 17
    };
    
    // Last successfully compiled math function
    let compiledMath = null;
    // Current rendered shape points
    let currentWaveformPoints = [];
    
    // Interactive Graph State
    let viewState = {
        xMin: -10,
        xMax: 10,
        yMin: -1.5,
        yMax: 1.5,
        isDragging: false,
        dragStartX: 0,
        lastMouseX: 0,
        lastMouseY: 0,
        dragMode: 'pan' // 'pan', 'drag-min', 'drag-max'
    };
    let isRedrawQueued = false;
    
    // Constants
    const SAMPLE_RATE = 44100;
    
    // --- Initial Setup ---
    function init() {
        resetViewState();
        setupCanvasInteractions();
        
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
            if (!viewState.isDragging) resetViewState();
            parseAndDraw();
            if (isPlaying) updateAudioLive();
        });
        
        xMaxInput.addEventListener('input', () => {
            if (!viewState.isDragging) resetViewState();
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

        btnResetView.addEventListener('click', () => {
            resetViewState();
            requestRedraw();
        });
        
        btnZoomYIn.addEventListener('click', () => {
            const spanY = viewState.yMax - viewState.yMin;
            const center = (viewState.yMax + viewState.yMin) / 2;
            const newSpanY = spanY * 0.8;
            viewState.yMin = center - newSpanY / 2;
            viewState.yMax = center + newSpanY / 2;
            requestRedraw();
        });

        btnZoomYOut.addEventListener('click', () => {
            const spanY = viewState.yMax - viewState.yMin;
            const center = (viewState.yMax + viewState.yMin) / 2;
            const newSpanY = spanY * 1.25;
            viewState.yMin = center - newSpanY / 2;
            viewState.yMax = center + newSpanY / 2;
            requestRedraw();
        });
        
        btnPlay.addEventListener('click', togglePlayback);
        btnLoop.addEventListener('click', toggleLoop);
        
        volumeInput.addEventListener('input', (e) => {
            if (gainNode) {
                // Exponential volume scaling sounds more natural
                const vol = Math.pow(parseFloat(e.target.value), 2);
                // Slowly approach the target value over 50ms to prevent popping
                gainNode.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.05);
            }
        });

        if (btnSyncDomain) {
            btnSyncDomain.addEventListener('click', () => {
                xMinInput.value = viewState.xMin.toFixed(2);
                xMaxInput.value = viewState.xMax.toFixed(2);
                parseAndDraw();
                if (isPlaying) updateAudioLive();
                else if (isPianoMode) generateAudioBuffer().then(b => pianoBuffer = b);
            });
        }

        if (btnPianoMode) {
            btnPianoMode.addEventListener('click', togglePianoMode);
        }
        
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        setupPianoPointerInput();

        const btnDownloadWav = document.getElementById('btn-download-wav');
        if (btnDownloadWav) {
            btnDownloadWav.addEventListener('click', downloadWav);
        }

        // Add a slight delay to ensure everything is parsed initially
        setTimeout(() => {
            parseAndDraw();
        }, 500);
    }

    function resetViewState() {
        const min = parseFloat(xMinInput.value) || 0;
        const max = parseFloat(xMaxInput.value) || 10;
        const span = max - min;
        viewState.xMin = min - span * 0.1;
        viewState.xMax = max + span * 0.1;
        viewState.yMin = -1.5;
        viewState.yMax = 1.5;
    }

    function getVariableScope() {
        const scope = {};
        for (const [key, config] of Object.entries(customVariables)) {
            scope[key] = config.value;
        }
        return scope;
    }

    // --- Parser & Logic ---
    function parseAndDraw() {
        if (!mathField || typeof mathField.getValue !== 'function') return;
        
        errorMsg.textContent = '';
        const asciiMath = mathField.getValue('ascii-math');
        
        try {
            const node = math.parse(asciiMath);
            compiledMath = node.compile();
            
            extractVariables(node);

            const scope = { x: 0, ...getVariableScope() };
            
            compiledMath.evaluate(scope);
            
            calculatePathPoints();
            drawWaveform();
            
            if (isPianoMode && !isPlaying) {
                 generateAudioBuffer().then(b => pianoBuffer = b);
            }
        } catch (e) {
            console.error("Math Parsing Error: ", e);
            errorMsg.textContent = "Invalid mathematical expression.";
            compiledMath = null;
        }
    }

    function calculatePathPoints() {
        currentWaveformPoints = [];
        if (!compiledMath) return;

        const xMin = viewState.xMin;
        const xMax = viewState.xMax;
        
        if (xMin >= xMax || isNaN(xMin) || isNaN(xMax)) {
            return;
        }

        const resolution = 2000;
        const widthRange = xMax - xMin;
        const step = widthRange / resolution;
        
        const runtimeScope = getVariableScope();
        for (let i = 0; i <= resolution; i++) {
            const currentX = xMin + (i * step);
            try {
                runtimeScope.x = currentX;
                const y = compiledMath.evaluate(runtimeScope);
                if (isFinite(y)) {
                    currentWaveformPoints.push({ x: currentX, y: y });
                } else {
                     currentWaveformPoints.push({ x: currentX, y: 0 });
                }
            } catch(e) {
                 currentWaveformPoints.push({ x: currentX, y: 0 });
            }
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
        
        // Draw baseline (Y=0)
        const yZeroPixel = h - ((0 - viewState.yMin) / (viewState.yMax - viewState.yMin)) * h;
        ctx.beginPath();
        ctx.moveTo(0, yZeroPixel);
        ctx.lineTo(w, yZeroPixel);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();

        if (currentWaveformPoints.length === 0) return;

        const activeXMin = parseFloat(xMinInput.value);
        const activeXMax = parseFloat(xMaxInput.value);
        const viewSpanX = viewState.xMax - viewState.xMin;
        const viewSpanY = viewState.yMax - viewState.yMin;

        // Draw active domains
        const startXPixel = ((activeXMin - viewState.xMin) / viewSpanX) * w;
        const endXPixel = ((activeXMax - viewState.xMin) / viewSpanX) * w;

        // Draw shaded region for active domain behind waveform
        ctx.fillStyle = 'rgba(99, 102, 241, 0.1)'; // primary tailwind color lightly shaded
        const drawStartX = Math.max(0, startXPixel);
        const drawEndX = Math.min(w, endXPixel);
        if (drawEndX > drawStartX) {
            ctx.fillRect(drawStartX, 0, drawEndX - drawStartX, h);
        }

        // Draw waveform
        ctx.beginPath();
        ctx.strokeStyle = '#38bdf8'; // var(--wave-color) equivalent
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';

        currentWaveformPoints.forEach((pt, index) => {
            const pixelX = ((pt.x - viewState.xMin) / viewSpanX) * w;
            const pixelY = h - ((pt.y - viewState.yMin) / viewSpanY) * h;

            if (index === 0) {
                ctx.moveTo(pixelX, pixelY);
            } else {
                ctx.lineTo(pixelX, pixelY);
            }
        });
        ctx.stroke();

        // Draw active domains vertical bars
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2;
        
        if (startXPixel >= 0 && startXPixel <= w) {
            ctx.moveTo(startXPixel, 0); 
            ctx.lineTo(startXPixel, h);
        }
        if (endXPixel >= 0 && endXPixel <= w) {
            ctx.moveTo(endXPixel, 0); 
            ctx.lineTo(endXPixel, h);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        
        if (isPlaying) updatePlayhead();
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
        const runtimeScope = getVariableScope();
        let minY = Infinity, maxY = -Infinity;
        
        for (let i = 0; i < frameCount; i++) {
            const progress = i / frameCount;
            const currentX = xMin + (progress * domainSpan);
            
            let y = 0;
            try {
                runtimeScope.x = currentX;
                y = compiledMath.evaluate(runtimeScope);
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

        // Apply a smooth fade-in and fade-out envelope directly to the buffer to prevent looping pops
        // 40 milliseconds with a cosine curve (Hann window style) provides a smooth transition without clicks
        const fadeDuration = Math.min(0.04, duration / 4); // Max 40ms or 25% of duration
        const fadeSamples = Math.floor(audioCtx.sampleRate * fadeDuration);
        
        for (let i = 0; i < fadeSamples; i++) {
            // Cosine taper from 0 to 1 smoothly
            const ratio = 0.5 - 0.5 * Math.cos(Math.PI * (i / fadeSamples));
            // Fade-in front end
            channelData[i] *= ratio;
            // Fade-out back end
            channelData[frameCount - 1 - i] *= ratio;
        }

        return buffer;
    }

    // --- WAV Export ---
    async function downloadWav() {
        if (!compiledMath) {
            errorMsg.textContent = 'Enter a valid equation first.';
            return;
        }

        const buffer = await generateAudioBuffer();
        if (!buffer) return;

        const wavBlob = encodeWav(buffer);
        const url = URL.createObjectURL(wavBlob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'mathmusesynth-sample.wav';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function encodeWav(audioBuffer) {
        const numChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const bitsPerSample = 16;
        const bytesPerSample = bitsPerSample / 8;
        const blockAlign = numChannels * bytesPerSample;
        const frameCount = audioBuffer.length;
        const dataSize = frameCount * blockAlign;
        const headerSize = 44;
        const totalSize = headerSize + dataSize;

        const arrayBuffer = new ArrayBuffer(totalSize);
        const view = new DataView(arrayBuffer);

        // RIFF chunk descriptor
        writeString(view, 0, 'RIFF');
        view.setUint32(4, totalSize - 8, true);
        writeString(view, 8, 'WAVE');

        // fmt sub-chunk
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);              // Sub-chunk size (16 for PCM)
        view.setUint16(20, 1, true);               // Audio format (1 = PCM)
        view.setUint16(22, numChannels, true);      // Number of channels
        view.setUint32(24, sampleRate, true);       // Sample rate
        view.setUint32(28, sampleRate * blockAlign, true); // Byte rate
        view.setUint16(32, blockAlign, true);       // Block align
        view.setUint16(34, bitsPerSample, true);    // Bits per sample

        // data sub-chunk
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        // Write interleaved PCM samples
        const channelData = [];
        for (let ch = 0; ch < numChannels; ch++) {
            channelData.push(audioBuffer.getChannelData(ch));
        }

        let offset = headerSize;
        for (let i = 0; i < frameCount; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
                const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(offset, int16, true);
                offset += 2;
            }
        }

        return new Blob([arrayBuffer], { type: 'audio/wav' });
    }

    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
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

        for (const symbol of newSymbols) {
            if (customVariables[symbol] === undefined) {
                if (symbol === 'a' || symbol === 'b') {
                    // Assign requested defaults, assuming 'a' and 'b' if using \sin(a*x)+\cos(b*x)
                    const defaultVal = symbol === 'a' ? 779.30 : 764.00;
                    customVariables[symbol] = { 
                        value: defaultVal, 
                        min: -10, 
                        max: 1000, 
                        step: 0.01, 
                        mode: 'oscillate', 
                        speed: 1, 
                        isAnimating: false, 
                        direction: 1 
                    };
                } else if (symbol === 'c') {
                    // Also support 'b' and 'c' if user requested \sin(b*x)+\cos(c*x) implicitly based on prompt text
                    customVariables[symbol] = { 
                        value: 764.00, 
                        min: -10, 
                        max: 1000, 
                        step: 0.01, 
                        mode: 'oscillate', 
                        speed: 1, 
                        isAnimating: false, 
                        direction: 1 
                    };
                } else {
                    customVariables[symbol] = { 
                        value: 1, 
                        min: -10, 
                        max: 10, 
                        step: 0.1, 
                        mode: 'oscillate', 
                        speed: 1, 
                        isAnimating: false, 
                        direction: 1 
                    };
                }
                changed = true;
            }
        }

        if (changed) {
            renderVariableSliders();
        }
    }

    let isFrameRequested = false;
    let lastVarAnimTime = 0;
    let lastAudioUpdate = 0;

    function ensureAnimationLoop() {
        if (!isFrameRequested) {
            isFrameRequested = true;
            lastVarAnimTime = performance.now();
            requestAnimationFrame(variableAnimationLoop);
        }
    }



    function variableAnimationLoop(timestamp) {
        isFrameRequested = false;
        const delta = (timestamp - lastVarAnimTime) / 1000;
        lastVarAnimTime = timestamp;

        
        let anyAnimating = false;
        let anyChanged = false;

        for (const [symbol, config] of Object.entries(customVariables)) {
            if (config.isAnimating) {
                anyAnimating = true;
                const domainSpan = Math.abs(config.max - config.min);
                // Base speed traverses 20% of domain per second at 1x
                const rate = config.speed * delta * Math.max(0.1, domainSpan * 0.2);
                
                if (config.mode === 'continuous') {
                    config.value += rate * config.direction;
                    anyChanged = true;
                } else if (config.mode === 'oscillate') {
                    config.value += rate * config.direction;
                    if (config.value >= config.max) {
                        config.value = config.max;
                        config.direction = -1;
                    } else if (config.value <= config.min) {
                        config.value = config.min;
                        config.direction = 1;
                    }
                    anyChanged = true;
                } else if (config.mode === 'loop') {
                    config.value += rate;
                    if (config.value >= config.max) {
                        config.value = config.min;
                    }
                    anyChanged = true;
                } else if (config.mode === 'once') {
                    if (config.value < config.max) {
                        config.value += rate;
                        if (config.value >= config.max) {
                            config.value = config.max;
                            config.isAnimating = false;
                        }
                        anyChanged = true;
                    } else {
                        config.isAnimating = false;
                        anyChanged = true;
                    }
                }
            }
        }

        if (anyChanged) {
            const inputs = variablesContainer.querySelectorAll('.variable-control-group');
            let idx = 0;
            for (const [symbol, config] of Object.entries(customVariables)) {
                const group = inputs[idx];
                if (group) {
                    const numInput = group.querySelector('.variable-number-input');
                    const slider = group.querySelector('.variable-slider');
                    const btn = group.querySelector('.btn-play-var');
                    if (numInput && slider) {
                        numInput.value = config.value.toFixed(2);
                        slider.value = config.value;
                    }
                    // Only touch the button when its rendered state actually disagrees
                    // with config.isAnimating. Rewriting innerHTML every frame destroys
                    // the <i> child; if a user's mousedown on this button lands on an
                    // <i> that gets replaced before mouseup, the click has no common
                    // ancestor and the browser drops it — which is why clicking the
                    // second variable's play button fails while the first is animating.
                    if (btn && btn.classList.contains('playing') !== config.isAnimating) {
                        btn.classList.toggle('playing', config.isAnimating);
                        btn.innerHTML = config.isAnimating
                            ? '<i class="ph-fill ph-pause"></i>'
                            : '<i class="ph-fill ph-play"></i>';
                    }
                }
                idx++;
            }
            requestRedraw();
            
            if (isPlaying) {
                const now = performance.now();
                if (now - lastAudioUpdate > 100) {
                    lastAudioUpdate = now;
                    updateAudioLive(); // Throttled real-time updates while animating
                }
            } else if (isPianoMode) {
                const now = performance.now();
                if (now - lastAudioUpdate > 100) {
                    lastAudioUpdate = now;
                    generateAudioBuffer().then(b => pianoBuffer = b);
                }
            }
        }

        if (anyAnimating) {
            isFrameRequested = true;
            requestAnimationFrame(variableAnimationLoop);
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

        for (const [symbol, config] of Object.entries(customVariables)) {
            const group = document.createElement('div');
            group.className = 'variable-control-group control-group';
            
            const header = document.createElement('div');
            header.className = 'variable-header';
            
            const label = document.createElement('label');
            label.textContent = symbol + " = ";
            
            const numInput = document.createElement('input');
            numInput.type = 'number';
            numInput.className = 'variable-number-input';
            numInput.step = config.step;
            numInput.min = config.min;
            numInput.max = config.max;
            numInput.value = config.value.toFixed(2);
            
            header.appendChild(label);
            header.appendChild(numInput);
            
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'variable-slider';
            slider.min = config.min;
            slider.max = config.max;
            slider.step = config.step;
            slider.value = config.value;

            const settings = document.createElement('div');
            settings.className = 'variable-settings';

            const minLabel = document.createElement('label');
            minLabel.textContent = 'Min';
            const minInput = document.createElement('input');
            minInput.type = 'number';
            minInput.value = config.min;
            minLabel.appendChild(minInput);

            const maxLabel = document.createElement('label');
            maxLabel.textContent = 'Max';
            const maxInput = document.createElement('input');
            maxInput.type = 'number';
            maxInput.value = config.max;
            maxLabel.appendChild(maxInput);

            const stepLabel = document.createElement('label');
            stepLabel.textContent = 'Step';
            const stepInput = document.createElement('input');
            stepInput.type = 'number';
            stepInput.value = config.step;
            stepLabel.appendChild(stepInput);

            settings.appendChild(minLabel);
            settings.appendChild(maxLabel);
            settings.appendChild(stepLabel);

            const controls = document.createElement('div');
            controls.className = 'variable-controls';

            const btnPlayVar = document.createElement('button');
            btnPlayVar.className = 'btn-play-var' + (config.isAnimating ? ' playing' : '');
            btnPlayVar.innerHTML = config.isAnimating ? '<i class="ph-fill ph-pause"></i>' : '<i class="ph-fill ph-play"></i>';
            btnPlayVar.title = "Play/Pause Animation";

            const modeSelect = document.createElement('select');
            modeSelect.title = "Animation Mode";
            modeSelect.innerHTML = `
                <option value="oscillate" ${config.mode==='oscillate'?'selected':''}>Oscillate</option>
                <option value="loop" ${config.mode==='loop'?'selected':''}>Loop</option>
                <option value="once" ${config.mode==='once'?'selected':''}>Play Once</option>
                <option value="continuous" ${config.mode==='continuous'?'selected':''}>Continuous</option>
            `;

            const speedLabel = document.createElement('div');
            speedLabel.style.display = 'flex';
            speedLabel.style.alignItems = 'center';
            speedLabel.style.gap = '4px';
            speedLabel.innerHTML = '<span style="color:var(--text-muted);font-size:0.8rem;">Speed</span>';
            const speedInput = document.createElement('input');
            speedInput.type = 'number';
            speedInput.step = '0.1';
            speedInput.min = '0.1';
            speedInput.value = config.speed;
            speedInput.title = "Speed multiplier (e.g. 1, 2, 0.5)";
            speedInput.style.width = '50px';
            speedLabel.appendChild(speedInput);

            controls.appendChild(btnPlayVar);
            controls.appendChild(modeSelect);
            controls.appendChild(speedLabel);

            // Sync interactions
            const updateVar = (newVal) => {
                let parsed = parseFloat(newVal);
                if (!isNaN(parsed)) {
                    if (config.mode !== 'continuous') {
                        parsed = Math.max(parseFloat(config.min), Math.min(parseFloat(config.max), parsed));
                    }
                    config.value = parsed;
                    slider.value = parsed;
                    numInput.value = parsed.toFixed(2);
                    requestRedraw();
                    if (isPlaying) {
                        const now = performance.now();
                        if (now - lastAudioUpdate > 100) {
                            lastAudioUpdate = now;
                            updateAudioLive();
                        }
                    } else if (isPianoMode) {
                        const now = performance.now();
                        if (now - lastAudioUpdate > 100) {
                            lastAudioUpdate = now;
                            generateAudioBuffer().then(b => pianoBuffer = b);
                        }
                    }
                }
            };

            slider.addEventListener('input', (e) => updateVar(e.target.value));
            numInput.addEventListener('change', (e) => updateVar(e.target.value));

            minInput.addEventListener('change', (e) => {
                config.min = parseFloat(e.target.value) || -10;
                slider.min = config.min;
                numInput.min = config.min;
                updateVar(config.value);
            });
            maxInput.addEventListener('change', (e) => {
                config.max = parseFloat(e.target.value) || 10;
                slider.max = config.max;
                numInput.max = config.max;
                updateVar(config.value);
            });
            stepInput.addEventListener('change', (e) => {
                config.step = parseFloat(e.target.value) || 0.1;
                slider.step = config.step;
                numInput.step = config.step;
            });
            modeSelect.addEventListener('change', (e) => {
                config.mode = e.target.value;
            });
            speedInput.addEventListener('change', (e) => {
                config.speed = parseFloat(e.target.value) || 1;
            });

            btnPlayVar.addEventListener('click', () => {
                config.isAnimating = !config.isAnimating;
                btnPlayVar.classList.toggle('playing', config.isAnimating);
                btnPlayVar.innerHTML = config.isAnimating ? '<i class="ph-fill ph-pause"></i>' : '<i class="ph-fill ph-play"></i>';
                if (config.isAnimating && config.mode === 'once' && config.value >= config.max) {
                     config.value = config.min;
                }
                ensureAnimationLoop();
            });

            group.appendChild(header);
            group.appendChild(slider);
            group.appendChild(settings);
            group.appendChild(controls);
            variablesContainer.appendChild(group);
        }
    }

    // --- Piano Mode Functions ---
    async function togglePianoMode() {
        isPianoMode = !isPianoMode;
        if (isPianoMode) {
            if (isPlaying) stopAudio(); // Stop normal playback
            btnPianoMode.classList.add('active');
            btnPianoMode.innerHTML = '<i class="ph-fill ph-piano-keys"></i> Exit Piano Mode';
            pianoInstructions.style.display = 'block';
            document.getElementById('piano-visual-container').classList.add('active');
            document.querySelector('.main-graph').classList.add('piano-active');
            
            // Force recalculate canvas geometries immediately since viewport slice mathematically altered height natively
            resizeCanvas();
            drawWaveform();
            
            btnPianoMode.style.opacity = '0.5';
            pianoBuffer = await generateAudioBuffer();
            btnPianoMode.style.opacity = '1';
        } else {
            btnPianoMode.classList.remove('active');
            btnPianoMode.innerHTML = '<i class="ph-fill ph-piano-keys"></i> Piano Mode';
            pianoInstructions.style.display = 'none';
            document.getElementById('piano-visual-container').classList.remove('active');
            document.querySelector('.main-graph').classList.remove('piano-active');
            
            // Force recalculate canvas geometries back to full window height mathematically
            resizeCanvas();
            drawWaveform();
            
            // Clean up any globally stuck keys visually
            document.querySelectorAll('.piano-key.active').forEach(k => k.classList.remove('active'));
            releaseAllNotes();
            pianoBuffer = null;
        }
    }

    function setupPianoPointerInput() {
        const pianoContainer = document.getElementById('piano-visual-container');
        if (!pianoContainer) return;

        // pointerId -> { keyEl, noteId } for pointers currently pressing a key.
        // Keying note IDs by pointerId (not by data-key) lets independent fingers
        // on different keys release independently, and keeps pointer-triggered
        // notes from colliding with keyboard-triggered ones keyed by KeyboardEvent.code.
        const pointerNotes = new Map();

        const startNote = (keyEl, pointerId) => {
            const keyCode = keyEl.getAttribute('data-key');
            const semitone = KEY_TO_SEMITONE[keyCode];
            if (semitone === undefined) return;

            const noteId = `pointer:${pointerId}`;
            playNote(noteId, semitone);
            pointerNotes.set(pointerId, { keyEl, noteId });
            keyEl.classList.add('active');

            const multiplier = Math.pow(2, semitone / 12);
            document.getElementById('piano-telemetry-mult').textContent = `Pitch Multiplier: ${multiplier.toFixed(2)} x`;
        };

        const endNote = (pointerId) => {
            const info = pointerNotes.get(pointerId);
            if (!info) return;
            releaseNote(info.noteId);
            info.keyEl.classList.remove('active');
            pointerNotes.delete(pointerId);
        };

        pianoContainer.querySelectorAll('.piano-key').forEach(keyEl => {
            keyEl.addEventListener('pointerdown', (e) => {
                if (!isPianoMode || !pianoBuffer) return;
                // preventDefault suppresses the synthetic mouse/click that follows
                // a touch, and (together with touch-action: none in CSS) stops the
                // browser from claiming the gesture for scroll/zoom on mobile.
                e.preventDefault();
                startNote(keyEl, e.pointerId);
                // Capture so a pointerup outside the key (finger slid off) still
                // reaches this element — otherwise the note would get stuck.
                try { keyEl.setPointerCapture(e.pointerId); } catch (_) {}
            });

            keyEl.addEventListener('pointerup', (e) => endNote(e.pointerId));
            keyEl.addEventListener('pointercancel', (e) => endNote(e.pointerId));
        });
    }

    function handleKeyDown(e) {
        if (!isPianoMode || !pianoBuffer || e.repeat) return;

        // Suppress piano input only when the focused element actually consumes
        // letter keys as text — math-field, textarea, or a text-accepting
        // <input>. Range/number/checkbox etc. inputs can't absorb the letter
        // keys that map to notes, so blocking them would make the piano appear
        // broken after the user touches e.g. the volume slider (which retains
        // focus after a click).
        const activeEl = document.activeElement;
        if (activeEl) {
            if (activeEl.closest('math-field')) return;
            if (activeEl.tagName === 'TEXTAREA') return;
            if (activeEl.isContentEditable) return;
            if (activeEl.tagName === 'INPUT') {
                const type = (activeEl.type || 'text').toLowerCase();
                const textInputTypes = ['text', 'search', 'email', 'url', 'password', 'tel'];
                if (textInputTypes.includes(type)) return;
            }
        }

        const semitone = KEY_TO_SEMITONE[e.code];
        if (semitone !== undefined) {
            playNote(e.code, semitone);
            
            const keyEl = document.querySelector(`.piano-key[data-key="${e.code}"]`);
            if (keyEl) keyEl.classList.add('active');
            
            const multiplier = Math.pow(2, semitone / 12);
            document.getElementById('piano-telemetry-mult').textContent = `Pitch Multiplier: ${multiplier.toFixed(2)} x`;
        }
    }

    function handleKeyUp(e) {
        if (!isPianoMode) return;
        releaseNote(e.code);
        
        const keyEl = document.querySelector(`.piano-key[data-key="${e.code}"]`);
        if (keyEl) keyEl.classList.remove('active');
    }
    
    function playNote(keyCode, semitone) {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        if (activeNotes[keyCode]) {
            releaseNote(keyCode); // Quick release old if key stuck
        }

        const source = audioCtx.createBufferSource();
        source.buffer = pianoBuffer;
        source.loop = true;
        
        source.playbackRate.value = Math.pow(2, semitone / 12);

        const envGain = audioCtx.createGain();
        envGain.gain.setValueAtTime(0, audioCtx.currentTime);
        envGain.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.05);

        source.connect(envGain);
        if (!gainNode) {
            gainNode = audioCtx.createGain();
            gainNode.connect(audioCtx.destination);
        }
        envGain.connect(gainNode);

        source.start();
        activeNotes[keyCode] = { source, envGain };
    }

    function releaseNote(keyCode) {
        const note = activeNotes[keyCode];
        if (note) {
            const now = audioCtx.currentTime;
            note.envGain.gain.cancelScheduledValues(now);
            note.envGain.gain.setValueAtTime(note.envGain.gain.value, now);
            note.envGain.gain.linearRampToValueAtTime(0, now + 0.1);
            
            note.source.stop(now + 0.15);
            
            setTimeout(() => {
                try { note.source.disconnect(); note.envGain.disconnect(); } catch(e){}
            }, 200);
            
            delete activeNotes[keyCode];
        }
    }

    function releaseAllNotes() {
        for (const code in activeNotes) {
            releaseNote(code);
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
        if (isPianoMode) return;
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

        fadeNode = audioCtx.createGain();
        fadeNode.gain.setValueAtTime(0, audioCtx.currentTime);
        fadeNode.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.02); // 20ms fade in

        if (!gainNode) {
            gainNode = audioCtx.createGain();
            gainNode.connect(audioCtx.destination);
        }
        
        gainNode.gain.setValueAtTime(Math.pow(parseFloat(volumeInput.value), 2), audioCtx.currentTime);
        
        sourceNode.connect(fadeNode);
        fadeNode.connect(gainNode);

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
        const oldFadeNode = fadeNode;
        
        sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = buffer;
        sourceNode.loop = isLooping;
        
        fadeNode = audioCtx.createGain();
        fadeNode.gain.setValueAtTime(0, audioCtx.currentTime);
        fadeNode.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.02); // 20ms fade in
        
        sourceNode.connect(fadeNode);
        if (gainNode) fadeNode.connect(gainNode);
        
        const offset = fraction * newDuration;
        sourceNode.start(0, offset);
        
        startTime = audioCtx.currentTime - offset;
        activeDuration = newDuration;

        if (oldNode && oldFadeNode) {
            // Fade out the old node 20ms
            oldFadeNode.gain.setValueAtTime(oldFadeNode.gain.value, audioCtx.currentTime);
            oldFadeNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.02);
            oldNode.onended = null; // Prevent it from stopping the new node
            try { oldNode.stop(audioCtx.currentTime + 0.02); } catch(e) {}
            
            // Clean up old disconnected nodes safely
            setTimeout(() => {
                try { oldNode.disconnect(); oldFadeNode.disconnect(); } catch(e) {}
            }, 50);
        }
        
        sourceNode.onended = () => {
            if (!isLooping) stopAudio();
        };
    }

    function stopAudio() {
        if (sourceNode && fadeNode) {
            const oldNode = sourceNode;
            const oldFadeNode = fadeNode;
            oldFadeNode.gain.setValueAtTime(oldFadeNode.gain.value, audioCtx.currentTime);
            oldFadeNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.02);
            try { oldNode.stop(audioCtx.currentTime + 0.02); } catch(e) {}
            
            setTimeout(() => {
                try { oldNode.disconnect(); oldFadeNode.disconnect(); } catch(e) {}
            }, 50);
            
            sourceNode = null;
            fadeNode = null;
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
        const activeXMin = parseFloat(xMinInput.value);
        const activeXMax = parseFloat(xMaxInput.value);
        const currentActiveX = activeXMin + fraction * (activeXMax - activeXMin);
        const viewSpanX = viewState.xMax - viewState.xMin;
        const pixelPosition = ((currentActiveX - viewState.xMin) / viewSpanX) * rect.width;
        
        playhead.style.transform = `translateX(${pixelPosition}px)`;
        if (pixelPosition >= 0 && pixelPosition <= rect.width) {
            playhead.style.display = 'block';
        } else {
            playhead.style.display = 'none';
        }
    }

    function requestRedraw() {
        if (!isRedrawQueued) {
            isRedrawQueued = true;
            requestAnimationFrame(() => {
                calculatePathPoints();
                drawWaveform();
                isRedrawQueued = false;
            });
        }
    }

    function setupCanvasInteractions() {
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const pX = mouseX / rect.width;
            const viewSpanX = viewState.xMax - viewState.xMin;
            const mathX = viewState.xMin + pX * viewSpanX;
            
            // Zoom factor
            const zoomIn = e.deltaY < 0;
            const factor = zoomIn ? 0.8 : 1.25;
            const newSpanX = viewSpanX * factor;
            
            viewState.xMin = mathX - pX * newSpanX;
            viewState.xMax = mathX + (1 - pX) * newSpanX;
            requestRedraw();
        }, { passive: false });

        canvas.addEventListener('mousedown', (e) => {
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            
            const activeXMin = parseFloat(xMinInput.value);
            const activeXMax = parseFloat(xMaxInput.value);
            const viewSpanX = viewState.xMax - viewState.xMin;
            
            const startXPixel = ((activeXMin - viewState.xMin) / viewSpanX) * rect.width;
            const endXPixel = ((activeXMax - viewState.xMin) / viewSpanX) * rect.width;
            
            const grabThreshold = 10;
            if (Math.abs(mouseX - startXPixel) < grabThreshold) {
                viewState.dragMode = 'drag-min';
                document.body.style.cursor = 'ew-resize';
            } else if (Math.abs(mouseX - endXPixel) < grabThreshold) {
                viewState.dragMode = 'drag-max';
                document.body.style.cursor = 'ew-resize';
            } else {
                viewState.dragMode = 'pan';
                document.body.style.cursor = 'grabbing';
            }
            viewState.isDragging = true;
            viewState.lastMouseX = e.clientX;
            viewState.lastMouseY = e.clientY;
        });

        window.addEventListener('mousemove', (e) => {
            if (!viewState.isDragging) {
                const rect = canvas.getBoundingClientRect();
                if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
                    const mouseX = e.clientX - rect.left;
                    const activeXMin = parseFloat(xMinInput.value);
                    const activeXMax = parseFloat(xMaxInput.value);
                    const viewSpanX = viewState.xMax - viewState.xMin;
                    const startXPixel = ((activeXMin - viewState.xMin) / viewSpanX) * rect.width;
                    const endXPixel = ((activeXMax - viewState.xMin) / viewSpanX) * rect.width;
                    const grabThreshold = 10;
                    if (Math.abs(mouseX - startXPixel) < grabThreshold || Math.abs(mouseX - endXPixel) < grabThreshold) {
                        canvas.style.cursor = 'ew-resize';
                    } else {
                        canvas.style.cursor = 'grab';
                    }
                }
                return;
            }
            
            const dx = e.clientX - viewState.lastMouseX;
            const dy = e.clientY - viewState.lastMouseY;
            viewState.lastMouseX = e.clientX;
            viewState.lastMouseY = e.clientY;
            
            const rect = canvas.getBoundingClientRect();
            const viewSpanX = viewState.xMax - viewState.xMin;
            const dxMath = (dx / rect.width) * viewSpanX;
            
            if (viewState.dragMode === 'pan') {
                viewState.xMin -= dxMath;
                viewState.xMax -= dxMath;
                const viewSpanY = viewState.yMax - viewState.yMin;
                const dyMath = (dy / rect.height) * viewSpanY;
                viewState.yMin += dyMath; // Pixel Y is inverted 
                viewState.yMax += dyMath;
                requestRedraw();
            } else if (viewState.dragMode === 'drag-min') {
                let currentVal = parseFloat(xMinInput.value);
                let newVal = currentVal + dxMath;
                let maxVal = parseFloat(xMaxInput.value);
                if (newVal >= maxVal - 0.1) newVal = maxVal - 0.1;
                xMinInput.value = newVal.toFixed(2);
                requestRedraw();
            } else if (viewState.dragMode === 'drag-max') {
                let currentVal = parseFloat(xMaxInput.value);
                let newVal = currentVal + dxMath;
                let minVal = parseFloat(xMinInput.value);
                if (newVal <= minVal + 0.1) newVal = minVal + 0.1;
                xMaxInput.value = newVal.toFixed(2);
                requestRedraw();
            }
        });

        window.addEventListener('mouseup', () => {
            if (viewState.isDragging) {
                viewState.isDragging = false;
                document.body.style.cursor = '';
                canvas.style.cursor = 'grab';
                if (viewState.dragMode !== 'pan') {
                    parseAndDraw();
                    if (isPlaying) updateAudioLive();
                }
            }
        });
    }

    // Run
    init();
});
