/* ---------- STATE ------------------------------------------- */
const state = {
    inChatMode: false,
    chatHistory: []
};

/* ---------- API CONFIG -------------------------------------- */
const API_BASE = "https://api.groq.com/openai/v1";
const MODEL    = "moonshotai/kimi-k2-instruct-0905";

function getHeaders() {
    if (!GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY is empty. Add your key at the top of script.js.");
    }
    return {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type":  "application/json"
    };
}

/* ---------- SYSTEM PROMPT ----------------------------------- */
const SYSTEM_PROMPT = `You are Aurestral, a AI assistant created by the Aurestral.Console (website: aurestral.carrd.co). Your goal is to chat with and help the user.`;

/* ---------- COMMANDS ---------------------------------------- */
const commands = {
    "ascent(k2)": {
        execute: () => {
            state.inChatMode  = true;
            state.chatHistory = [{ role: "system", content: SYSTEM_PROMPT }];
            addOutput("K2 chat mode activated (Groq – moonshotai/kimi-k2-instruct-0905).");
            addOutput("Aurestral: Ready when you are, sir.");
            commandInput.placeholder = "Chat with Aurestral… (type `descent` to exit)";
            return "";
        }
    },

    "descent": {
        execute: () => exitChatMode()
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

/* ---------- STREAM CHAT (Groq) ---------------------------- */
async function streamChat(userInput) {
    if (!userInput.trim()) return;

    addOutput(`You: ${userInput}`);
    state.chatHistory.push({ role: "user", content: userInput });

    const payload = {
        model:      MODEL,
        messages:   state.chatHistory,
        max_tokens: 2048,
        temperature: 0.7,
        stream:     true
    };

    let response;
    try {
        response = await fetch(`${API_BASE}/chat/completions`, {
            method:  "POST",
            headers: getHeaders(),
            body:    JSON.stringify(payload)
        });
    } catch (e) {
        addOutput(`Network error: ${e.message}`, "error");
        return;
    }

    if (!response.ok) {
        const txt = await response.text();
        addOutput(`API error: ${txt}`, "error");
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
        // while in chat, only "descent" is treated as a command
        if (input === "descent") processCommand(input, raw);
        else                     streamChat(raw);
    } else {
        processCommand(input, raw);
    }
}

function processCommand(lower, original = lower) {
    addOutput(`>>> ${original}`);

    const cmd = commands[lower];
    if (cmd) {
        const result = cmd.execute(original);
        if (result !== undefined && result !== "") {
            addOutput(result, (result.includes("Error") || result.includes("not found")) ? "error" : "success");
        }
    } else {
        addOutput("Command not recognized", "error");
    }
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

    if (!GROQ_API_KEY) {
        addOutput('<span style="color:#ff9800">GROQ_API_KEY is empty — add your key at the top of script.js before starting.</span>');
    }
});
