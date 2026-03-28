// --- State ---
const conversationHistory = [];

const SITUATIONS = [
  "You're at a café in Stockholm and want to order a coffee and a cinnamon bun.",
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
const loading = $("#loading-overlay");

// --- Tabs ---
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $$(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    const mode = tab.dataset.mode;
    $(`#panel-${mode}`).classList.add("active");
    if (mode === "stats") renderStats();
  });
});

// --- Situations ---
$("#new-situation").addEventListener("click", () => {
  const idx = Math.floor(Math.random() * SITUATIONS.length);
  $("#situation-text").textContent = SITUATIONS[idx];
});

// --- Send buttons ---
$$(".send-btn").forEach((btn) => {
  btn.addEventListener("click", () => handleSend(btn.dataset.mode));
});

// Ctrl+Enter to send
$$("textarea").forEach((ta) => {
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      const panel = ta.closest(".panel");
      const btn = panel.querySelector(".send-btn");
      if (btn) btn.click();
    }
  });
});

// --- Clear conversation ---
$("#clear-conversation").addEventListener("click", () => {
  conversationHistory.length = 0;
  $("#conversation-log").innerHTML = "";
});

// --- API call ---
async function apiChat(mode, messages) {
  loading.classList.remove("hidden");
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
    loading.classList.add("hidden");
  }
}

// --- Handle Send ---
async function handleSend(mode) {
  let userText, messages;

  switch (mode) {
    case "situation-respond": {
      const situation = $("#situation-text").textContent;
      userText = $("#input-situation").value.trim();
      if (!userText || situation.startsWith("Click")) return;
      messages = [
        { role: "user", content: `Situation: ${situation}\n\nMy response: ${userText}` },
      ];
      $("#input-situation").value = "";
      break;
    }
    case "correct-me": {
      userText = $("#input-correct").value.trim();
      if (!userText) return;
      messages = [{ role: "user", content: userText }];
      $("#input-correct").value = "";
      break;
    }
    case "conversation": {
      userText = $("#input-conversation").value.trim();
      if (!userText) return;
      conversationHistory.push({ role: "user", content: userText });
      appendConvMessage("user", userText);
      messages = [...conversationHistory];
      $("#input-conversation").value = "";
      break;
    }
    case "rewrite": {
      userText = $("#input-rewrite").value.trim();
      if (!userText) return;
      messages = [{ role: "user", content: userText }];
      $("#input-rewrite").value = "";
      break;
    }
    default:
      return;
  }

  try {
    const data = await apiChat(mode, messages);

    if (data.raw) {
      renderRawFeedback(mode, data.raw);
      return;
    }

    switch (mode) {
      case "situation-respond":
        renderSituationFeedback(data);
        break;
      case "correct-me":
        renderCorrectFeedback(data);
        break;
      case "conversation":
        renderConversationResponse(data);
        break;
      case "rewrite":
        renderRewriteFeedback(data);
        break;
    }

    // Save to localStorage
    saveStolenPhrases(data.stolen_phrases);
    saveMistakes(data.mistakes || data.corrections);
  } catch (err) {
    alert("Error: " + err.message);
  }
}

// --- Renderers ---

function renderRawFeedback(mode, text) {
  const container =
    mode === "conversation"
      ? $("#conversation-log")
      : $(`#feedback-${mode}`);
  container.innerHTML = `<div class="feedback-card"><p>${escHtml(text)}</p></div>`;
}

function ratingBadge(rating) {
  if (!rating) return "";
  return `<span class="rating-badge rating-${rating}">${rating.replace("_", " ")}</span>`;
}

function mistakesHtml(mistakes) {
  if (!mistakes || mistakes.length === 0) return "";
  return `
    <div class="feedback-card">
      <h3>Corrections</h3>
      ${mistakes
        .map(
          (m) => `
        <div class="mistake-item">
          <span class="original">${escHtml(m.original)}</span> → <span class="corrected">${escHtml(m.corrected)}</span>
          <div class="explanation">${escHtml(m.explanation)}</div>
        </div>`
        )
        .join("")}
    </div>`;
}

function phrasesHtml(phrases) {
  if (!phrases || phrases.length === 0) return "";
  return `
    <div class="feedback-card">
      <h3>Stolen Phrases</h3>
      <div>${phrases.map((p) => `<span class="phrase-chip">${escHtml(p)}</span>`).join(" ")}</div>
    </div>`;
}

function renderSituationFeedback(data) {
  const el = $("#feedback-situation-respond");
  el.innerHTML = `
    ${ratingBadge(data.rating)}
    <div class="feedback-card">
      <h3>Corrected</h3>
      <p class="swedish-text">${escHtml(data.corrected)}</p>
    </div>
    ${mistakesHtml(data.mistakes)}
    <div class="feedback-card">
      <h3>Natural Swedish</h3>
      <p class="swedish-text">${escHtml(data.natural_version)}</p>
    </div>
    <div class="feedback-card">
      <h3>Feedback</h3>
      <p>${escHtml(data.feedback)}</p>
    </div>
    ${phrasesHtml(data.stolen_phrases)}
  `;
}

function renderCorrectFeedback(data) {
  const el = $("#feedback-correct-me");
  el.innerHTML = `
    ${ratingBadge(data.rating)}
    <div class="feedback-card">
      <h3>Corrected</h3>
      <p class="swedish-text">${escHtml(data.corrected)}</p>
    </div>
    ${mistakesHtml(data.mistakes)}
    <div class="feedback-card">
      <h3>Natural Version</h3>
      <p class="swedish-text">${escHtml(data.natural_version)}</p>
    </div>
    <div class="feedback-card">
      <h3>Feedback</h3>
      <p>${escHtml(data.feedback)}</p>
    </div>
    ${phrasesHtml(data.stolen_phrases)}
  `;
}

function renderConversationResponse(data) {
  if (data.corrections && data.corrections.length > 0) {
    const corrDiv = document.createElement("div");
    corrDiv.className = "conv-corrections";
    corrDiv.innerHTML = data.corrections
      .map((c) => `<span class="original">${escHtml(c.original)}</span> → <span class="corrected">${escHtml(c.corrected)}</span> <em>(${escHtml(c.explanation)})</em>`)
      .join("<br>");
    $("#conversation-log").appendChild(corrDiv);
  }

  appendConvMessage("assistant", data.reply_swedish, data.reply_english);

  conversationHistory.push({
    role: "assistant",
    content: data.reply_swedish,
  });

  if (data.feedback) {
    const fb = document.createElement("div");
    fb.className = "conv-corrections";
    fb.textContent = data.feedback;
    $("#conversation-log").appendChild(fb);
  }

  scrollConversation();
}

function appendConvMessage(role, text, translation) {
  const div = document.createElement("div");
  div.className = `conv-msg ${role}`;
  div.innerHTML = `<p>${escHtml(text)}</p>`;
  if (translation) {
    div.innerHTML += `<p class="translation">${escHtml(translation)}</p>`;
  }
  $("#conversation-log").appendChild(div);
  scrollConversation();
}

function scrollConversation() {
  const log = $("#conversation-log");
  log.scrollTop = log.scrollHeight;
}

function renderRewriteFeedback(data) {
  const el = $("#feedback-rewrite");
  el.innerHTML = `
    <div class="feedback-card">
      <h3>Swedish Translation</h3>
      <p class="swedish-text">${escHtml(data.swedish)}</p>
    </div>
    <div class="feedback-card">
      <h3>Word-by-Word Breakdown</h3>
      <p>${escHtml(data.literal_breakdown)}</p>
    </div>
    ${
      data.grammar_notes
        ? `<div class="feedback-card">
            <h3>Grammar Notes</h3>
            ${data.grammar_notes.map((n) => `<div class="grammar-note">${escHtml(n)}</div>`).join("")}
          </div>`
        : ""
    }
    ${
      data.alternatives
        ? `<div class="feedback-card">
            <h3>Alternatives</h3>
            ${data.alternatives.map((a) => `<p class="swedish-text">${escHtml(a)}</p>`).join("")}
          </div>`
        : ""
    }
    ${phrasesHtml(data.stolen_phrases)}
  `;
}

// --- localStorage ---

function saveStolenPhrases(phrases) {
  if (!phrases || phrases.length === 0) return;
  const saved = JSON.parse(localStorage.getItem("sv_phrases") || "[]");
  for (const p of phrases) {
    if (!saved.includes(p)) saved.push(p);
  }
  localStorage.setItem("sv_phrases", JSON.stringify(saved));
}

function saveMistakes(mistakes) {
  if (!mistakes || mistakes.length === 0) return;
  const saved = JSON.parse(localStorage.getItem("sv_mistakes") || "{}");
  for (const m of mistakes) {
    const key = `${m.original} → ${m.corrected}`;
    saved[key] = (saved[key] || 0) + 1;
  }
  localStorage.setItem("sv_mistakes", JSON.stringify(saved));
}

function renderStats() {
  // Phrases
  const phrases = JSON.parse(localStorage.getItem("sv_phrases") || "[]");
  const phrasesList = $("#stolen-phrases-list");
  phrasesList.innerHTML = phrases
    .map((p) => `<div class="stats-phrase">${escHtml(p)}</div>`)
    .join("");

  // Mistakes
  const mistakes = JSON.parse(localStorage.getItem("sv_mistakes") || "{}");
  const mistakesList = $("#mistakes-list");
  const sorted = Object.entries(mistakes).sort((a, b) => b[1] - a[1]);
  mistakesList.innerHTML = sorted
    .map(
      ([k, v]) =>
        `<div class="stats-mistake">${escHtml(k)} <span class="count">(×${v})</span></div>`
    )
    .join("");
}

$("#clear-phrases").addEventListener("click", () => {
  localStorage.removeItem("sv_phrases");
  renderStats();
});

$("#clear-mistakes").addEventListener("click", () => {
  localStorage.removeItem("sv_mistakes");
  renderStats();
});

// --- Utility ---
function escHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
