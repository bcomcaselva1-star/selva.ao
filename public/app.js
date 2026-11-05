const searchInput = document.getElementById("searchInput");
const modelSelect = document.getElementById("modelSelect");
const answerBox = document.getElementById("answerBox");
const sourceBox = document.getElementById("sourceBox");
const chatList = document.getElementById("chatList");
const connStatus = document.getElementById("connStatus");
const keyStatus = document.getElementById("keyStatus");
const canvas = document.getElementById("chart");
const ctx = canvas.getContext("2d");

const chats = [];
const throughput = new Array(40).fill(8);
let autoPoll = true;
let pollTimer = null;
let conversationTokens = 0;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function estimateTokens(text) {
  return Math.max(1, Math.round(String(text).length / 4));
}

function setMetrics({ latencyMs, tokens, velocity }) {
  if (latencyMs != null) {
    document.getElementById("valLatency").textContent = `${latencyMs} ms`;
    document.getElementById("liveLatency").textContent = `${latencyMs} ms`;
  }
  if (tokens != null) {
    conversationTokens += tokens;
    document.getElementById("valContext").textContent = conversationTokens.toLocaleString();
    document.getElementById("ctxUsed").textContent = conversationTokens.toLocaleString();
    document.getElementById("ctxBar").style.width = `${Math.min(100, (conversationTokens / 1_000_000) * 100)}%`;
  }
  if (velocity != null) {
    document.getElementById("valVelocity").textContent = velocity.toLocaleString();
    document.getElementById("valVelocitySub").textContent = "chars / sec";
  }
}

function drawChart() {
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#2a1a46";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, (height / 4) * i);
    ctx.lineTo(width, (height / 4) * i);
    ctx.stroke();
  }
  const max = Math.max(20, ...throughput);
  const step = width / (throughput.length - 1);
  ctx.beginPath();
  throughput.forEach((value, index) => {
    const x = index * step;
    const y = height - (value / max) * (height - 16) - 8;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#c084fc";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.fillStyle = "rgba(192, 132, 252, 0.16)";
  ctx.fill();
}

function pushThroughput(value) {
  throughput.push(value);
  throughput.shift();
  drawChart();
}

function renderChats(items, activeId) {
  const groups = {};
  items.forEach((item) => {
    groups[item.group] ||= [];
    groups[item.group].push(item);
  });
  chatList.innerHTML = Object.entries(groups)
    .map(
      ([group, rows]) =>
        `<div class="tiny">${escapeHtml(group)}</div>` +
        rows
          .map(
            (row) => `<button class="chat-item ${row.id === activeId ? "active" : ""}" data-id="${escapeHtml(row.id)}">
              <span>${escapeHtml(row.title)}</span>
              <small>${escapeHtml(row.meta || "")}</small>
            </button>`
          )
          .join("")
    )
    .join("");
}

function renderSources(sources) {
  sourceBox.innerHTML = (sources || [])
    .map((source) => {
      const body = `<b>${escapeHtml(source.kind || "source")}</b>${escapeHtml(source.title)}${source.snippet ? ` — ${escapeHtml(source.snippet).slice(0, 140)}` : ""}`;
      if (source.url) return `<a class="source" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${body}</a>`;
      return `<div class="source">${body}</div>`;
    })
    .join("");
}

async function loadIndex() {
  const response = await fetch("/api/index");
  const data = await response.json();
  const seeded = data.items.map((item) => ({ ...item }));
  chats.splice(0, chats.length, ...seeded);
  renderChats(chats, chats[0]?.id);
}

async function checkStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    connStatus.textContent = "HTTP connected";
    keyStatus.textContent = data.geminiConfigured
      ? `Gemini is configured (${data.defaultModel}).`
      : "Gemini key missing. Workspace/web search still works; add GEMINI_API_KEY for full answers.";
  } catch {
    connStatus.textContent = "server offline";
  }
}

async function runSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  const model = modelSelect.value;
  document.getElementById("engineLabel").textContent = model;
  document.getElementById("streamId").textContent = `slv_${Date.now().toString(36)}`;
  answerBox.classList.remove("muted");
  answerBox.textContent = "Searching index and generating an answer…";
  sourceBox.innerHTML = "";

  const started = Date.now();
  let assembled = "";
  let lastTick = started;
  let charsSinceTick = 0;

  const response = await fetch("/api/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ query, model, stream: true }),
  });

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const data = await response.json();
    if (data.error) {
      answerBox.textContent = data.error;
      return;
    }
    if (data.type === "image") {
      answerBox.innerHTML = `<div>${escapeHtml(data.output)}</div><img src="${escapeHtml(data.mediaUrl)}" alt="${escapeHtml(data.title)}" />`;
    } else {
      answerBox.textContent = data.output || "No answer.";
    }
    renderSources(data.sources);
    setMetrics({ latencyMs: data.latencyMs, tokens: estimateTokens(data.output || "") });
    chats.unshift({
      id: `chat_${Date.now()}`,
      title: query.slice(0, 48),
      group: "TODAY",
      summary: data.output || data.title || "",
    });
    renderChats(chats, chats[0].id);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  answerBox.textContent = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const line = frame.split("\n").find((entry) => entry.startsWith("data:"));
      if (!line) continue;
      const payload = JSON.parse(line.replace(/^data:\s*/, ""));
      if (payload.type === "meta") {
        renderSources(payload.sources);
        setMetrics({ latencyMs: payload.latencyMs });
      } else if (payload.type === "delta") {
        assembled += payload.text;
        answerBox.textContent = assembled;
        charsSinceTick += payload.text.length;
        const elapsed = Date.now() - lastTick;
        if (elapsed >= 250) {
          const velocity = Math.round((charsSinceTick / elapsed) * 1000);
          setMetrics({ latencyMs: payload.latencyMs, velocity });
          pushThroughput(Math.max(6, velocity / 8));
          lastTick = Date.now();
          charsSinceTick = 0;
        }
      } else if (payload.type === "done") {
        const tokens = payload.usage?.totalTokenCount || estimateTokens(assembled);
        setMetrics({ latencyMs: payload.latencyMs, tokens });
      } else if (payload.type === "error") {
        answerBox.textContent = payload.error;
      }
    }
  }

  chats.unshift({
    id: `chat_${Date.now()}`,
    title: query.slice(0, 48),
    group: "TODAY",
    summary: assembled,
  });
  renderChats(chats, chats[0].id);
}

function showView(view) {
  document.getElementById("previewCard").style.display = view === "settings" ? "none" : "block";
  document.getElementById("settingsPanel").classList.toggle("show", view === "settings");
}

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") runSearch();
});
document.getElementById("askBtn").addEventListener("click", runSearch);
document.getElementById("newChatBtn").addEventListener("click", () => {
  searchInput.value = "";
  answerBox.classList.add("muted");
  answerBox.textContent = "New chat. Ask anything.";
  sourceBox.innerHTML = "";
  searchInput.focus();
});
document.getElementById("autoPoll").addEventListener("click", (event) => {
  event.currentTarget.classList.toggle("on");
  autoPoll = event.currentTarget.classList.contains("on");
});
document.getElementById("snapshotBtn").addEventListener("click", () => {
  const blob = new Blob([answerBox.innerText], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "selva-snapshot.txt";
  link.click();
  URL.revokeObjectURL(url);
});
document.getElementById("exportCodeBtn").addEventListener("click", () => {
  const payload = {
    query: searchInput.value,
    answer: answerBox.innerText,
    model: modelSelect.value,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "selva-answer.json";
  link.click();
  URL.revokeObjectURL(url);
});
document.getElementById("exportBtn").addEventListener("click", () => {
  document.getElementById("exportCodeBtn").click();
});
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    showView(button.dataset.view);
  });
});
chatList.addEventListener("click", (event) => {
  const item = event.target.closest(".chat-item");
  if (!item) return;
  const found = chats.find((chat) => chat.id === item.dataset.id);
  if (!found) return;
  renderChats(chats, found.id);
  answerBox.classList.remove("muted");
  answerBox.textContent = found.summary;
  searchInput.value = found.title;
});

pollTimer = setInterval(() => {
  if (autoPoll) pushThroughput(6 + Math.random() * 10);
}, 1000);

drawChart();
loadIndex();
checkStatus();
