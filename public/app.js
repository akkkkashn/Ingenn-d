// --- State ---
let loggedIn = false;
const conversationHistory = [];
let currentSituation = "";

const SITUATIONS = [
  "You're at a cafe in Stockholm and want to order a coffee and a cinnamon bun.",
  "You're lost in Gothenburg and need to ask someone for directions to the train station.",
  "You're at a job interview and the interviewer asks you to describe your strengths.",
  "You're calling to book a table for four at a restaurant for Friday evening.",
  "You're at the doctor and need to explain that you have a sore throat and a headache.",
  "You're at a party and someone introduces themselves. Make small talk.",
  "You're checking into a hotel and there's a problem with your reservation.",
  "You're at the grocery store and can't find the bread. Ask an employee for help.",
  "You're returning an item at a clothing store because it's the wrong size.",
  "A Swedish colleague asks what you did over the weekend. Tell them.",
  "You're at a fika and your friend asks about your family. Describe them.",
  "You just moved to Sweden and need to register at Skatteverket. Explain your situation.",
  "You're at Systembolaget and want a recommendation for a good Swedish beer.",
  "You bump into your neighbor and they invite you to a midsummer celebration. Respond.",
  "You're on a train and the person next to you starts chatting about the weather.",
  "You need to call your landlord because the heating in your apartment is broken.",
  "You're at a museum and want to ask about student discounts and opening hours.",
  "A friend is feeling sad. Comfort them and suggest doing something fun together.",
  "You're applying for a Swedish language course and need to describe your current level.",
  "You're at IKEA and need help finding a specific piece of furniture.",
];

// --- DOM ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- Auto-resize textareas ---
$$(".chat-input-bar textarea").forEach((ta) => {
  ta.addEventListener("input", () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  });
});

// --- Auth ---
async function checkAuth() {
  try {
    const res = await fetch("/api/me");
    const data = await res.json();
    if (data.loggedIn) {
      loggedIn = true;
      showApp(data.username);
    }
  } catch {}
}

$("#btn-login").addEventListener("click", async () => {
  const username = $("#auth-username").value.trim();
  const password = $("#auth-password").value;
  if (!username || !password) return showAuthError("Fill in both fields");
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(data.error);
    loggedIn = true;
    showApp(data.username);
  } catch { showAuthError("Connection error"); }
});

$("#btn-register").addEventListener("click", async () => {
  const username = $("#auth-username").value.trim();
  const password = $("#auth-password").value;
  if (!username || !password) return showAuthError("Fill in both fields");
  try {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(data.error);
    loggedIn = true;
    showApp(data.username);
  } catch { showAuthError("Connection error"); }
});

// Enter key on password field
$("#auth-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#btn-login").click();
});

function showAuthError(msg) {
  $("#auth-error").textContent = msg;
}

function showApp(username) {
  $("#auth-screen").classList.remove("active");
  $("#app-screen").classList.add("active");
  $("#menu-username").textContent = username;
  loadProgress();
}

// Logout
$("#btn-logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  loggedIn = false;
  $("#app-screen").classList.remove("active");
  $("#auth-screen").classList.add("active");
  $("#auth-username").value = "";
  $("#auth-password").value = "";
  $("#auth-error").textContent = "";
  $("#user-menu-dropdown").classList.add("hidden");
});

// User menu toggle
$("#user-menu-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#user-menu-dropdown").classList.toggle("hidden");
});

document.addEventListener("click", () => {
  $("#user-menu-dropdown").classList.add("hidden");
});

// --- Navigation ---
$$(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".nav-btn").forEach((b) => b.classList.remove("active"));
    $$(".chat-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    const mode = btn.dataset.mode;
    $(`#panel-${mode}`).classList.add("active");
    if (mode === "stats") renderStats();
    if (mode === "daily") loadPhraseOfDay();
  });
});

// --- Situations ---
$("#new-situation").addEventListener("click", () => {
  currentSituation = SITUATIONS[Math.floor(Math.random() * SITUATIONS.length)];
  addBubble("msgs-situation-respond", "system", currentSituation);
});

// --- Send buttons ---
$$(".send-btn").forEach((btn) => {
  btn.addEventListener("click", () => handleSend(btn.dataset.mode));
});

// Enter to send (no shift)
$$(".chat-input-bar textarea").forEach((ta) => {
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const btn = ta.parentElement.querySelector(".send-btn");
      if (btn) btn.click();
    }
  });
});

// --- API ---
async function apiChat(mode, messages) {
  $("#loading-overlay").classList.remove("hidden");
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, messages }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Request failed");
    }
    return await res.json();
  } finally {
    $("#loading-overlay").classList.add("hidden");
  }
}

// --- Handle Send ---
async function handleSend(mode) {
  let userText, messages;
  const inputMap = {
    "conversation": "#input-conversation",
    "correct-me": "#input-correct",
    "situation-respond": "#input-situation",
    "rewrite": "#input-rewrite",
    "translate": "#input-translate",
  };

  const input = $(inputMap[mode]);
  userText = input.value.trim();
  if (!userText) return;
  if (mode === "situation-respond" && !currentSituation) return;

  // Show user bubble
  const msgsId = `msgs-${mode}`;
  addBubble(msgsId, "user", userText);
  input.value = "";
  input.style.height = "auto";

  // Build messages
  switch (mode) {
    case "situation-respond":
      messages = [{ role: "user", content: `Situation: ${currentSituation}\n\nMy response: ${userText}` }];
      break;
    case "conversation":
      conversationHistory.push({ role: "user", content: userText });
      messages = [...conversationHistory];
      break;
    default:
      messages = [{ role: "user", content: userText }];
  }

  try {
    const data = await apiChat(mode, messages);

    if (data.raw) {
      addBubble(msgsId, "assistant", data.raw);
      return;
    }

    switch (mode) {
      case "conversation":
        renderConvResponse(msgsId, data);
        break;
      case "correct-me":
        renderCorrectionResponse(msgsId, data);
        break;
      case "situation-respond":
        renderSituationResponse(msgsId, data);
        break;
      case "rewrite":
        renderRewriteResponse(msgsId, data);
        break;
      case "translate":
        renderTranslateResponse(msgsId, data);
        break;
    }

    // Save progress server-side
    saveProgress(data.stolen_phrases, data.mistakes || data.corrections);
  } catch (err) {
    addBubble(msgsId, "system", "Error: " + err.message);
  }
}

// --- Bubble helper ---
function addBubble(containerId, type, text) {
  const container = $(`#${containerId}`);
  const div = document.createElement("div");
  div.className = `bubble ${type}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function addRichBubble(containerId, html) {
  const container = $(`#${containerId}`);
  const div = document.createElement("div");
  div.className = "bubble assistant";
  div.innerHTML = html;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function esc(str) {
  if (!str) return "";
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// --- Renderers ---

function renderConvResponse(msgsId, data) {
  let html = "";

  if (data.corrections && data.corrections.length > 0) {
    html += data.corrections.map((c) =>
      `<div class="correction"><span class="orig">${esc(c.original)}</span> &rarr; <span class="fix">${esc(c.corrected)}</span><span class="expl">${esc(c.explanation)}</span></div>`
    ).join("");
  }

  html += `<div class="swedish">${esc(data.reply_swedish)}</div>`;
  html += `<div class="translation-text">${esc(data.reply_english)}</div>`;

  if (data.feedback) {
    html += `<div class="note">${esc(data.feedback)}</div>`;
  }

  if (data.stolen_phrases && data.stolen_phrases.length > 0) {
    html += `<div class="phrases">${data.stolen_phrases.map((p) => `<span class="phrase-tag">${esc(p)}</span>`).join("")}</div>`;
  }

  addRichBubble(msgsId, html);

  conversationHistory.push({ role: "assistant", content: data.reply_swedish });
}

function renderCorrectionResponse(msgsId, data) {
  let html = "";

  if (data.rating) {
    html += `<span class="rating rating-${data.rating}">${data.rating.replace("_", " ")}</span>`;
  }

  html += `<div class="label">Corrected</div><div class="swedish">${esc(data.corrected)}</div>`;

  if (data.mistakes && data.mistakes.length > 0) {
    html += data.mistakes.map((m) =>
      `<div class="correction"><span class="orig">${esc(m.original)}</span> &rarr; <span class="fix">${esc(m.corrected)}</span><span class="expl">${esc(m.explanation)}</span></div>`
    ).join("");
  }

  if (data.natural_version) {
    html += `<div class="label">Native version</div><div class="swedish">${esc(data.natural_version)}</div>`;
  }

  if (data.feedback) {
    html += `<div class="note">${esc(data.feedback)}</div>`;
  }

  if (data.stolen_phrases && data.stolen_phrases.length > 0) {
    html += `<div class="phrases">${data.stolen_phrases.map((p) => `<span class="phrase-tag">${esc(p)}</span>`).join("")}</div>`;
  }

  addRichBubble(msgsId, html);
}

function renderSituationResponse(msgsId, data) {
  renderCorrectionResponse(msgsId, data);
}

function renderRewriteResponse(msgsId, data) {
  let html = "";

  html += `<div class="label">Swedish</div><div class="swedish">${esc(data.swedish)}</div>`;
  html += `<div class="label">Breakdown</div><div>${esc(data.literal_breakdown)}</div>`;

  if (data.grammar_notes && data.grammar_notes.length > 0) {
    html += `<div class="label">Grammar</div>`;
    html += data.grammar_notes.map((n) => `<div class="grammar-note">${esc(n)}</div>`).join("");
  }

  if (data.alternatives && data.alternatives.length > 0) {
    html += `<div class="label">Alternatives</div>`;
    html += data.alternatives.map((a) => `<div class="alt">${esc(a)}</div>`).join("");
  }

  if (data.stolen_phrases && data.stolen_phrases.length > 0) {
    html += `<div class="phrases">${data.stolen_phrases.map((p) => `<span class="phrase-tag">${esc(p)}</span>`).join("")}</div>`;
  }

  addRichBubble(msgsId, html);
}

function renderTranslateResponse(msgsId, data) {
  let html = "";

  const dir = data.detected_language === "swedish" ? "SV &rarr; EN" : "EN &rarr; SV";
  html += `<div class="label">${dir}</div>`;
  html += `<div class="swedish">${esc(data.translation)}</div>`;

  if (data.literal) {
    html += `<div class="label">Literal</div><div class="translation-text">${esc(data.literal)}</div>`;
  }

  if (data.notes) {
    html += `<div class="note">${esc(data.notes)}</div>`;
  }

  addRichBubble(msgsId, html);
}

// --- Server-side progress ---
async function saveProgress(phrases, mistakes) {
  if (!loggedIn) return;
  if (phrases && phrases.length > 0) {
    fetch("/api/progress/phrases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phrases }),
    });
  }
  if (mistakes && mistakes.length > 0) {
    fetch("/api/progress/mistakes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mistakes }),
    });
  }
}

async function loadProgress() {
  if (!loggedIn) return;
  try {
    const res = await fetch("/api/progress");
    if (!res.ok) return;
    const data = await res.json();
    renderStatsData(data);
  } catch {}
}

function renderStats() {
  loadProgress();
}

function renderStatsData(data) {
  const phrasesList = $("#stolen-phrases-list");
  const mistakesList = $("#mistakes-list");

  $("#phrase-count").textContent = data.phrases.length;
  $("#mistake-count").textContent = data.mistakes.length;

  phrasesList.innerHTML = data.phrases
    .map((p) => `<div class="stats-item">${esc(p.phrase)}</div>`)
    .join("");

  mistakesList.innerHTML = data.mistakes
    .map((m) => `<div class="stats-item"><span class="orig">${esc(m.original)}</span> &rarr; <span class="fix">${esc(m.corrected)}</span> <span class="count">(&times;${m.count})</span></div>`)
    .join("");
}

$("#clear-phrases").addEventListener("click", async () => {
  await fetch("/api/progress/phrases", { method: "DELETE" });
  renderStatsData({ phrases: [], mistakes: (await (await fetch("/api/progress")).json()).mistakes });
});

$("#clear-mistakes").addEventListener("click", async () => {
  await fetch("/api/progress/mistakes", { method: "DELETE" });
  renderStatsData({ phrases: (await (await fetch("/api/progress")).json()).phrases, mistakes: [] });
});

// --- Phrase of the Day ---
let potdLoaded = false;

async function loadPhraseOfDay() {
  if (potdLoaded) return;
  const card = $("#potd-card");
  try {
    const res = await fetch("/api/phrase-of-day");
    if (!res.ok) throw new Error("Failed to load");
    const data = await res.json();
    potdLoaded = true;

    card.innerHTML = `
      <div class="potd-phrase">${esc(data.phrase)}</div>
      <div class="potd-pronunciation">${esc(data.pronunciation)}</div>
      <div class="potd-row">
        <div class="potd-label">Literal</div>
        <div class="potd-value">${esc(data.literal)}</div>
      </div>
      <div class="potd-row">
        <div class="potd-label">Meaning</div>
        <div class="potd-value">${esc(data.meaning)}</div>
      </div>
      <div class="potd-row">
        <div class="potd-label">When to use it</div>
        <div class="potd-value">${esc(data.context)}</div>
      </div>
      <div class="potd-row">
        <div class="potd-label">Example</div>
        <div class="potd-value potd-swedish">${esc(data.example_swedish)}</div>
        <div class="potd-value" style="font-size:0.85rem;color:var(--text-dim);font-style:italic">${esc(data.example_english)}</div>
      </div>
      <span class="potd-difficulty ${data.difficulty}">${data.difficulty}</span>
    `;
  } catch (err) {
    card.innerHTML = `<p class="potd-loading">Could not load phrase: ${esc(err.message)}</p>`;
  }
}

// --- Daily Report ---
$("#btn-generate-report").addEventListener("click", async () => {
  const btn = $("#btn-generate-report");
  const preview = $("#report-preview");
  btn.disabled = true;
  btn.textContent = "Generating report...";
  preview.classList.add("hidden");

  try {
    const res = await fetch("/api/report");
    if (!res.ok) throw new Error("Failed to generate report");
    const { report, message } = await res.json();

    if (!report) {
      preview.classList.remove("hidden");
      preview.innerHTML = `<p style="color:var(--text-dim)">${esc(message)}</p>`;
      return;
    }

    preview.classList.remove("hidden");
    preview.innerHTML = buildReportHtml(report);
  } catch (err) {
    preview.classList.remove("hidden");
    preview.innerHTML = `<p style="color:var(--red)">Error: ${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate Daily Report";
  }
});

function buildReportHtml(r) {
  let html = `<div class="report-actions">
    <button class="btn-print" onclick="window.print()">Print / Save as PDF</button>
  </div>`;

  html += `<div id="print-report">`;
  html += `<h1>Svenska Tranaren — Daily Report</h1>`;
  html += `<div class="print-meta">${esc(r.date)} | ${esc(r.username)} | ${r.total_phrases} phrases learned | ${r.total_mistakes} mistakes tracked</div>`;

  // Phrase of the Day
  if (r.phrase_of_day) {
    const p = r.phrase_of_day;
    html += `<div class="print-potd">
      <h2>Phrase of the Day</h2>
      <div class="phrase">${esc(p.phrase)}</div>
      <div>${esc(p.meaning)}</div>
      <div style="margin-top:4pt"><em>${esc(p.example_swedish)}</em></div>
      <div style="color:#666">${esc(p.example_english)}</div>
    </div>`;
  }

  // Summary
  html += `<h2>Summary</h2>`;
  html += `<p>${esc(r.summary_en)}</p>`;
  html += `<p class="print-swedish">${esc(r.summary_sv)}</p>`;

  // Macro Analysis
  html += `<h2>What You're Getting Wrong (and Why)</h2>`;
  html += `<p>${esc(r.macro_analysis_en)}</p>`;
  html += `<p class="print-swedish">${esc(r.macro_analysis_sv)}</p>`;

  // Top Mistakes
  if (r.top_mistakes && r.top_mistakes.length > 0) {
    html += `<h2>Recurring Mistake Patterns</h2>`;
    for (const m of r.top_mistakes) {
      html += `<div class="print-mistake">
        <h3>${esc(m.pattern)}</h3>
        <p>${esc(m.explanation_en)}</p>
        <p class="print-swedish">${esc(m.explanation_sv)}</p>
        <p><strong>Tip:</strong> ${esc(m.tip)}</p>
      </div>`;
    }
  }

  // Focus Areas
  if (r.focus_areas && r.focus_areas.length > 0) {
    html += `<h2>Today's Focus Areas</h2>`;
    for (const f of r.focus_areas) {
      html += `<div class="print-focus">• ${esc(f)}</div>`;
    }
  }

  // Encouragement
  if (r.encouragement) {
    html += `<p style="margin-top:10pt;font-style:italic">${esc(r.encouragement)}</p>`;
  }

  html += `</div>`;
  return html;
}

// --- Init ---
checkAuth();
