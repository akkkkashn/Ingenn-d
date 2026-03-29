require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const Anthropic = require("@anthropic-ai/sdk").default;
const path = require("path");

const app = express();
app.use(express.json());

// --- Database ---
const dataDir = process.env.DATA_DIR || __dirname;
const db = new Database(path.join(dataDir, "data.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS phrases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    phrase TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, phrase)
  );
  CREATE TABLE IF NOT EXISTS mistakes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    original TEXT NOT NULL,
    corrected TEXT NOT NULL,
    explanation TEXT,
    count INTEGER DEFAULT 1,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, original, corrected)
  );
`);

// --- Session ---
app.use(
  session({
    store: new SQLiteStore({ db: "sessions.db", dir: dataDir }),
    secret: process.env.SESSION_SECRET || "svenska-tranaren-secret-key-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: "lax" },
  })
);

app.use(express.static(path.join(__dirname, "public")));

// --- Auth middleware ---
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  next();
}

// --- Auth routes ---
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  if (username.length < 2) return res.status(400).json({ error: "Username must be at least 2 characters" });
  if (password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return res.status(409).json({ error: "Username already taken" });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)").run(username, hash);
  req.session.userId = result.lastInsertRowid;
  req.session.username = username;
  res.json({ username });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  req.session.userId = user.id;
  req.session.username = username;
  res.json({ username });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, username: req.session.username });
});

// --- Progress routes ---
app.get("/api/progress", requireAuth, (req, res) => {
  const phrases = db.prepare("SELECT phrase, created_at FROM phrases WHERE user_id = ? ORDER BY created_at DESC").all(req.session.userId);
  const mistakes = db.prepare("SELECT original, corrected, explanation, count, last_seen FROM mistakes WHERE user_id = ? ORDER BY count DESC").all(req.session.userId);
  res.json({ phrases, mistakes });
});

app.post("/api/progress/phrases", requireAuth, (req, res) => {
  const { phrases } = req.body;
  if (!phrases || !Array.isArray(phrases)) return res.json({ ok: true });
  const stmt = db.prepare("INSERT OR IGNORE INTO phrases (user_id, phrase) VALUES (?, ?)");
  for (const p of phrases) stmt.run(req.session.userId, p);
  res.json({ ok: true });
});

app.post("/api/progress/mistakes", requireAuth, (req, res) => {
  const { mistakes } = req.body;
  if (!mistakes || !Array.isArray(mistakes)) return res.json({ ok: true });
  const stmt = db.prepare(`
    INSERT INTO mistakes (user_id, original, corrected, explanation, count)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(user_id, original, corrected) DO UPDATE SET
      count = count + 1,
      explanation = excluded.explanation,
      last_seen = CURRENT_TIMESTAMP
  `);
  for (const m of mistakes) stmt.run(req.session.userId, m.original, m.corrected, m.explanation || "");
  res.json({ ok: true });
});

app.delete("/api/progress/phrases", requireAuth, (req, res) => {
  db.prepare("DELETE FROM phrases WHERE user_id = ?").run(req.session.userId);
  res.json({ ok: true });
});

app.delete("/api/progress/mistakes", requireAuth, (req, res) => {
  db.prepare("DELETE FROM mistakes WHERE user_id = ?").run(req.session.userId);
  res.json({ ok: true });
});

// --- Phrase of the Day ---
db.exec(`
  CREATE TABLE IF NOT EXISTS phrase_of_day (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    phrase TEXT NOT NULL,
    pronunciation TEXT,
    literal TEXT,
    meaning TEXT,
    context TEXT,
    example_swedish TEXT,
    example_english TEXT,
    difficulty TEXT
  );
`);

// --- Anthropic ---
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

Provide natural, idiomatic Swedish. The breakdown should help the user understand Swedish sentence structure.`,

  "translate": `You are a Swedish-English translator. Translate the user's text between Swedish and English. Auto-detect the language.

Reply in this exact JSON format:
{
  "detected_language": "swedish" | "english",
  "translation": "<the translated text>",
  "literal": "<a more literal/word-for-word translation to show structure>",
  "notes": "<any brief notes about idioms, formality, or nuance (optional, can be empty string)>"
}

Be accurate and natural. If the input is Swedish, translate to English. If English, translate to Swedish.`
};

// --- Phrase of the Day endpoint ---
app.get("/api/phrase-of-day", async (req, res) => {
  const today = new Date().toISOString().split("T")[0];

  const cached = db.prepare("SELECT * FROM phrase_of_day WHERE date = ?").get(today);
  if (cached) return res.json(cached);

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      system: `You are a Swedish language expert. Generate a "phrase of the day" — a commonly used Swedish phrase, idiom, or expression that would be very useful in daily life. Pick something that intermediate learners would find challenging but rewarding. Vary between idioms, colloquial expressions, formal phrases, and everyday sayings.

Reply in this exact JSON format:
{
  "phrase": "<the Swedish phrase>",
  "pronunciation": "<approximate pronunciation guide>",
  "literal": "<literal word-for-word translation>",
  "meaning": "<what it actually means in English>",
  "context": "<when and how Swedes use this — 2-3 sentences>",
  "example_swedish": "<an example sentence using the phrase>",
  "example_english": "<English translation of the example>",
  "difficulty": "intermediate" | "advanced"
}`,
      messages: [{ role: "user", content: `Generate a Swedish phrase of the day for ${today}. Make it a genuinely useful, commonly heard phrase.` }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    const data = JSON.parse(jsonMatch[1].trim());

    db.prepare(`INSERT OR REPLACE INTO phrase_of_day (date, phrase, pronunciation, literal, meaning, context, example_swedish, example_english, difficulty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      today, data.phrase, data.pronunciation, data.literal, data.meaning,
      data.context, data.example_swedish, data.example_english, data.difficulty
    );

    res.json({ date: today, ...data });
  } catch (err) {
    console.error("Phrase of day error:", err.message);
    res.status(500).json({ error: "Failed to generate phrase", detail: err.message });
  }
});

// --- Daily Report endpoint ---
app.get("/api/report", requireAuth, async (req, res) => {
  const phrases = db.prepare("SELECT phrase, created_at FROM phrases WHERE user_id = ? ORDER BY created_at DESC").all(req.session.userId);
  const mistakes = db.prepare("SELECT original, corrected, explanation, count, last_seen FROM mistakes WHERE user_id = ? ORDER BY count DESC").all(req.session.userId);
  const today = new Date().toISOString().split("T")[0];
  const potd = db.prepare("SELECT * FROM phrase_of_day WHERE date = ?").get(today);

  if (mistakes.length === 0 && phrases.length === 0) {
    return res.json({ report: null, message: "No data yet — start practicing first!" });
  }

  const mistakesSummary = mistakes.slice(0, 15).map((m) => `"${m.original}" → "${m.corrected}" (${m.count}x): ${m.explanation}`).join("\n");
  const phrasesSummary = phrases.slice(0, 20).map((p) => p.phrase).join(", ");

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: `You are a Swedish language tutor writing a concise daily progress report for a student. The report should be printable on one page (front only). Be direct and useful — no fluff.

Reply in this exact JSON format:
{
  "date": "${today}",
  "summary_en": "<2-3 sentence overview of their progress and level in English>",
  "summary_sv": "<same summary translated to Swedish>",
  "top_mistakes": [
    {"pattern": "<the grammatical/vocabulary pattern they keep getting wrong>", "explanation_en": "<clear explanation in English>", "explanation_sv": "<same explanation in Swedish>", "tip": "<one practical tip to fix it>"}
  ],
  "macro_analysis_en": "<1-2 paragraphs: what fundamental areas they struggle with on a macro level — e.g. word order, en/ett system, verb tenses, prepositions. Be specific about WHAT they're getting wrong and WHY>",
  "macro_analysis_sv": "<same macro analysis in Swedish>",
  "focus_areas": ["<3-5 specific things they should practice today>"],
  "encouragement": "<one encouraging sentence about their progress>"
}

Keep top_mistakes to max 5 entries. Focus on patterns, not individual errors.`,
      messages: [{
        role: "user",
        content: `Here are my mistakes (most frequent first):\n${mistakesSummary}\n\nPhrases I've learned:\n${phrasesSummary}\n\nGenerate my daily report.`
      }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    const report = JSON.parse(jsonMatch[1].trim());

    report.phrase_of_day = potd || null;
    report.total_phrases = phrases.length;
    report.total_mistakes = mistakes.length;
    report.username = req.session.username;

    res.json({ report });
  } catch (err) {
    console.error("Report error:", err.message);
    res.status(500).json({ error: "Failed to generate report", detail: err.message });
  }
});

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
