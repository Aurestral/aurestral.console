/* ==============================================================
   Aurestral Console – Netlify / static-hosting version
   ============================================================== */

/* ---------- STATE ------------------------------------------- */
const DEFAULT_SYSTEM_PROMPT = `You are Aurestral, a helpful assistant made by the Aurestral.Console.`;

const state = {
    inChatMode:   false,
    chatHistory:  [],
    systemPrompt: DEFAULT_SYSTEM_PROMPT
};

/* ---------- CONFIG ------------------------------------------ */
const PROXY_URL = "/.netlify/functions/groq-proxy";
const MODEL     = "moonshotai/kimi-k2-instruct-0905";

/* ---------- COMMANDS ---------------------------------------- */
const commands = {
    "ascent(k2)": {
        execute: () => {
            state.inChatMode  = true;
            state.chatHistory = [{ role: "system", content: state.systemPrompt }];
            addOutput("K2 chat mode activated (Groq – moonshotai/kimi-k2-instruct-0905).");
            addOutput("Aurestral: Ready when you are, sir.");
            commandInput.placeholder = "Chat with Aurestral… (type `descent` to exit)";
            return "";
        }
    },

    "descent": {
        execute: () => exitChatMode()
    },

    /* prefix-matched — payload is extracted inside execute */
    "edit(k2/system_prompt =": {
        execute: (full) => {
            const match = full.match(/system_prompt\s*=\s*["'](.+)["']\s*\)$/i);
            if (!match) return 'Error: syntax is  edit(K2/system_prompt = "your prompt here")';

            state.systemPrompt = match[1];

            // If already in chat mode, swap the system message in the live history
            if (state.inChatMode && state.chatHistory.length > 0 && state.chatHistory[0].role === "system") {
                state.chatHistory[0].content = state.systemPrompt;
            }

            return `System prompt updated.`;
        }
    }
};

/* ---------- EXIT CHAT --------------------------------------- */
function exitChatMode() {
    state.inChatMode  = false;
    state.chatHistory = [];
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
        line.innerHTML = text.replace(/\n/g, "<br>");
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
    addOutput("Aurestral: ", "");

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
                    const last = terminal.lastElementChild;
                    if (last && last.textContent.startsWith("Aurestral: ")) {
                        last.innerHTML += content.replace(/\n/g, "<br>");
                    }
                    terminal.scrollTop = terminal.scrollHeight;
                }
            } catch (_) {}
        }
    }

    state.chatHistory.push({ role: "assistant", content: full });
}

/* ---------- INPUT PROCESSING ------------------------------- */
function processInput(raw) {
    const input = raw.trim().toLowerCase();
    if (state.inChatMode) {
        if (input === "descent" || input.startsWith("edit(")) processCommand(input, raw);
        else                                                    streamChat(raw);
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
});
