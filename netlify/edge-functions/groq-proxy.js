/* ==============================================================
   Netlify Edge Function – Groq Streaming Proxy
   Deploy path: netlify/edge-functions/groq-proxy.js
   Callable at: /.netlify/functions/groq-proxy
   ============================================================== */

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export default async function groqProxy(request, context) {
    /* ----- only POST allowed ----- */
    if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    /* ----- key check ----- */
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    if (!GROQ_API_KEY) {
        return new Response("GROQ_API_KEY environment variable is not set.", { status: 500 });
    }

    /* ----- parse & validate body ----- */
    let body;
    try {
        body = await request.json();
    } catch (_) {
        return new Response("Invalid JSON body.", { status: 400 });
    }

    /* ----- forward to Groq ----- */
    let groqResponse;
    try {
        groqResponse = await fetch(GROQ_API_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type":  "application/json"
            },
            body: JSON.stringify(body)
        });
    } catch (e) {
        return new Response(`Upstream fetch failed: ${e.message}`, { status: 502 });
    }

    /* ----- pipe the stream straight back to the browser ----- */
    return new Response(groqResponse.body, {
        status: groqResponse.status,
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache"
        }
    });
}
