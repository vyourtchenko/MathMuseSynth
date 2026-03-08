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

        const xMin = viewState.xMin;
        const xMax = viewState.xMax;
        
        if (xMin >= xMax || isNaN(xMin) || isNaN(xMax)) {
            return;
        }

        // Calculate points for visual purposes
        const resolution = 2000;
        const widthRange = xMax - xMin;
        const step = widthRange / resolution;
        
        for (let i = 0; i <= resolution; i++) {
            const currentX = xMin + (i * step);
            try {
                const scope = { x: currentX, ...customVariables };
                const y = compiledMath.evaluate(scope);
                // Only consider finite numbers
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
