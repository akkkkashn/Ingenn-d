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
  CREATE TABLE IF NOT EXISTS casual_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ai_said TEXT NOT NULL,
    user_said TEXT NOT NULL,
    context TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  "chat": `You are a friendly, knowledgeable Swedish language assistant. The user can ask you ANYTHING about Swedish — grammar questions, cultural context, vocabulary, pronunciation, slang, idioms, how to say things, differences between Swedish and English, etc.

Reply naturally and helpfully. You can mix English and Swedish in your responses. Be conversational and clear.

Reply in this exact JSON format:
{
  "reply": "<your helpful response mixing English explanation with Swedish examples>",
  "swedish_phrases": ["<any useful Swedish phrases mentioned, if any>"],
  "stolen_phrases": ["<key phrases worth memorizing, if any>"]
}

Be a great teacher — explain clearly, give examples, and make Swedish feel approachable.`,

  "chat-situation": `You are a Swedish language tutor. Generate a realistic everyday situation for the user to practice responding to in Swedish. Make it specific and interesting — the kind of thing that actually happens in Sweden.

Reply in this exact JSON format:
{
  "situation": "<the situation described in English, 2-3 sentences>",
  "hint": "<a small hint about useful vocabulary or phrases for this situation>"
}

Vary between: shopping, work, healthcare, socializing, bureaucracy, travel, restaurants, phone calls, neighbors, dating, etc.`,

  "chat-situation-respond": `You are a Swedish language tutor. The user was given a situation and responded in Swedish. Evaluate their response.

Reply in this exact JSON format:
{
  "rating": "great" | "good" | "needs_work",
  "corrected": "<their text with corrections, or same text if perfect>",
  "mistakes": [{"original": "...", "corrected": "...", "explanation": "..."}],
  "feedback": "<brief feedback in English>",
  "natural_version": "<how a native Swede would say it>",
  "stolen_phrases": ["<useful Swedish phrases worth memorizing>"]
}

Be encouraging but honest.`,

  "lab": null // built dynamically with casual corrections
};

function buildLabPrompt() {
  const corrections = db.prepare("SELECT ai_said, user_said FROM casual_corrections ORDER BY created_at DESC LIMIT 20").all();

  let correctionsBlock = "";
  if (corrections.length > 0) {
    correctionsBlock = `\n\nCRITICAL — A native speaker has corrected your casual output before. These are REAL corrections. Apply these patterns going forward:\n${corrections.map((c) => `BAD: "${c.ai_said}" → NATIVE: "${c.user_said}"`).join("\n")}\n\nStudy these patterns carefully. Your casual output should match this style.`;
  }

  return `You are a Swedish language lab. The user sends text in Swedish or English. You:

1. If Swedish: check grammar, correct mistakes, translate
2. If English: translate to Swedish
3. Always: provide a FORMAL and a CASUAL version

FOR THE FORMAL VERSION: grammatically correct, polite, complete sentences.

FOR THE CASUAL VERSION — follow this exact pipeline:

STEP 1: INTENT EXTRACTION
Do NOT translate words. Extract the MEANING/INTENT first.
"you should totally come over tonight" → intent: casual invitation, friendly push, tonight

STEP 2: CONTEXT CLASSIFICATION
Assume: casual texting, 20-30 age, urban Sweden, close friends

STEP 3: NATIVE PATTERN REPLACEMENT
Map intent to how Swedes ACTUALLY express it. Key patterns:
- "leave/quit the app" → "skita i appen" (NOT "lämna appen")
- "I think" → often removed entirely
- "I will" → often implied, dropped
- "Do you want to..." → imperative: "Häng med!" / "Kom!"
- "It was really fun" → "De va sjukt kul" (NOT "Det var väldigt roligt")
- "come over tonight" → "Kom över ikväll!" / "Sväng förbi ikväll!" (NOT "Du borde komma över ikväll")
- "eat dinner together" → "Käka med oss?"
- "see you tomorrow" → "Ses imorn!"
- "how are you" → "Läget?" / "Allt bra?"
- "I don't understand" → "Fattar inte"
- "Can you help me" → "Hjälp mig me det"

STEP 4: COMPRESSION
Swedish texting = fewer words, implied subjects, drop connectors.
Remove: jag (when obvious), att (often), du (when implied)
Shorten: det→de, något→nåt, någon→nån, bara→ba, var→va, med→me, morgon→imorn

STEP 5: PARTICLE SYSTEM
Add Swedish particles that make it sound native:
- ju (obviously/you know): "De e ju sjukt bra"
- väl (right?/I suppose): "Du kommer väl?"
- nog (probably): "De blir nog bra"
- då (then/so): "Vi kör då?"
- ba (just/like): "Ja ba gick"
Use these naturally, not in every sentence.

STEP 6: TONE CHECK
Ask yourself: "Would a 25-year-old in Stockholm actually text this?"
If it sounds like a textbook → rewrite it shorter and punchier.
If it sounds try-hard → simplify.
If you removed slang to be safe → put it back.${correctionsBlock}

Reply in this exact JSON format:
{
  "input_language": "swedish" | "english",
  "corrections": [{"original": "...", "corrected": "...", "explanation": "..."}],
  "formal": {
    "text": "<formal/proper Swedish version>",
    "translation": "<English translation>",
    "context": "<when to use — 1 sentence>"
  },
  "casual": {
    "text": "<genuinely native casual Swedish — intent-based, compressed, with particles>",
    "translation": "<English translation>",
    "context": "<when to use — 1 sentence>"
  },
  "grammar_note": "<key grammar point if corrections exist, otherwise empty string>",
  "stolen_phrases": ["<useful phrases worth memorizing>"]
}

The casual version must pass the test: "Would a real Swede in their 20s actually say this out loud or type this?" If the answer is no, rewrite it.`
}

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

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: `You are a Swedish language tutor writing a concise daily report. Be direct — no fluff, no encouragement filler. Use the student's ACTUAL mistakes as examples throughout.

Reply in this exact JSON format:
{
  "date": "${today}",
  "top_mistakes": [
    {
      "pattern": "<short name for the pattern, e.g. 'en/ett confusion'>",
      "examples": ["<actual mistake from their data: 'en hus' → 'ett hus'"],
      "rule_en": "<the grammar rule in 1-2 sentences>",
      "rule_sv": "<same rule in Swedish>"
    }
  ],
  "macro_en": "<1 short paragraph: their fundamental weak areas at a macro level. Be specific using their examples.>",
  "macro_sv": "<same in Swedish>",
  "focus": ["<3 specific practice points for today>"]
}

Max 4-5 top_mistakes entries. Every pattern MUST include real examples from the student's data. No generic advice.`,
      messages: [{
        role: "user",
        content: `My mistakes (most frequent first):\n${mistakesSummary}\n\nGenerate my report.`
      }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    const report = JSON.parse(jsonMatch[1].trim());

    report.phrase_of_day = potd || null;
    report.total_phrases = phrases.length;
    report.total_mistakes = mistakes.length;
    report.username = req.session.username;
    report.phrases_list = phrases.map((p) => p.phrase);

    res.json({ report });
  } catch (err) {
    console.error("Report error:", err.message);
    res.status(500).json({ error: "Failed to generate report", detail: err.message });
  }
});

// --- Casual corrections ---
app.post("/api/casual-correction", (req, res) => {
  const { ai_said, user_said, context } = req.body;
  if (!ai_said || !user_said) return res.status(400).json({ error: "Missing fields" });
  db.prepare("INSERT INTO casual_corrections (ai_said, user_said, context) VALUES (?, ?, ?)").run(ai_said, user_said, context || "");
  res.json({ ok: true });
});

// --- Quick translate for text selection ---
app.post("/api/quick-translate", async (req, res) => {
  const { text } = req.body;
  if (!text || text.length > 500) return res.status(400).json({ error: "Invalid text" });

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      system: `Translate the given text between Swedish and English (auto-detect). Reply in JSON:
{"translation": "<translated text>", "context": "<one sentence: when/how you'd use this phrase>", "context_sv": "<same context sentence in Swedish>"}`,
      messages: [{ role: "user", content: text }],
    });
    const t = response.content[0].text;
    const jsonMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, t];
    res.json(JSON.parse(jsonMatch[1].trim()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Delete individual phrase ---
app.delete("/api/progress/phrases/:phrase", requireAuth, (req, res) => {
  db.prepare("DELETE FROM phrases WHERE user_id = ? AND phrase = ?").run(req.session.userId, req.params.phrase);
  res.json({ ok: true });
});

// Increase JSON body limit for base64 images
app.use("/api/chat", express.json({ limit: "10mb" }));

const CONTEXT_MODIFIERS = {
  "none": "",
  "flirty": `\n\nCONTEXT: The user is in a flirty/dating context (texting someone they like, Tinder, etc). The casual version should be:
- Confident but not desperate
- Playful, teasing, a bit cheeky
- Nonchalant — cool without trying too hard
- NOT cringy pickup lines, NOT over-the-top
- Think: smooth, laid-back, "I'm interested but I'm not sweating it"
- Swedish flirting is subtle — less is more`,
  "work": `\n\nCONTEXT: Work/professional context (texting colleagues, work group chat). The casual version should be:
- Professional but human — not robotic
- Friendly tone, like you'd text a colleague you get along with
- Swedish workplaces are informal — first names, not titles
- Use "du" freely, keep it direct but warm
- OK to use light humor, but skip slang/swearing`,
  "friend": `\n\nCONTEXT: Texting a close friend. The casual version should be:
- Maximum casual — zero filter
- Inside-joke energy, abbreviated, messy grammar is fine
- Emojis/reactions implied in tone
- The kind of message you send without re-reading it first`,
};

app.post("/api/chat", async (req, res) => {
  const { mode, messages, labContext, imageData } = req.body;

  let systemPrompt = mode === "lab" ? buildLabPrompt() : SYSTEM_PROMPTS[mode];
  if (!systemPrompt) {
    return res.status(400).json({ error: "Invalid mode" });
  }

  // Add context modifier for lab mode
  if (mode === "lab" && labContext && CONTEXT_MODIFIERS[labContext]) {
    systemPrompt += CONTEXT_MODIFIERS[labContext];
  }

  // If image is attached, add context instruction
  if (imageData) {
    systemPrompt += "\n\nThe user has attached a screenshot for context. Look at it to understand the tone, platform, and situation. Use this visual context to make your response more accurate and natural.";
  }

  // Build messages with possible image content
  let apiMessages = messages;
  if (imageData && messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    apiMessages = [
      ...messages.slice(0, -1),
      {
        role: lastMsg.role,
        content: [
          { type: "image", source: { type: "base64", media_type: imageData.type, data: imageData.data } },
          { type: "text", text: lastMsg.content },
        ],
      },
    ];
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: systemPrompt,
      messages: apiMessages,
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
