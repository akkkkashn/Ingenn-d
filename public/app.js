// --- State ---
let loggedIn = false;
const chatHistory = [];
let awaitingSituationResponse = false;
let currentSituation = "";
let cachedPhraseTranslations = {};
let labContext = "none";
let labImageData = null;
let labMode = "translate"; // "translate" or "explore"

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

$("#auth-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#btn-login").click();
});

function showAuthError(msg) { $("#auth-error").textContent = msg; }

function showApp(username) {
  $("#auth-screen").classList.remove("active");
  $("#app-screen").classList.add("active");
  $("#menu-username").textContent = username;
  loadProgress();
}

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

// --- Lab mode toggle ---
$$(".lab-mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".lab-mode-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    labMode = btn.dataset.labmode;
    // Hide context bar in explore mode (not relevant)
    $("#lab-context-bar").style.display = labMode === "explore" ? "none" : "";
    // Update placeholder
    $("#input-lab").placeholder = labMode === "explore"
      ? "Type a word or phrase you heard..."
      : "Write in Swedish or English...";
  });
});

// --- Lab context modes ---
$$(".context-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".context-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    labContext = btn.dataset.context;
  });
});

// --- Lab image upload ---
$("#lab-image-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(",")[1];
    labImageData = { type: file.type, data: base64 };
    $("#lab-image-thumb").src = reader.result;
    $("#lab-image-preview").classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

$("#lab-image-remove").addEventListener("click", () => {
  labImageData = null;
  $("#lab-image-input").value = "";
  $("#lab-image-preview").classList.add("hidden");
});

// --- Situation button in chat header ---
$("#btn-situation").addEventListener("click", async () => {
  $("#loading-overlay").classList.remove("hidden");
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "chat-situation", messages: [{ role: "user", content: "Give me a situation." }] }),
    });
    const data = await res.json();
    if (data.situation) {
      currentSituation = data.situation;
      awaitingSituationResponse = true;
      let html = `<div class="label">Situation</div><div>${esc(data.situation)}</div>`;
      if (data.hint) html += `<div class="note">Hint: ${esc(data.hint)}</div>`;
      addRichBubble("msgs-chat", html);
    }
  } catch (err) {
    addBubble("msgs-chat", "system", "Error: " + err.message);
  } finally {
    $("#loading-overlay").classList.add("hidden");
  }
});

// --- Send buttons ---
$$(".send-btn").forEach((btn) => {
  btn.addEventListener("click", () => handleSend(btn.dataset.mode));
});

// Enter to send
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
async function apiChat(mode, messages, extra = {}) {
  $("#loading-overlay").classList.remove("hidden");
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, messages, ...extra }),
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
  const inputMap = { "chat": "#input-chat", "lab": "#input-lab" };
  const input = $(inputMap[mode]);
  const userText = input.value.trim();
  if (!userText) return;

  const msgsId = `msgs-${mode}`;
  // Don't add user bubble for lab if image attached (handled in lab block)
  if (!(mode === "lab" && labImageData)) {
    addBubble(msgsId, "user", userText);
  }
  input.value = "";
  input.style.height = "auto";

  try {
    if (mode === "chat") {
      // Check if responding to a situation
      if (awaitingSituationResponse && currentSituation) {
        awaitingSituationResponse = false;
        const data = await apiChat("chat-situation-respond", [{
          role: "user",
          content: `Situation: ${currentSituation}\n\nMy response: ${userText}`
        }]);
        renderSituationResponse(msgsId, data);
        saveProgress(null, data.mistakes);
        currentSituation = "";
      } else {
        // General chat
        chatHistory.push({ role: "user", content: userText });
        const data = await apiChat("chat", [...chatHistory]);
        if (data.raw) {
          addBubble(msgsId, "assistant", data.raw);
        } else {
          let html = `<div>${esc(data.reply)}</div>`;
          if (data.stolen_phrases && data.stolen_phrases.length > 0) {
            html += phraseTags(data.stolen_phrases);
          }
          addRichBubble(msgsId, html);
          chatHistory.push({ role: "assistant", content: data.reply });
        }
      }
    } else if (mode === "lab") {
      // Route to explore or translate
      if (labMode === "explore") {
        const data = await apiChat("lab-explore", [{ role: "user", content: userText }]);
        if (data.raw) {
          addBubble(msgsId, "assistant", data.raw);
        } else {
          renderExploreResponse(msgsId, data);
          saveProgress(data.stolen_phrases, null);
        }
        return;
      }
      const extra = { labContext };
      if (labImageData) {
        extra.imageData = labImageData;
        // Show image in chat
        const imgBubble = document.createElement("div");
        imgBubble.className = "bubble user";
        imgBubble.innerHTML = `<img src="data:${labImageData.type};base64,${labImageData.data}" style="max-width:200px;border-radius:8px;margin-bottom:0.3rem"><br>${esc(userText)}`;
        $(`#${msgsId}`).appendChild(imgBubble);
        // Clear image after sending
        labImageData = null;
        $("#lab-image-input").value = "";
        $("#lab-image-preview").classList.add("hidden");
      }
      if (labContext !== "none") {
        // Show context badge in chat
        const badge = document.createElement("div");
        badge.className = "bubble system";
        badge.style.cssText = "font-size:0.75rem;padding:0.3rem 0.6rem";
        badge.textContent = `Context: ${labContext}`;
        $(`#${msgsId}`).appendChild(badge);
      }
      const data = await apiChat("lab", [{ role: "user", content: userText }], extra);
      if (data.raw) {
        addBubble(msgsId, "assistant", data.raw);
      } else {
        renderLabResponse(msgsId, data);
        saveProgress(null, data.corrections);
      }
    }
  } catch (err) {
    addBubble(msgsId, "system", "Error: " + err.message);
  }
}

// --- Bubble helpers ---
function addBubble(containerId, type, text) {
  const container = $(`#${containerId}`);
  const div = document.createElement("div");
  div.className = `bubble ${type}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
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

// --- Clickable phrase tags ---
function phraseTags(phrases) {
  if (!phrases || phrases.length === 0) return "";
  return `<div class="phrases">${phrases.map((p) =>
    `<span class="phrase-tag phrase-tag-save" data-phrase="${esc(p)}">${esc(p)}</span>`
  ).join("")}</div>`;
}

// Delegate click handler for phrase tags
document.addEventListener("click", async (e) => {
  const tag = e.target.closest(".phrase-tag-save");
  if (!tag || !loggedIn) return;

  const phrase = tag.dataset.phrase;
  if (tag.classList.contains("phrase-saved")) return;

  tag.classList.add("phrase-saved");
  tag.textContent = "Saved!";

  await fetch("/api/progress/phrases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phrases: [phrase] }),
  });

  setTimeout(() => {
    tag.textContent = phrase;
    tag.classList.remove("phrase-tag-save");
  }, 1500);
});

// --- Renderers ---

function renderLabResponse(msgsId, data) {
  let html = `<div class="lab-result">`;

  // Corrections first
  if (data.corrections && data.corrections.length > 0) {
    html += data.corrections.map((c) =>
      `<div class="correction"><span class="orig">${esc(c.original)}</span> &rarr; <span class="fix">${esc(c.corrected)}</span><span class="expl">${esc(c.explanation)}</span></div>`
    ).join("");
  }

  // Formal card
  if (data.formal) {
    html += `<div class="lab-card">
      <div class="lab-card-header"><span class="lab-badge lab-badge-formal">Formal</span></div>
      <div class="lab-text">${esc(data.formal.text)}</div>
      <div class="lab-translation">${esc(data.formal.translation)}</div>
      <div class="lab-context">${esc(data.formal.context)}</div>
    </div>`;
  }

  // Casual card with "not natural" button
  if (data.casual) {
    const casualId = "casual-" + Date.now();
    html += `<div class="lab-card" id="${casualId}">
      <div class="lab-card-header">
        <span class="lab-badge lab-badge-casual">Casual / Slang</span>
        <button class="btn-not-natural" data-casual="${esc(data.casual.text)}" data-card="${casualId}">Not natural?</button>
      </div>
      <div class="lab-text">${esc(data.casual.text)}</div>
      <div class="lab-translation">${esc(data.casual.translation)}</div>
      <div class="lab-context">${esc(data.casual.context)}</div>
    </div>`;
  }

  // Grammar note
  if (data.grammar_note) {
    html += `<div class="note">${esc(data.grammar_note)}</div>`;
  }

  // Phrases — clickable to save
  if (data.stolen_phrases && data.stolen_phrases.length > 0) {
    html += phraseTags(data.stolen_phrases);
  }

  html += `</div>`;
  addRichBubble(msgsId, html);
}

function renderSituationResponse(msgsId, data) {
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
    html += phraseTags(data.stolen_phrases);
  }

  addRichBubble(msgsId, html);
}

function renderExploreResponse(msgsId, data) {
  let html = `<div class="explore-result">`;

  html += `<div class="explore-word">${esc(data.word)}</div>`;
  html += `<div class="explore-meta">
    <span class="explore-type">${esc(data.type)}</span>
    ${data.formality ? `<span class="explore-formality ${data.formality}">${esc(data.formality)}</span>` : ""}
    ${data.pronunciation ? `<span style="color:var(--text-dim);font-size:0.8rem;font-style:italic">${esc(data.pronunciation)}</span>` : ""}
  </div>`;

  html += `<div style="font-size:0.95rem;margin-bottom:0.2rem">${esc(data.meaning)}</div>`;

  // Examples
  if (data.examples && data.examples.length > 0) {
    html += `<div class="label">Examples</div>`;
    for (const ex of data.examples) {
      html += `<div class="explore-example">
        <div class="ex-sv">${esc(ex.swedish)}</div>
        <div class="ex-en">${esc(ex.english)}</div>
        <div class="ex-ctx">${esc(ex.context)}</div>
      </div>`;
    }
  }

  // Common combos
  if (data.common_combos && data.common_combos.length > 0) {
    html += `<div class="label">Common combos</div>`;
    html += `<div class="explore-combos">${data.common_combos.map((c) =>
      `<span class="explore-combo">${esc(c)}</span>`
    ).join("")}</div>`;
  }

  // Variations
  if (data.variations && data.variations.length > 0) {
    html += `<div class="label">Forms / Variations</div>`;
    for (const v of data.variations) {
      html += `<div class="explore-variation"><span class="var-form">${esc(v.form)}</span> <span class="var-meaning">${esc(v.meaning)}</span></div>`;
    }
  }

  // Culture note
  if (data.culture_note) {
    html += `<div class="note">${esc(data.culture_note)}</div>`;
  }

  // Phrases
  if (data.stolen_phrases && data.stolen_phrases.length > 0) {
    html += phraseTags(data.stolen_phrases);
  }

  html += `</div>`;
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

function renderStats() { loadProgress(); }

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

  for (const p of data.phrases) {
    if (!cachedPhraseTranslations[p.phrase]) translatePhraseForList(p.phrase);
  }

  phrasesList.querySelectorAll(".phrase-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const phrase = btn.dataset.phrase;
      await fetch("/api/progress/phrases/" + encodeURIComponent(phrase), { method: "DELETE" });
      btn.closest(".phrase-item").remove();
      $("#phrase-count").textContent = phrasesList.querySelectorAll(".phrase-item").length;
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
    for (const item of $$("#stolen-phrases-list .phrase-item")) {
      if (item.querySelector(".phrase-sv")?.textContent === phrase) {
        item.querySelector(".phrase-en").textContent = data.translation;
      }
    }
  } catch {}
}

$("#select-all-phrases").addEventListener("click", () => {
  const boxes = $$("#stolen-phrases-list input[type='checkbox']");
  const allChecked = [...boxes].every((b) => b.checked);
  boxes.forEach((b) => (b.checked = !allChecked));
});

$("#delete-selected-phrases").addEventListener("click", async () => {
  const checked = $$("#stolen-phrases-list input[type='checkbox']:checked");
  if (checked.length === 0) return;
  for (const box of checked) {
    await fetch("/api/progress/phrases/" + encodeURIComponent(box.dataset.phrase), { method: "DELETE" });
    box.closest(".phrase-item").remove();
  }
  $("#phrase-count").textContent = $$("#stolen-phrases-list .phrase-item").length;
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

// --- Add phrase manually ---
$("#add-phrase-btn").addEventListener("click", () => {
  $("#add-phrase-form").classList.remove("hidden");
  $("#add-phrase-input").focus();
});

$("#add-phrase-cancel").addEventListener("click", () => {
  $("#add-phrase-form").classList.add("hidden");
  $("#add-phrase-input").value = "";
});

$("#add-phrase-submit").addEventListener("click", async () => {
  const phrase = $("#add-phrase-input").value.trim();
  if (!phrase) return;
  await fetch("/api/progress/phrases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phrases: [phrase] }),
  });
  $("#add-phrase-input").value = "";
  $("#add-phrase-form").classList.add("hidden");
  loadProgress();
});

$("#add-phrase-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#add-phrase-submit").click();
  if (e.key === "Escape") $("#add-phrase-cancel").click();
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

    const printDiv = document.createElement("div");
    printDiv.id = "print-report-container";
    printDiv.style.display = "none";
    printDiv.innerHTML = `<div id="print-report">${buildPrintReport(report)}</div>`;
    document.body.appendChild(printDiv);

    $("#btn-print-report").addEventListener("click", () => window.print());
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
  let html = `<h1>Svenska Tranaren</h1>`;
  html += `<div class="rpt-meta">${esc(r.date)} | ${esc(r.username)} | ${r.total_mistakes} mistakes tracked</div>`;

  if (r.phrase_of_day) {
    const p = r.phrase_of_day;
    html += `<div class="rpt-potd"><h2>Phrase of the Day</h2><div class="rpt-potd-phrase">${esc(p.phrase)}</div><div>${esc(p.meaning)}</div><div style="margin-top:3pt"><em>${esc(p.example_swedish)}</em> — ${esc(p.example_english)}</div></div>`;
  }

  if (r.macro_en) {
    html += `<h2>Key Issues</h2><div class="rpt-block-en">${esc(r.macro_en)}</div><div class="rpt-block-sv">${esc(r.macro_sv)}</div>`;
  }

  if (r.top_mistakes && r.top_mistakes.length > 0) {
    html += `<h2>Mistake Patterns</h2>`;
    for (const m of r.top_mistakes) {
      html += `<div class="rpt-pattern"><strong>${esc(m.pattern)}</strong><br>`;
      if (m.examples) { for (const e of m.examples) html += `<span class="rpt-example">${esc(e)}</span> `; html += `<br>`; }
      html += `<div class="rpt-block-en">${esc(m.rule_en)}</div><div class="rpt-block-sv">${esc(m.rule_sv)}</div></div>`;
    }
  }

  if (r.focus && r.focus.length > 0) {
    html += `<h2>Focus Areas</h2>`;
    for (const f of r.focus) html += `<div class="rpt-focus">• ${esc(f)}</div>`;
  }

  if (r.phrases_list && r.phrases_list.length > 0) {
    html += `<h2>Stolen Phrases (${r.phrases_list.length})</h2><div class="rpt-phrases">`;
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
  if (text.length < 2 || text.length > 500) return;

  const anchor = sel.anchorNode;
  if (!anchor || !anchor.parentElement) return;
  const inApp = anchor.parentElement.closest(".chat-messages, .bubble, .report-preview, .potd-card, .stats-content");
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
  const btn = $("#select-add-phrase");
  btn.textContent = "Added!";
  setTimeout(() => { btn.textContent = "Add to Stolen Phrases"; }, 1500);
});

// --- "Not natural" casual correction ---
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-not-natural");
  if (!btn) return;

  const card = document.getElementById(btn.dataset.card);
  if (!card || card.querySelector(".casual-correction-form")) return;

  const aiSaid = btn.dataset.casual;
  btn.style.display = "none";

  const form = document.createElement("div");
  form.className = "casual-correction-form";
  form.innerHTML = `
    <div class="correction-label">How would a real Swede say it?</div>
    <input type="text" class="correction-input" placeholder="e.g. Kom över ikväll!">
    <div class="correction-actions">
      <button class="btn-primary btn-small correction-submit">Save</button>
      <button class="btn-ghost btn-tiny correction-cancel">Cancel</button>
    </div>
  `;
  card.appendChild(form);

  const input = form.querySelector(".correction-input");
  input.focus();

  form.querySelector(".correction-submit").addEventListener("click", async () => {
    const userSaid = input.value.trim();
    if (!userSaid) return;

    await fetch("/api/casual-correction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai_said: aiSaid, user_said: userSaid }),
    });

    form.innerHTML = `<div class="correction-saved">Saved! The app will learn from this.</div>`;
    setTimeout(() => form.remove(), 2000);
  });

  form.querySelector(".correction-cancel").addEventListener("click", () => {
    form.remove();
    btn.style.display = "";
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") form.querySelector(".correction-submit").click();
  });
});

// --- Init ---
checkAuth();
