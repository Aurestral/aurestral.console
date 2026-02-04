/* ==============================================================
   Aurestral Console — Enhanced with Voice Mode
   ============================================================== */

/* ---------- STATE ------------------------------------------- */
const DEFAULT_SYSTEM_PROMPT = `You are Aurestral, a helpful AI assistant made by the Aurestral.Console.`;

const state = {
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
const PROXY_URL = "/.netlify/functions/groq-proxy";
const MODEL     = "moonshotai/kimi-k2-instruct-0905";

// Audio effects settings (similar to Python version)
const AUDIO_EFFECTS = {
    enabled: true,
    pitch: 0.95,        // Slightly lower pitch
    rate: 0.92,         // Slower rate (similar to 1.05x slow down)
    volume: 0.9
};

/* ---------- MARKDOWN & LATEX RENDERER --------------------- */
function renderMarkdownWithLatex(text) {
    // First, protect LaTeX blocks from markdown processing
    const latexBlocks = [];
    let protected = text.replace(/\$\$([\s\S]+?)\$\$/g, (match, latex, offset) => {
        const id = `__LATEX_BLOCK_${latexBlocks.length}__`;
        latexBlocks.push({ type: 'block', latex: latex.trim() });
        return id;
    });
    
    protected = protected.replace(/\$([^\$\n]+?)\$/g, (match, latex, offset) => {
        const id = `__LATEX_INLINE_${latexBlocks.length}__`;
        latexBlocks.push({ type: 'inline', latex: latex.trim() });
        return id;
    });

    // Basic markdown rendering
    let html = protected
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
    latexBlocks.forEach((item, index) => {
        const placeholder = item.type === 'block' 
            ? `__LATEX_BLOCK_${index}__`
            : `__LATEX_INLINE_${index}__`;
        
        const span = document.createElement('span');
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
                        ? `<div class="latex-fallback">$$${item.latex}$$</div>`
                        : `<span class="latex-fallback">$${item.latex}$</span>`
                );
            }
        } catch (e) {
            console.error('KaTeX render error:', e);
            html = html.replace(placeholder, `<span class="latex-error">[LaTeX Error]</span>`);
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

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        state.isListening = true;
        updateMicrophoneState();
        addOutput("🎤 Listening...", "listening");
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        addOutput(`You: ${transcript}`);
        
        // Check for exit command
        if (transcript.toLowerCase().includes('descent')) {
            exitChatMode();
        } else {
            streamChat(transcript);
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error !== 'no-speech') {
            addOutput(`Voice error: ${event.error}`, "error");
        }
        state.isListening = false;
        updateMicrophoneState();
    };

    recognition.onend = () => {
        state.isListening = false;
        updateMicrophoneState();
    };

    return recognition;
}

/* ---------- TEXT-TO-SPEECH WITH EFFECTS ------------------ */
function speakWithEffects(text) {
    if (state.isSpeaking) {
        state.synthesis.cancel();
    }

    // Remove markdown and LaTeX for TTS
    const cleanText = text
        .replace(/\$\$[\s\S]+?\$\$/g, '') // Remove block LaTeX
        .replace(/\$[^\$\n]+?\$/g, '')    // Remove inline LaTeX
        .replace(/```[\s\S]+?```/g, '')    // Remove code blocks
        .replace(/`[^`]+`/g, '')           // Remove inline code
        .replace(/[*_#\[\]()]/g, '')       // Remove markdown symbols
        .replace(/<[^>]+>/g, '')           // Remove HTML tags
        .trim();

    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Apply audio effects
    if (AUDIO_EFFECTS.enabled) {
        utterance.pitch = AUDIO_EFFECTS.pitch;
        utterance.rate = AUDIO_EFFECTS.rate;
        utterance.volume = AUDIO_EFFECTS.volume;
    }

    // Try to use a more robotic/AI voice if available
    const voices = state.synthesis.getVoices();
    const preferredVoice = voices.find(v => 
        v.name.includes('Google') || 
        v.name.includes('Microsoft') ||
        v.name.includes('Samantha')
    ) || voices[0];
    
    if (preferredVoice) {
        utterance.voice = preferredVoice;
    }

    utterance.onstart = () => {
        state.isSpeaking = true;
        updateSpeakingIndicator(true);
    };

    utterance.onend = () => {
        state.isSpeaking = false;
        updateSpeakingIndicator(false);
        // Auto-restart listening if in voice mode
        if (state.voiceMode && !state.isListening) {
            setTimeout(() => startListening(), 500);
        }
    };

    utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event);
        state.isSpeaking = false;
        updateSpeakingIndicator(false);
    };

    state.synthesis.speak(utterance);
}

/* ---------- UI UPDATES ------------------------------------ */
function updateMicrophoneState() {
    const micButton = document.getElementById('micButton');
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
    const indicator = document.getElementById('speakingIndicator');
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
    let controls = document.getElementById('voiceControls');
    if (!controls) {
        controls = document.createElement('div');
        controls.id = 'voiceControls';
        controls.className = 'voice-controls';
        controls.innerHTML = `
            <div class="voice-status">
                <div id="speakingIndicator" class="speaking-indicator"></div>
            </div>
            <button id="micButton" class="mic-button">
                <span class="mic-icon">🎙️</span>
                <span class="mic-label">Push to Talk</span>
            </button>
        `;
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
    const controls = document.getElementById('voiceControls');
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
        state.synthesis.cancel();
        state.isSpeaking = false;
        updateSpeakingIndicator(false);
        return;
    }

    if (state.isListening) {
        state.recognition.stop();
    } else {
        startListening();
    }
}

/* ---------- COMMANDS ---------------------------------------- */
const commands = {
    "ascent(k2)": {
        execute: () => {
            state.inChatMode  = true;
            state.voiceMode   = false;
            state.chatHistory = [{ role: "system", content: state.systemPrompt }];
            hideVoiceControls();
            addOutput("K2 chat mode activated (Groq — moonshotai/kimi-k2-instruct-0905).");
            addOutput("Aurestral: Ready when you are, sir.");
            commandInput.placeholder = "Chat with Aurestral… (type `descent` to exit)";
            return "";
        }
    },

    "ascent(k2, audio)": {
        execute: () => {
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
            setTimeout(() => startListening(), 1000);
            return "";
        }
    },

    "descent": {
        execute: () => exitChatMode()
    },

    "edit(k2/system_prompt =": {
        execute: (full) => {
            const match = full.match(/system_prompt\s*=\s*["'](.+)["']\s*\)$/i);
            if (!match) return 'Error: syntax is  edit(K2/system_prompt = "your prompt here")';

            state.systemPrompt = match[1];

            if (state.inChatMode && state.chatHistory.length > 0 && state.chatHistory[0].role === "system") {
                state.chatHistory[0].content = state.systemPrompt;
            }

            return `System prompt updated.`;
        }
    }
};

/* ---------- EXIT CHAT --------------------------------------- */
function exitChatMode() {
    // Stop any ongoing speech
    if (state.isSpeaking) {
        state.synthesis.cancel();
        state.isSpeaking = false;
    }

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
const terminal     = document.getElementById("terminal");
const commandInput = document.getElementById("commandInput");

/* ---------- OUTPUT ------------------------------------------ */
function addOutput(text, className = "") {
    const line = document.createElement("div");
    line.className = `output-line ${className}`;
    
    if (Array.isArray(text)) {
        text.forEach(t => {
            const m       = document.createElement("div");
            m.className   = "module";
            m.textContent = t;
            line.appendChild(m);
        });
    } else {
        // Check if this is an Aurestral response (for markdown/latex rendering)
        if (text.startsWith("Aurestral: ") && (text.includes('$') || text.includes('**') || text.includes('`'))) {
            const prefix = "Aurestral: ";
            const content = text.substring(prefix.length);
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

    addOutput(`You: ${userInput}`);
    state.chatHistory.push({ role: "user", content: userInput });

    const payload = {
        model:       MODEL,
        messages:    state.chatHistory,
        max_tokens:  2048,
        temperature: 0.7,
        stream:      true
    };

    let response;
    try {
        response = await fetch(PROXY_URL, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(payload)
        });
    } catch (e) {
        addOutput(`Network error: ${e.message}`, "error");
        return;
    }

    if (!response.ok) {
        const txt = await response.text();
        addOutput(`API error (${response.status}): ${txt}`, "error");
        return;
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let full      = "";
    
    // Create initial output line
    const responseLine = document.createElement("div");
    responseLine.className = "output-line";
    responseLine.innerHTML = "Aurestral: ";
    terminal.appendChild(responseLine);

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter(l => l.startsWith("data: "));
        
        for (const line of lines) {
            if (line === "data: [DONE]") break;
            try {
                const data    = JSON.parse(line.slice(6));
                const content = data.choices?.[0]?.delta?.content || "";
                if (content) {
                    full += content;
                    // Update with rendered markdown/latex
                    responseLine.innerHTML = "Aurestral: " + renderMarkdownWithLatex(full);
                    terminal.scrollTop = terminal.scrollHeight;
                }
            } catch (_) {}
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
    const input = raw.trim().toLowerCase();
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

function processCommand(lower, original = lower) {
    addOutput(`>>> ${original}`);

    for (const [key, cmd] of Object.entries(commands)) {
        if (lower.startsWith(key.toLowerCase())) {
            const result = cmd.execute(original);
            if (result !== undefined && result !== "") {
                addOutput(result, result.startsWith("Error") ? "error" : "success");
            }
            return;
        }
    }
    addOutput("Command not recognized", "error");
}

/* ---------- EVENT LISTENERS -------------------------------- */
commandInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
        const val = commandInput.value.trim();
        if (val) {
            processInput(val);
            commandInput.value = "";
        }
    }
});

window.addEventListener("load", () => {
    commandInput.focus();
    
    // Load voices for speech synthesis
    if ('speechSynthesis' in window) {
        speechSynthesis.addEventListener('voiceschanged', () => {
            const voices = speechSynthesis.getVoices();
            console.log('Available voices:', voices.map(v => v.name));
        });
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
