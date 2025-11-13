/* ==============================================================
   Aurestral Console – Netlify / static-hosting version
   ============================================================== */

const state = {
    ascentExecuted: false,
    inChatMode: false,
    currentSession: null,
    chatHistory: [],
    sessions: {}
};

/* ---------- CONFIG (localStorage) --------------------------- */
const STORAGE_KEY = 'aurestral_config';
let config = {
    provider: 'groq',               // default – user can change
    groqApiKey: '',
    model: 'gpt-oss-120b'           // forced for Groq
};

function loadConfig() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) Object.assign(config, JSON.parse(saved));
}
function saveConfig() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
loadConfig();

/* ---------- API HELPERS ------------------------------------- */
const API_BASE = config.provider === 'groq'
    ? 'https://api.groq.com/openai/v1'
    : 'https://api.openai.com/v1';

function getHeaders() {
    if (config.provider === 'groq' && !config.groqApiKey) {
        throw new Error('Groq API key not set. Use: aurestral.console(edit, GROQ_API_KEY = "your-key")');
    }
    return {
        'Authorization': `Bearer ${config.groqApiKey || ''}`,
        'Content-Type': 'application/json'
    };
}

/* ---------- SYSTEM PROMPT ----------------------------------- */
const SYSTEM_PROMPT = `You are Aurestral, a super intelligent AI assistant made by the Aurestral Console (aurestral.console).
Speak like JARVIS from Iron Man: witty, concise, a touch of dry humor, always helpful.
No need to repeat previously answered questions or greetings, just once and when question changes don't mention previous question unless asked to elaborate on the previous response.
Always explain your reasoning clearly, think step-by-step.
If unsure, just say “I'm not sure of the response to your query."`;

/* ---------- COMMANDS ---------------------------------------- */
const commands = {
    "aurestral.console(ascent)": {
        execute: () => { state.ascentExecuted = true; return "0"; },
        requiresAscent: false
    },

    /* ---------- NEW: AEM1X120B (Groq + gpt-oss-120b) ---------- */
    "aurestral.console(ascent, aem1x120b)": {
        execute: () => {
            state.ascentExecuted = true;
            state.inChatMode = true;
            state.chatHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
            addOutput("**AEM1X120B** chat mode (Groq – gpt-oss-120b) activated.");
            addOutput("Aurestral: Ready when you are, sir.");
            commandInput.placeholder = "Chat with Aurestral… (type `descent` to exit)";
            return "";
        },
        requiresAscent: false
    },

    "aurestral.console(ascent, 7-9)": {
        execute: () => {
            state.ascentExecuted = true;
            state.inChatMode = true;
            state.chatHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
            addOutput("Entering Aurestral Chat Mode. Type 'aurestral.console(descent, 7-9)' to exit.");
            addOutput("Aurestral: Ready when you are, sir.");
            commandInput.placeholder = "Chat with Aurestral... (or 'descent' to exit)";
            return "";
        },
        requiresAscent: false
    },

    "aurestral.console(descent, 7-9)": { execute: () => exitChatMode() },
    "aurestral.console(descent, aem1x120b)": { execute: () => exitChatMode() },

    "aurestral.console(display.modules)": {
        execute: () => ["AM1X1D", "AM10X2D", "7-9", "AEM1X120B"],
        requiresAscent: true
    },

    /* ---------- EDIT API KEY --------------------------------- */
    "aurestral.console(edit, groq_api_key = \"": {
        execute: (full) => {
            const match = full.match(/groq_api_key\s*=\s*["']([^"']+)["']/i);
            if (!match) return "Syntax: aurestral.console(edit, GROQ_API_KEY = \"your-key\")";
            config.groqApiKey = match[1].trim();
            config.provider = 'groq';
            saveConfig();
            return `Groq API key saved (${config.groqApiKey.slice(0,8)}…).
Use **aurestral.console(ascent, aem1x120b)** to start chatting with gpt-oss-120b.`;
        },
        requiresAscent: false
    },

    /* ---------- LOG, SESSION, DELETE (unchanged) ------------ */
    "aurestral.console(log, %history%)": {
        execute: () => {
            loadSessions();
            if (!Object.keys(state.sessions).length) return "No chat sessions found.";
            return Object.entries(state.sessions).map(([id, s]) => `${id}: ${new Date(s.timestamp).toLocaleString()}`);
        },
        requiresAscent: false
    },
    "aurestral.console(session, c)": {
        execute: (full) => {
            const id = full.match(/session,\s*(c\d+)/i)?.[1];
            if (!id) return "Error: specify session, e.g. aurestral.console(session, c1)";
            loadSessions();
            if (!state.sessions[id]) return `Session ${id} not found.`;
            state.currentSession = id;
            state.chatHistory = state.sessions[id].messages;
            addOutput(`Loaded session ${id}.`);
            if (!state.inChatMode) {
                state.inChatMode = true;
                commandInput.placeholder = "Chat with Aurestral… (or 'descent' to exit)";
            }
            return "";
        },
        requiresAscent: false
    },
    "aurestral.console(delete/session, c)": {
        execute: (full) => {
            const id = full.match(/delete\/session,\s*(c\d+)/i)?.[1];
            if (!id) return "Error: specify session, e.g. aurestral.console(delete/session, c1)";
            loadSessions();
            if (!state.sessions[id]) return `Session ${id} not found.`;
            delete state.sessions[id];
            saveSessions();
            if (state.currentSession === id) {
                state.currentSession = null;
                state.chatHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
            }
            return `Deleted session ${id}.`;
        },
        requiresAscent: false
    }
};

/* ---------- SESSION STORAGE --------------------------------- */
function loadSessions() { state.sessions = JSON.parse(localStorage.getItem('aurestral_sessions') || '{}'); }
function saveSessions() { localStorage.setItem('aurestral_sessions', JSON.stringify(state.sessions)); }
function saveSession() {
    if (!state.currentSession || state.chatHistory.length <= 1) return;
    state.sessions[state.currentSession] = {
        messages: state.chatHistory,
        timestamp: new Date().toISOString()
    };
    saveSessions();
}

/* ---------- EXIT CHAT --------------------------------------- */
function exitChatMode() {
    if (state.currentSession) saveSession();
    state.inChatMode = false;
    state.currentSession = null;
    state.chatHistory = [];
    commandInput.placeholder = "Enter command...";
    addOutput("Exiting Chat Mode.");
}

/* ---------- DOM --------------------------------------------- */
const terminal    = document.getElementById('terminal');
const commandInput = document.getElementById('commandInput');

/* ---------- OUTPUT ------------------------------------------ */
function addOutput(text, className = '') {
    const line = document.createElement('div');
    line.className = `output-line ${className}`;
    if (Array.isArray(text)) {
        text.forEach(t => {
            const m = document.createElement('div');
            m.className = 'module';
            m.textContent = t;
            line.appendChild(m);
        });
    } else {
        line.innerHTML = text.replace(/\n/g, '<br>');
    }
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

/* ---------- STREAM CHAT (Groq / OpenAI) -------------------- */
async function streamChat(userInput) {
    if (!userInput.trim()) return;

    addOutput(`You: ${userInput}`);
    state.chatHistory.push({ role: 'user', content: userInput });

    const payload = {
        model: config.model,
        messages: state.chatHistory,
        max_tokens: 2048,
        temperature: 0.7,
        stream: true
    };

    let response;
    try {
        response = await fetch(`${API_BASE}/chat/completions`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
    } catch (e) {
        addOutput(`Network error: ${e.message}`, 'error');
        return;
    }

    if (!response.ok) {
        const txt = await response.text();
        addOutput(`API error: ${txt}`, 'error');
        return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    addOutput('Aurestral: ', '');

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
        for (const line of lines) {
            if (line === 'data: [DONE]') break;
            try {
                const data = JSON.parse(line.slice(6));
                const content = data.choices?.[0]?.delta?.content || '';
                if (content) {
                    full += content;
                    const last = terminal.lastElementChild;
                    if (last && last.textContent.startsWith('Aurestral: ')) {
                        last.innerHTML += content.replace(/\n/g, '<br>');
                    }
                    terminal.scrollTop = terminal.scrollHeight;
                }
            } catch (_) {}
        }
    }

    state.chatHistory.push({ role: 'assistant', content: full });
    saveSession();
}

/* ---------- INPUT PROCESSING ------------------------------- */
function processInput(raw) {
    const input = raw.trim().toLowerCase();
    if (state.inChatMode) {
        if (input.startsWith('aurestral.console(')) processCommand(input, raw);
        else streamChat(raw);
    } else {
        processCommand(input, raw);
    }
}

function processCommand(lower, original = lower) {
    addOutput(`>>> ${original}`);

    let executed = false;
    for (const [key, cmd] of Object.entries(commands)) {
        if (lower.startsWith(key.toLowerCase())) {
            if (cmd.requiresAscent && !state.ascentExecuted) {
                addOutput("1", "error");
                return;
            }
            const result = typeof cmd.execute === 'function' ? cmd.execute(original) : cmd.execute;
            if (result !== undefined) addOutput(result, result.includes('Error') || result.includes('not found') ? 'error' : 'success');
            executed = true;
            break;
        }
    }
    if (!executed) addOutput("Command not recognized", "error");
}

/* ---------- EVENT LISTENERS -------------------------------- */
commandInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        const val = commandInput.value.trim();
        if (val) {
            processInput(val);
            commandInput.value = '';
        }
    }
});

window.addEventListener('load', () => {
    loadSessions();
    commandInput.focus();

    // Show welcome message with key hint if none saved
    if (!config.groqApiKey) {
        addOutput(`
<span style="color:#ff9800">Welcome! To use Groq (gpt-oss-120b) run:</span><br>
<span style="color:#d4af37">aurestral.console(edit, GROQ_API_KEY = "gsk_…")</span>
        `.trim(), '');
    }
});