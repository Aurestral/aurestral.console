/* ==============================================================
   Aurestral Console - Enhanced with Voice Mode
   ============================================================== */

/* ---------- STATE ------------------------------------------- */
var DEFAULT_SYSTEM_PROMPT = "You are Aurestral, a helpful AI assistant made by the Aurestral.Console.";

var state = {
    inChatMode:   false,
    voiceMode:    false,
    chatHistory:  [],
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    recognition:  null,
    synthesis:    window.speechSynthesis,
    isListening:  false,
    isSpeaking:   false
};

/* ---------- CONFIG ------------------------------------------ */
var PROXY_URL = "/.netlify/functions/groq-proxy";
var MODEL     = "moonshotai/kimi-k2-instruct-0905";

// Audio effects settings (similar to Python version)
var AUDIO_EFFECTS = {
    enabled: true,
    pitch: 0.95,        // Slightly lower pitch
    rate: 0.92,         // Slower rate (similar to 1.05x slow down)
    volume: 0.9
};

/* ---------- MARKDOWN & LATEX RENDERER --------------------- */
function renderMarkdownWithLatex(text) {
    // First, protect LaTeX blocks from markdown processing
    var latexBlocks = [];
    var processedText = text.replace(/\$\$([\s\S]+?)\$\$/g, function(match, latex, offset) {
        var id = "__LATEX_BLOCK_" + latexBlocks.length + "__";
        latexBlocks.push({ type: 'block', latex: latex.trim() });
        return id;
    });
    
    processedText = processedText.replace(/\$([^\$\n]+?)\$/g, function(match, latex, offset) {
        var id = "__LATEX_INLINE_" + latexBlocks.length + "__";
        latexBlocks.push({ type: 'inline', latex: latex.trim() });
        return id;
    });

    // Basic markdown rendering
    var html = processedText
        // Headers
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/_(.+?)_/g, '<em>$1</em>')
        // Code blocks
        .replace(/```(\w+)?\n([\s\S]+?)```/g, '<pre><code class="language-$1">$2</code></pre>')
        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Links
        .replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
        // Line breaks
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');

    // Restore LaTeX and render it
    latexBlocks.forEach(function(item, index) {
        var placeholder = item.type === 'block' 
            ? "__LATEX_BLOCK_" + index + "__"
            : "__LATEX_INLINE_" + index + "__";
        
        var span = document.createElement('span');
        span.className = item.type === 'block' ? 'latex-block' : 'latex-inline';
        
        try {
            if (typeof katex !== 'undefined') {
                katex.render(item.latex, span, {
                    displayMode: item.type === 'block',
                    throwOnError: false
                });
                html = html.replace(placeholder, span.outerHTML);
            } else {
                // Fallback if KaTeX not loaded
                html = html.replace(placeholder, 
                    item.type === 'block' 
                        ? "<div class='latex-fallback'>$$" + item.latex + "$$</div>"
                        : "<span class='latex-fallback'>$" + item.latex + "$</span>"
                );
            }
        } catch (e) {
            console.error('KaTeX render error:', e);
            html = html.replace(placeholder, "<span class='latex-error'>[LaTeX Error]</span>");
        }
    });

    return html;
}

/* ---------- VOICE RECOGNITION SETUP ----------------------- */
function initVoiceRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        addOutput("Voice recognition not supported in this browser.", "error");
        return null;
    }

    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    var recognition = new SpeechRecognition();
    
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = function() {
        state.isListening = true;
        updateMicrophoneState();
        addOutput("🎤 Listening...", "listening");
    };

    recognition.onresult = function(event) {
        var transcript = event.results[0][0].transcript;
        addOutput("You: " + transcript);
        
        // Check for exit command
        if (transcript.toLowerCase().includes('descent')) {
            exitChatMode();
        } else {
            streamChat(transcript);
        }
    };

    recognition.onerror = function(event) {
        console.error('Speech recognition error:', event.error);
        if (event.error !== 'no-speech') {
            addOutput("Voice error: " + event.error, "error");
        }
        state.isListening = false;
        updateMicrophoneState();
    };

    recognition.onend = function() {
        state.isListening = false;
        updateMicrophoneState();
    };

    return recognition;
}

/* ---------- TEXT-TO-SPEECH WITH EFFECTS ------------------ */
var audioContext = null;
var currentSource = null;
var audioElement = null;
var isPaused = false;

function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

function createReverbEffect(context) {
    // Create convolver for reverb
    var convolver = context.createConvolver();
    
    // Generate impulse response (simple reverb)
    var rate = context.sampleRate;
    var length = rate * 2; // 2 second reverb
    var impulse = context.createBuffer(2, length, rate);
    var impulseL = impulse.getChannelData(0);
    var impulseR = impulse.getChannelData(1);
    
    for (var i = 0; i < length; i++) {
        var decay = Math.exp(-i / (rate * 0.5)); // Decay over 0.5 seconds
        impulseL[i] = (Math.random() * 2 - 1) * decay;
        impulseR[i] = (Math.random() * 2 - 1) * decay;
    }
    
    convolver.buffer = impulse;
    return convolver;
}

function createDelayEffect(context) {
    var delay = context.createDelay();
    delay.delayTime.value = 0.07; // 70ms delay (matching Python version)
    
    var feedback = context.createGain();
    feedback.gain.value = 0.5; // 50% feedback (matching Python decay)
    
    delay.connect(feedback);
    feedback.connect(delay);
    
    return { delay: delay, feedback: feedback };
}

function speakWithEffects(text) {
    // Remove markdown and LaTeX for TTS
    var cleanText = text
        .replace(/\$\$[\s\S]+?\$\$/g, '')
        .replace(/\$[^\$\n]+?\$/g, '')
        .replace(/```[\s\S]+?```/g, '')
        .replace(/`[^`]+`/g, '')
        .replace(/[*_#\[\]()]/g, '')
        .replace(/<[^>]+>/g, '')
        .trim();

    if (!cleanText) return;

    // Stop any current speech
    if (state.isSpeaking) {
        stopTTS();
    }

    var utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Configure voice settings to match en-CA-LiamNeural characteristics
    utterance.rate = 0.85;  // Slower (matching -5% from edge-tts + slowing effect)
    utterance.pitch = 0.9;  // Slightly lower pitch
    utterance.volume = 1.0;

    // Try to find a Canadian or similar voice
    var voices = state.synthesis.getVoices();
    var preferredVoice = voices.find(function(v) {
        return v.lang.startsWith('en-CA') || v.name.includes('Liam');
    }) || voices.find(function(v) {
        return v.lang.startsWith('en-US') && v.name.includes('Male');
    }) || voices.find(function(v) {
        return v.name.includes('Google') || v.name.includes('Microsoft');
    }) || voices[0];
    
    if (preferredVoice) {
        utterance.voice = preferredVoice;
    }

    isPaused = false;
    
    utterance.onstart = function() {
        state.isSpeaking = true;
        updateSpeakingIndicator(true);
        showTTSControl();
    };

    utterance.onend = function() {
        state.isSpeaking = false;
        isPaused = false;
        updateSpeakingIndicator(false);
        hideTTSControl();
        
        // Auto-restart listening if in voice mode
        if (state.voiceMode && !state.isListening) {
            setTimeout(function() { startListening(); }, 500);
        }
    };

    utterance.onerror = function(event) {
        console.error('Speech synthesis error:', event);
        state.isSpeaking = false;
        isPaused = false;
        updateSpeakingIndicator(false);
        hideTTSControl();
    };

    state.synthesis.speak(utterance);
    state.currentUtterance = utterance;
}

function toggleTTS() {
    if (!state.synthesis) return;
    
    if (isPaused) {
        state.synthesis.resume();
        isPaused = false;
        updateTTSControlIcon(false);
    } else {
        state.synthesis.pause();
        isPaused = true;
        updateTTSControlIcon(true);
    }
}

function stopTTS() {
    if (state.synthesis) {
        state.synthesis.cancel();
    }
    state.isSpeaking = false;
    isPaused = false;
    updateSpeakingIndicator(false);
    hideTTSControl();
}

function showTTSControl() {
    var control = document.getElementById('ttsControl');
    if (control) {
        control.style.display = 'flex';
        updateTTSControlIcon(false);
    }
}

function hideTTSControl() {
    var control = document.getElementById('ttsControl');
    if (control) {
        control.style.display = 'none';
    }
}

function updateTTSControlIcon(paused) {
    var icon = document.querySelector('.tts-icon');
    var button = document.getElementById('ttsControl');
    if (icon && button) {
        icon.textContent = paused ? '▶' : '⏸';
        if (paused) {
            button.classList.add('paused');
        } else {
            button.classList.remove('paused');
        }
    }
}

/* ---------- UI UPDATES ------------------------------------ */
function updateMicrophoneState() {
    var micButton = document.getElementById('micButton');
    if (!micButton) return;

    if (state.isListening) {
        micButton.classList.add('listening');
        micButton.querySelector('.mic-icon').innerHTML = '🎤';
    } else {
        micButton.classList.remove('listening');
        micButton.querySelector('.mic-icon').innerHTML = '🎙️';
    }
}

function updateSpeakingIndicator(isSpeaking) {
    var indicator = document.getElementById('speakingIndicator');
    if (!indicator) return;

    if (isSpeaking) {
        indicator.classList.add('active');
        indicator.textContent = '🔊 Speaking...';
    } else {
        indicator.classList.remove('active');
        indicator.textContent = '';
    }
}

function showVoiceControls() {
    var controls = document.getElementById('voiceControls');
    if (!controls) {
        controls = document.createElement('div');
        controls.id = 'voiceControls';
        controls.className = 'voice-controls';
        controls.innerHTML = '<div class="voice-status">' +
            '<div id="speakingIndicator" class="speaking-indicator"></div>' +
            '</div>' +
            '<button id="micButton" class="mic-button">' +
            '<span class="mic-icon">🎙️</span>' +
            '</button>';
        
        document.querySelector('.terminal-container').insertBefore(
            controls, 
            document.querySelector('.prompt')
        );

        // Add click handler
        document.getElementById('micButton').addEventListener('click', toggleListening);
    }
    controls.style.display = 'flex';
}

function hideVoiceControls() {
    var controls = document.getElementById('voiceControls');
    if (controls) {
        controls.style.display = 'none';
    }
}

function startListening() {
    if (state.isListening || state.isSpeaking) return;
    if (state.recognition) {
        state.recognition.start();
    }
}

function toggleListening() {
    if (state.isSpeaking) {
        stopTTS();
        return;
    }

    if (state.isListening) {
        state.recognition.stop();
    } else {
        startListening();
    }
}

/* ---------- COMMANDS ---------------------------------------- */
var commands = {
    "ascent(k2)": {
        execute: function() {
            state.inChatMode  = true;
            state.voiceMode   = false;
            state.chatHistory = [{ role: "system", content: state.systemPrompt }];
            hideVoiceControls();
            addOutput("K2 chat mode activated (Groq - moonshotai/kimi-k2-instruct-0905).");
            addOutput("Aurestral: Ready when you are, sir.");
            commandInput.placeholder = "Chat with Aurestral… (type `descent` to exit)";
            return "";
        }
    },

    "ascent(k2, audio)": {
        execute: function() {
            state.inChatMode  = true;
            state.voiceMode   = true;
            state.chatHistory = [{ role: "system", content: state.systemPrompt }];
            state.recognition = initVoiceRecognition();
            
            if (!state.recognition) {
                addOutput("Voice mode unavailable. Falling back to text mode.", "error");
                state.voiceMode = false;
                return "";
            }

            showVoiceControls();
            addOutput("🎙️ K2 voice mode activated!");
            addOutput("Aurestral: Ready to listen, sir. Click the microphone or press it to speak.");
            commandInput.placeholder = "Voice mode active (type `descent` to exit)";
            
            // Auto-start listening after a brief delay
            setTimeout(function() { startListening(); }, 1000);
            return "";
        }
    },

    "descent": {
        execute: function() { 
            return exitChatMode();
        }
    },

    "edit(k2/system_prompt =": {
        execute: function(full) {
            var match = full.match(/system_prompt\s*=\s*["'](.+)["']\s*\)$/i);
            if (!match) return 'Error: syntax is  edit(K2/system_prompt = "your prompt here")';

            state.systemPrompt = match[1];

            if (state.inChatMode && state.chatHistory.length > 0 && state.chatHistory[0].role === "system") {
                state.chatHistory[0].content = state.systemPrompt;
            }

            return "System prompt updated.";
        }
    }
};

/* ---------- EXIT CHAT --------------------------------------- */
function exitChatMode() {
    // Stop any ongoing speech
    stopTTS();

    // Stop listening
    if (state.isListening && state.recognition) {
        state.recognition.stop();
    }

    state.inChatMode  = false;
    state.voiceMode   = false;
    state.chatHistory = [];
    
    hideVoiceControls();
    commandInput.placeholder = "Enter command...";
    addOutput("Exiting Chat Mode.");
}

/* ---------- DOM --------------------------------------------- */
var terminal     = document.getElementById("terminal");
var commandInput = document.getElementById("commandInput");

/* ---------- OUTPUT ------------------------------------------ */
function addOutput(text, className) {
    className = className || "";
    var line = document.createElement("div");
    line.className = "output-line " + className;
    
    if (Array.isArray(text)) {
        text.forEach(function(t) {
            var m = document.createElement("div");
            m.className = "module";
            m.textContent = t;
            line.appendChild(m);
        });
    } else {
        // Check if this is an Aurestral response (for markdown/latex rendering)
        if (text.startsWith("Aurestral: ") && (text.includes('$') || text.includes('**') || text.includes('`'))) {
            var prefix = "Aurestral: ";
            var content = text.substring(prefix.length);
            line.innerHTML = prefix + renderMarkdownWithLatex(content);
        } else {
            line.innerHTML = text.replace(/\n/g, "<br>");
        }
    }
    
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

/* ---------- STREAM CHAT (via edge-function proxy) ----------- */
async function streamChat(userInput) {
    if (!userInput.trim()) return;

    addOutput("You: " + userInput);
    state.chatHistory.push({ role: "user", content: userInput });

    var payload = {
        model:       MODEL,
        messages:    state.chatHistory,
        max_tokens:  2048,
        temperature: 0.7,
        stream:      true
    };

    var response;
    try {
        response = await fetch(PROXY_URL, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(payload)
        });
    } catch (e) {
        addOutput("Network error: " + e.message, "error");
        return;
    }

    if (!response.ok) {
        var txt = await response.text();
        addOutput("API error (" + response.status + "): " + txt, "error");
        return;
    }

    var reader  = response.body.getReader();
    var decoder = new TextDecoder();
    var full    = "";
    
    // Create initial output line
    var responseLine = document.createElement("div");
    responseLine.className = "output-line";
    responseLine.innerHTML = "Aurestral: ";
    terminal.appendChild(responseLine);

    while (true) {
        var result = await reader.read();
        if (result.done) break;
        
        var chunk = decoder.decode(result.value);
        var lines = chunk.split("\n").filter(function(l) { return l.startsWith("data: "); });
        
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line === "data: [DONE]") break;
            try {
                var data = JSON.parse(line.slice(6));
                var content = (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) || "";
                if (content) {
                    full += content;
                    // Update with rendered markdown/latex
                    responseLine.innerHTML = "Aurestral: " + renderMarkdownWithLatex(full);
                    terminal.scrollTop = terminal.scrollHeight;
                }
            } catch (err) {
                // Skip invalid JSON
            }
        }
    }

    state.chatHistory.push({ role: "assistant", content: full });

    // If in voice mode, speak the response
    if (state.voiceMode) {
        speakWithEffects(full);
    }
}

/* ---------- INPUT PROCESSING ------------------------------- */
function processInput(raw) {
    var input = raw.trim().toLowerCase();
    if (state.inChatMode) {
        if (input === "descent" || input.startsWith("edit(")) {
            processCommand(input, raw);
        } else {
            streamChat(raw);
        }
    } else {
        processCommand(input, raw);
    }
}

function processCommand(lower, original) {
    original = original || lower;
    addOutput(">>> " + original);

    for (var key in commands) {
        if (commands.hasOwnProperty(key)) {
            if (lower.startsWith(key.toLowerCase())) {
                var result = commands[key].execute(original);
                if (result !== undefined && result !== "") {
                    addOutput(result, result.startsWith("Error") ? "error" : "success");
                }
                return;
            }
        }
    }
    addOutput("Command not recognized", "error");
}

/* ---------- EVENT LISTENERS -------------------------------- */
commandInput.addEventListener("keydown", function(e) {
    if (e.key === "Enter") {
        var val = commandInput.value.trim();
        if (val) {
            processInput(val);
            commandInput.value = "";
        }
    }
});

window.addEventListener("load", function() {
    commandInput.focus();
    
    // Load voices for speech synthesis
    if ('speechSynthesis' in window) {
        speechSynthesis.addEventListener('voiceschanged', function() {
            var voices = speechSynthesis.getVoices();
            console.log('Available voices:', voices.map(function(v) { return v.name; }));
        });
    }
    
    // Add TTS control button listener
    var ttsControl = document.getElementById('ttsControl');
    if (ttsControl) {
        ttsControl.addEventListener('click', toggleTTS);
    }
});

/* ---------- MOBILE KEYBOARD HANDLING ------------------------ */
if (window.visualViewport) {
    function onViewportResize() {
        document.documentElement.style.setProperty(
            "--vv-height",
            window.visualViewport.height + "px"
        );
    }
    window.visualViewport.addEventListener("resize", onViewportResize);
    onViewportResize();
}
