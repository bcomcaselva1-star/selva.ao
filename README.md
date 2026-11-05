# selva.ai

Professional search workspace: local index + web lookup + live Gemini answers.

This is a real Node server. It does **not** use a static answer list, fake “3 crore tokens,” or dummy `anthropic.com` URLs.

## Run it

```bash
cd C:\Users\acer\selva-ai
npm install
copy .env.example .env
```

Put your Gemini key in `.env`:

```
PORT=3000
GEMINI_API_KEY=your_real_key
GEMINI_MODEL=gemini-2.0-flash
```

Get a key at [Google AI Studio](https://aistudio.google.com/apikey).

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000). Type a question in **Search chats & search index...** and press Enter.

Without a key, workspace documents and Wikipedia/DuckDuckGo still return results. Full ChatGPT-style answers need `GEMINI_API_KEY`.

## What the search bar does

1. Matches your workspace documents (Next.js, Supabase, SaaS notes, telemetry kit).
2. Looks up Wikipedia and DuckDuckGo.
3. Streams a Gemini answer that uses those sources.
4. If you ask for a **picture / photo / image**, it returns a generated still.

Telemetry numbers (latency, throughput, token estimate) come from the live request, not a random marketing script.
