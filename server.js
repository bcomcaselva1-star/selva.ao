require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// GROQ - FOR CHAT
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// CHAT ENDPOINT
app.post('/api/chat', async (req, res) => {
  try {
    const msg = req.body.message || req.body.prompt || "hi";
    const chat = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: msg }]
    });
    res.json({ reply: chat.choices[0].message.content });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// HUGGING FACE - FOR IMAGE
app.post('/api/generate-image', async (req, res) => {
  try {
    const prompt = req.body.prompt || req.body.text || req.body.message || "a beautiful dog";
    const HF_KEY = process.env.HF_API_KEY;

    if (!HF_KEY) {
      return res.json({ error: "Add HF_API_KEY to your .env file." });
    }

    const response = await fetch(
      "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${HF_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ inputs: prompt })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return res.json({ error: err });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
    return res.json({ image: base64, url: base64 });
  } catch (e) {
    return res.json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`SELVA.AI CREATIVE STUDIO LIVE at http://localhost:${PORT}`);
});
