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

let cachedPhraseTranslations = {};

function renderStatsData(data) {
  const phrasesList = $("#stolen-phrases-list");
  const mistakesList = $("#mistakes-list");

  $("#phrase-count").textContent = data.phrases.length;
  $("#mistake-count").textContent = data.mistakes.length;

  phrasesList.innerHTML = data.phrases
    .map((p) => `<div class="phrase-item">
      <input type="checkbox" data-phrase="${esc(p.phrase)}">
      <div class="phrase-text">
        <div class="phrase-sv">${esc(p.phrase)}</div>
        <div class="phrase-en">${esc(cachedPhraseTranslations[p.phrase] || "")}</div>
      </div>
      <button class="phrase-delete" data-phrase="${esc(p.phrase)}" title="Delete">&times;</button>
    </div>`)
    .join("");

  // Lazy-load translations for phrases that don't have one yet
  for (const p of data.phrases) {
    if (!cachedPhraseTranslations[p.phrase]) {
      translatePhraseForList(p.phrase);
    }
  }

  // Delete individual phrase buttons
  phrasesList.querySelectorAll(".phrase-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const phrase = btn.dataset.phrase;
      await fetch("/api/progress/phrases/" + encodeURIComponent(phrase), { method: "DELETE" });
      btn.closest(".phrase-item").remove();
      const count = phrasesList.querySelectorAll(".phrase-item").length;
      $("#phrase-count").textContent = count;
    });
  });

  mistakesList.innerHTML = data.mistakes
    .map((m) => `<div class="stats-item"><span class="orig">${esc(m.original)}</span> &rarr; <span class="fix">${esc(m.corrected)}</span> <span class="count">(&times;${m.count})</span></div>`)
    .join("");
}

async function translatePhraseForList(phrase) {
  try {
    const res = await fetch("/api/quick-translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: phrase }),
    });
    if (!res.ok) return;
    const data = await res.json();
    cachedPhraseTranslations[phrase] = data.translation;
    // Update the UI if still visible
    const items = $$("#stolen-phrases-list .phrase-item");
    for (const item of items) {
      if (item.querySelector(".phrase-sv")?.textContent === phrase) {
        item.querySelector(".phrase-en").textContent = data.translation;
      }
    }
  } catch {}
}

// Select all phrases
$("#select-all-phrases").addEventListener("click", () => {
  const boxes = $$("#stolen-phrases-list input[type='checkbox']");
  const allChecked = [...boxes].every((b) => b.checked);
  boxes.forEach((b) => (b.checked = !allChecked));
});

// Delete selected phrases
$("#delete-selected-phrases").addEventListener("click", async () => {
  const checked = $$("#stolen-phrases-list input[type='checkbox']:checked");
  if (checked.length === 0) return;
  for (const box of checked) {
    const phrase = box.dataset.phrase;
    await fetch("/api/progress/phrases/" + encodeURIComponent(phrase), { method: "DELETE" });
    box.closest(".phrase-item").remove();
  }
  const count = $$("#stolen-phrases-list .phrase-item").length;
  $("#phrase-count").textContent = count;
});

$("#clear-phrases").addEventListener("click", async () => {
  await fetch("/api/progress/phrases", { method: "DELETE" });
  const data = await (await fetch("/api/progress")).json();
  renderStatsData({ phrases: [], mistakes: data.mistakes });
});

$("#clear-mistakes").addEventListener("click", async () => {
  await fetch("/api/progress/mistakes", { method: "DELETE" });
  const data = await (await fetch("/api/progress")).json();
  renderStatsData({ phrases: data.phrases, mistakes: [] });
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

  // Remove old print container
  const old = document.getElementById("print-report-container");
  if (old) old.remove();

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
    preview.innerHTML = `<div class="report-actions">
      <button class="btn-print" id="btn-print-report">Print / Save as PDF</button>
    </div>` + buildReportPreview(report);

    // Create hidden print container at body root
    const printDiv = document.createElement("div");
    printDiv.id = "print-report-container";
    printDiv.style.display = "none";
    printDiv.innerHTML = `<div id="print-report">${buildPrintReport(report)}</div>`;
    document.body.appendChild(printDiv);

    $("#btn-print-report").addEventListener("click", () => {
      window.print();
    });
  } catch (err) {
    preview.classList.remove("hidden");
    preview.innerHTML = `<p style="color:var(--red)">Error: ${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate Daily Report";
  }
});

function buildReportPreview(r) {
  let html = "";

  if (r.phrase_of_day) {
    const p = r.phrase_of_day;
    html += `<div style="border-left:3px solid var(--yellow);padding-left:0.8rem;margin-bottom:1rem">
      <div style="font-size:0.7rem;color:var(--text-dim);text-transform:uppercase;font-weight:600">Phrase of the Day</div>
      <div style="color:var(--yellow);font-size:1.2rem;font-weight:700">${esc(p.phrase)}</div>
      <div style="color:var(--text-dim);font-size:0.85rem">${esc(p.meaning)}</div>
    </div>`;
  }

  if (r.macro_en) {
    html += `<div style="margin-bottom:1rem">
      <div class="label">Key Issues</div>
      <p style="font-size:0.9rem;margin-bottom:0.4rem">${esc(r.macro_en)}</p>
      <div style="background:var(--surface);padding:0.6rem 0.8rem;border-radius:8px;border-left:3px solid var(--accent);color:var(--accent-hover);font-style:italic;font-size:0.85rem">${esc(r.macro_sv)}</div>
    </div>`;
  }

  if (r.top_mistakes && r.top_mistakes.length > 0) {
    html += `<div class="label">Mistake Patterns</div>`;
    for (const m of r.top_mistakes) {
      html += `<div style="background:var(--surface);border-radius:8px;padding:0.7rem;margin-bottom:0.5rem">
        <div style="font-weight:600;font-size:0.9rem;margin-bottom:0.3rem">${esc(m.pattern)}</div>
        ${m.examples ? m.examples.map((e) => `<div style="font-family:monospace;font-size:0.8rem;color:var(--orange);margin-bottom:0.2rem">${esc(e)}</div>`).join("") : ""}
        <div style="font-size:0.85rem;margin-bottom:0.3rem">${esc(m.rule_en)}</div>
        <div style="font-size:0.8rem;color:var(--accent-hover);font-style:italic">${esc(m.rule_sv)}</div>
      </div>`;
    }
  }

  if (r.focus && r.focus.length > 0) {
    html += `<div class="label" style="margin-top:0.8rem">Today's Focus</div>`;
    for (const f of r.focus) {
      html += `<div style="font-size:0.85rem;padding:0.2rem 0">• ${esc(f)}</div>`;
    }
  }

  if (r.phrases_list && r.phrases_list.length > 0) {
    html += `<div class="label" style="margin-top:1rem">My Stolen Phrases</div>`;
    html += `<div style="font-size:0.85rem;color:var(--text-dim);margin-bottom:0.3rem">${r.phrases_list.length} phrases collected</div>`;
    for (const p of r.phrases_list.slice(0, 20)) {
      const tr = cachedPhraseTranslations[p] || "";
      html += `<div style="padding:0.3rem 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--yellow)">${esc(p)}</span>
        ${tr ? `<span style="color:var(--text-dim);font-size:0.8rem;font-style:italic;margin-left:0.4rem">— ${esc(tr)}</span>` : ""}
      </div>`;
    }
  }

  return html;
}

function buildPrintReport(r) {
  let html = "";
  html += `<h1>Svenska Tranaren</h1>`;
  html += `<div class="rpt-meta">${esc(r.date)} | ${esc(r.username)} | ${r.total_mistakes} mistakes tracked</div>`;

  if (r.phrase_of_day) {
    const p = r.phrase_of_day;
    html += `<div class="rpt-potd">
      <h2>Phrase of the Day</h2>
      <div class="rpt-potd-phrase">${esc(p.phrase)}</div>
      <div>${esc(p.meaning)}</div>
      <div style="margin-top:3pt"><em>${esc(p.example_swedish)}</em> — ${esc(p.example_english)}</div>
    </div>`;
  }

  if (r.macro_en) {
    html += `<h2>Key Issues</h2>`;
    html += `<div class="rpt-block-en">${esc(r.macro_en)}</div>`;
    html += `<div class="rpt-block-sv">${esc(r.macro_sv)}</div>`;
  }

  if (r.top_mistakes && r.top_mistakes.length > 0) {
    html += `<h2>Mistake Patterns</h2>`;
    for (const m of r.top_mistakes) {
      html += `<div class="rpt-pattern">`;
      html += `<strong>${esc(m.pattern)}</strong><br>`;
      if (m.examples) {
        for (const e of m.examples) {
          html += `<span class="rpt-example">${esc(e)}</span> `;
        }
        html += `<br>`;
      }
      html += `<div class="rpt-block-en">${esc(m.rule_en)}</div>`;
      html += `<div class="rpt-block-sv">${esc(m.rule_sv)}</div>`;
      html += `</div>`;
    }
  }

  if (r.focus && r.focus.length > 0) {
    html += `<h2>Focus Areas</h2>`;
    for (const f of r.focus) {
      html += `<div class="rpt-focus">• ${esc(f)}</div>`;
    }
  }

  if (r.phrases_list && r.phrases_list.length > 0) {
    html += `<h2>Stolen Phrases (${r.phrases_list.length})</h2>`;
    html += `<div class="rpt-phrases">`;
    for (const p of r.phrases_list) {
      const tr = cachedPhraseTranslations[p] || "";
      html += `<div class="rpt-phrase-item"><span class="rpt-phrase-sv">${esc(p)}</span> ${tr ? `<span class="rpt-phrase-en">— ${esc(tr)}</span>` : ""}</div>`;
    }
    html += `</div>`;
  }

  return html;
}

// --- Text selection popup ---
let selectedText = "";

document.addEventListener("mouseup", handleTextSelect);
document.addEventListener("touchend", handleTextSelect);

function handleTextSelect() {
  const sel = window.getSelection();
  const text = sel.toString().trim();
  if (text.length < 2 || text.length > 500) {
    return;
  }
  // Only trigger inside chat panels or report
  const anchor = sel.anchorNode;
  if (!anchor) return;
  const parent = anchor.parentElement;
  if (!parent) return;
  const inApp = parent.closest(".chat-messages, .bubble, .report-preview, .potd-card, .stats-content");
  if (!inApp) return;

  selectedText = text;
  showSelectionPopup(text);
}

async function showSelectionPopup(text) {
  const popup = $("#select-popup");
  const content = $("#select-translation");
  popup.classList.remove("hidden");
  content.innerHTML = `<div class="sel-original">${esc(text)}</div><div style="color:var(--text-dim);font-size:0.8rem">Translating...</div>`;

  try {
    const res = await fetch("/api/quick-translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("Failed");
    const data = await res.json();

    content.innerHTML = `
      <div class="sel-original">${esc(text)}</div>
      <div class="sel-translated">${esc(data.translation)}</div>
      <div class="sel-context">${esc(data.context)}<br><em>${esc(data.context_sv)}</em></div>
    `;
  } catch {
    content.innerHTML = `<div class="sel-original">${esc(text)}</div><div style="color:var(--red);font-size:0.85rem">Could not translate</div>`;
  }
}

$("#select-close").addEventListener("click", () => {
  $("#select-popup").classList.add("hidden");
  window.getSelection().removeAllRanges();
});

$("#select-add-phrase").addEventListener("click", async () => {
  if (!selectedText || !loggedIn) return;
  await fetch("/api/progress/phrases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phrases: [selectedText] }),
  });
  $("#select-popup").classList.add("hidden");
  window.getSelection().removeAllRanges();
  // Brief visual confirmation
  const btn = $("#select-add-phrase");
  btn.textContent = "Added!";
  setTimeout(() => { btn.textContent = "Add to Stolen Phrases"; }, 1500);
});

// --- Init ---
checkAuth();
