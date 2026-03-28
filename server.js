require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk").default;
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPTS = {
  "situation-respond": `You are a Swedish language tutor. The user will be given a situation described in English, and they must respond in Swedish as if they were in that situation.

Evaluate their Swedish response. Reply in this exact JSON format:
{
  "rating": "great" | "good" | "needs_work",
  "corrected": "<their text with corrections, or same text if perfect>",
  "mistakes": [{"original": "...", "corrected": "...", "explanation": "..."}],
  "feedback": "<brief encouraging feedback in English>",
  "natural_version": "<how a native Swede would say it>",
  "stolen_phrases": ["<useful Swedish phrases from the natural version worth memorizing>"]
}

Be encouraging but honest. Explain grammar/vocabulary issues clearly. Always provide a natural Swedish version even if theirs was correct — show idiomatic alternatives.`,

  "correct-me": `You are a Swedish language tutor. The user will write something in Swedish (possibly with mistakes). Your job is to correct their Swedish and teach them.

Reply in this exact JSON format:
{
  "rating": "great" | "good" | "needs_work",
  "corrected": "<their text fully corrected>",
  "mistakes": [{"original": "...", "corrected": "...", "explanation": "..."}],
  "feedback": "<brief encouraging feedback in English>",
  "natural_version": "<a more idiomatic/native way to express the same thing>",
  "stolen_phrases": ["<useful Swedish phrases worth memorizing from the corrections>"]
}

Be encouraging but thorough. Catch all errors: grammar, word order, vocabulary, spelling, gender (en/ett), verb conjugation, etc.`,

  "conversation": `You are a friendly Swedish conversation partner. Continue the conversation naturally in Swedish, but also help the user learn.

The user messages are in Swedish. Reply in this exact JSON format:
{
  "reply_swedish": "<your conversational reply in Swedish>",
  "reply_english": "<English translation of your reply>",
  "corrections": [{"original": "...", "corrected": "...", "explanation": "..."}],
  "feedback": "<brief note on their Swedish, if any issues>",
  "stolen_phrases": ["<useful phrases from YOUR reply that the user should learn>"]
}

Keep the conversation going naturally. Gently correct mistakes but don't let corrections dominate — prioritize the flow of conversation. Match the user's level.`,

  "rewrite": `You are a Swedish language tutor. The user will provide a sentence or paragraph in English that they want to express in Swedish. Help them learn by providing the translation with educational context.

Reply in this exact JSON format:
{
  "swedish": "<the text translated to Swedish>",
  "literal_breakdown": "<word-by-word breakdown showing structure>",
  "grammar_notes": ["<key grammar points illustrated by this text>"],
  "alternatives": ["<other valid ways to say the same thing>"],
  "stolen_phrases": ["<useful phrases from this translation worth memorizing>"]
}

Provide natural, idiomatic Swedish. The breakdown should help the user understand Swedish sentence structure.`
};

app.post("/api/chat", async (req, res) => {
  const { mode, messages } = req.body;

  const systemPrompt = SYSTEM_PROMPTS[mode];
  if (!systemPrompt) {
    return res.status(400).json({ error: "Invalid mode" });
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: systemPrompt,
      messages: messages,
    });

    const text = response.content[0].text;

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[1].trim());
    } catch {
      parsed = { raw: text };
    }

    res.json(parsed);
  } catch (err) {
    console.error("Anthropic API error:", err.message);
    res.status(500).json({ error: "API request failed", detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
