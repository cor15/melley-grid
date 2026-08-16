// --- Ribbon tabs ---
document.querySelectorAll(".ribbon-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".ribbon-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".ribbon-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`.ribbon-panel[data-panel="${tab.dataset.tab}"]`).classList.add("active");
  });
});

// The Data tab has its own Import/Export buttons that just trigger the same actions
// as the title bar's — kept in sync so either location works.
document.getElementById("ribbon-import-btn")?.addEventListener("click", () => {
  document.getElementById("import-input").click();
});
document.getElementById("ribbon-export-btn")?.addEventListener("click", () => {
  document.getElementById("export-btn").click();
});

// --- Grid setup ---
const spreadsheet = x_spreadsheet("#grid", {
  showToolbar: true,
  showGrid: true,
  view: {
    height: () => document.getElementById("grid").clientHeight,
    width: () => document.getElementById("grid").clientWidth,
  },
}).loadData({});

let currentSheetId = null;
let applyingProgrammatically = false; // guards against automation rules re-triggering themselves
let rules = []; // loaded from backend
const ruleDebounce = new Map(); // rule id -> timeout handle

// --- Helpers: cell address <-> row/col ---
function cellToRowCol(cell) {
  const match = cell.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  const [, colLetters, rowStr] = match;
  let col = 0;
  for (const ch of colLetters.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { ri: parseInt(rowStr, 10) - 1, ci: col - 1 };
}

function rowColToCell(ri, ci) {
  let col = ci + 1;
  let colLetters = "";
  while (col > 0) {
    const rem = (col - 1) % 26;
    colLetters = String.fromCharCode(65 + rem) + colLetters;
    col = Math.floor((col - 1) / 26);
  }
  return `${colLetters}${ri + 1}`;
}

function parseRange(range) {
  const [startStr, endStr] = range.includes(":") ? range.split(":") : [range, range];
  const start = cellToRowCol(startStr);
  const end = cellToRowCol(endStr);
  if (!start || !end) return null;
  return {
    minRi: Math.min(start.ri, end.ri),
    maxRi: Math.max(start.ri, end.ri),
    minCi: Math.min(start.ci, end.ci),
    maxCi: Math.max(start.ci, end.ci),
  };
}

function cellInRange(ri, ci, range) {
  const r = parseRange(range);
  if (!r) return false;
  return ri >= r.minRi && ri <= r.maxRi && ci >= r.minCi && ci <= r.maxCi;
}

// --- Flat grid snapshot (row-major array of cell text), used for diffing and charts ---
function getFlatGrid() {
  const raw = spreadsheet.getData();
  const sheet = Array.isArray(raw) ? raw[0] : raw;
  const rowsObj = sheet?.rows || {};
  const grid = [];
  Object.keys(rowsObj)
    .filter((k) => k !== "len")
    .forEach((riStr) => {
      const ri = parseInt(riStr, 10);
      const cells = rowsObj[riStr]?.cells || {};
      const row = grid[ri] || [];
      Object.keys(cells).forEach((ciStr) => {
        row[parseInt(ciStr, 10)] = cells[ciStr]?.text ?? "";
      });
      grid[ri] = row;
    });
  return grid;
}

let lastSnapshot = getFlatGrid();

// --- Assumptions panel: surfaces which inputs the AI flagged as editable ---
let assumptions = {}; // cell address -> { label, value }

function trackAssumptions(actions) {
  actions.forEach((action) => {
    if (action.type === "set_cell" && action.editable) {
      assumptions[action.cell] = { label: action.label || action.cell, value: action.value };
    } else if (action.type === "set_range" && action.editable) {
      const start = cellToRowCol(action.start);
      if (!start) return;
      action.values.forEach((row, rOffset) => {
        row.forEach((val, cOffset) => {
          const cell = rowColToCell(start.ri + rOffset, start.ci + cOffset);
          assumptions[cell] = { label: action.label || cell, value: val };
        });
      });
    }
  });
  renderAssumptions();
}

function renderAssumptions() {
  const panel = document.getElementById("assumptions-panel");
  const entries = Object.entries(assumptions);
  if (entries.length === 0) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }
  panel.classList.remove("hidden");
  panel.innerHTML = `<div class="assumptions-title">Editable assumptions</div>` +
    entries.map(([cell, info]) =>
      `<div class="assumption-row"><span class="assumption-cell">${cell}</span><span class="assumption-label">${info.label}</span><span class="assumption-value">${info.value}</span></div>`
    ).join("");
}

function applyActions(actions) {
  applyingProgrammatically = true;
  actions.forEach((action) => {
    if (action.type === "set_cell") {
      const pos = cellToRowCol(action.cell);
      if (pos) spreadsheet.cellText(pos.ri, pos.ci, String(action.value));
    } else if (action.type === "set_range") {
      const start = cellToRowCol(action.start);
      if (!start) return;
      action.values.forEach((row, rOffset) => {
        row.forEach((val, cOffset) => {
          spreadsheet.cellText(start.ri + rOffset, start.ci + cOffset, String(val));
        });
      });
    } else if (action.type === "insert_chart") {
      renderChart(action);
    }
  });
  lastSnapshot = getFlatGrid();
  // Release the guard on the next tick, after x-spreadsheet's change event has fired for these writes.
  setTimeout(() => { applyingProgrammatically = false; }, 50);
}

function getGridState() {
  return spreadsheet.getData();
}

// --- Charts ---
const chartInstances = [];

function renderChart(action) {
  const range = action.data_range;
  const r = parseRange(range || "");
  const grid = getFlatGrid();
  const panel = document.getElementById("charts-panel");

  const card = document.createElement("div");
  card.className = "chart-card";
  const title = document.createElement("h4");
  title.textContent = action.title || `Chart (${range || "?"})`;
  const canvas = document.createElement("canvas");
  card.appendChild(title);
  card.appendChild(canvas);
  panel.appendChild(card);

  if (!r) return; // no valid range — leave an empty card rather than crash

  // First column in range = labels, remaining columns = one dataset each.
  const labels = [];
  const datasetCols = [];
  for (let ci = r.minCi + 1; ci <= r.maxCi; ci++) datasetCols.push(ci);

  const datasets = datasetCols.map((ci) => ({ label: rowColToCell(r.minRi, ci), data: [] }));

  for (let ri = r.minRi; ri <= r.maxRi; ri++) {
    labels.push(grid[ri]?.[r.minCi] ?? "");
    datasetCols.forEach((ci, idx) => {
      const raw = grid[ri]?.[ci];
      const num = parseFloat(raw);
      datasets[idx].data.push(isNaN(num) ? 0 : num);
    });
  }

  const chart = new Chart(canvas, {
    type: action.chart_type === "bar" ? "bar" : action.chart_type === "pie" ? "pie" : "line",
    data: { labels, datasets },
    options: { responsive: true, plugins: { legend: { display: datasets.length > 1 } } },
  });
  chartInstances.push(chart);
}

// --- Chat ---
const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

function logMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (role === "assistant") {
    div.innerHTML = renderLightMarkdown(text);
  } else {
    div.textContent = text;
  }
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// Minimal markdown: "## " headers, "- " bullets, "**bold**". Enough to render
// the structured summaries the backend is prompted to produce, without pulling
// in a full markdown library for a personal tool.
function renderLightMarkdown(text) {
  const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = text.split("\n");
  let html = "";
  let inList = false;
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h4 class="msg-heading">${escapeHtml(trimmed.slice(3))}</h4>`;
    } else if (trimmed.startsWith("- ")) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${boldify(escapeHtml(trimmed.slice(2)))}</li>`;
    } else if (trimmed === "") {
      if (inList) { html += "</ul>"; inList = false; }
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<p>${boldify(escapeHtml(trimmed))}</p>`;
    }
  });
  if (inList) html += "</ul>";
  return html;
}

function boldify(escapedText) {
  return escapedText.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

async function runInstruction(instruction) {
  const res = await fetch(`${API_BASE}/parse-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction, grid_state: getGridState() }),
  });
  return res.json();
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const instruction = chatInput.value.trim();
  if (!instruction) return;
  logMessage("user", instruction);
  chatInput.value = "";

  try {
    const data = await runInstruction(instruction);
    const actionCount = data.actions?.length || 0;
    if (actionCount > 0) { applyActions(data.actions); trackAssumptions(data.actions); }

    if (data.analysis && data.analysis.trim()) {
      logMessage("assistant", data.analysis.trim());
    } else if (actionCount > 0) {
      logMessage("assistant", `Applied ${actionCount} change(s).`);
    } else {
      logMessage("assistant", "No changes or analysis returned — try rephrasing.");
    }
  } catch (err) {
    logMessage("assistant", `Error: ${err.message}`);
  }
});

// --- Automation: watch for grid edits, match against rules, auto-run ---
spreadsheet.on("change", () => {
  if (applyingProgrammatically) return; // don't let our own writes re-trigger rules
  const newSnapshot = getFlatGrid();
  const changedCells = [];

  const maxRows = Math.max(newSnapshot.length, lastSnapshot.length);
  for (let ri = 0; ri < maxRows; ri++) {
    const oldRow = lastSnapshot[ri] || [];
    const newRow = newSnapshot[ri] || [];
    const maxCols = Math.max(oldRow.length, newRow.length);
    for (let ci = 0; ci < maxCols; ci++) {
      if ((oldRow[ci] ?? "") !== (newRow[ci] ?? "")) changedCells.push({ ri, ci });
    }
  }
  lastSnapshot = newSnapshot;
  if (changedCells.length === 0) return;

  rules.forEach((rule) => {
    const matched = changedCells.some((c) => cellInRange(c.ri, c.ci, rule.trigger_range));
    if (!matched) return;
    // Debounce: if the user is actively typing across several cells in the range,
    // wait briefly so we fire once instead of once per keystroke/cell.
    clearTimeout(ruleDebounce.get(rule.id));
    ruleDebounce.set(
      rule.id,
      setTimeout(async () => {
        logMessage("assistant", `Automation "${rule.instruction}" triggered.`);
        try {
          const data = await runInstruction(rule.instruction);
          if (data.actions?.length) { applyActions(data.actions); trackAssumptions(data.actions); }
          if (data.analysis && data.analysis.trim()) logMessage("assistant", data.analysis.trim());
        } catch (err) {
          logMessage("assistant", `Automation error: ${err.message}`);
        }
      }, 800)
    );
  });
});

// --- Automation modal ---
const automationModal = document.getElementById("automation-modal");
const rulesList = document.getElementById("rules-list");

async function loadRules() {
  try {
    const url = currentSheetId ? `${API_BASE}/rules?sheet_id=${currentSheetId}` : `${API_BASE}/rules`;
    const res = await fetch(url);
    rules = await res.json();
    renderRulesList();
  } catch (err) {
    console.error("Failed to load rules:", err);
  }
}

function renderRulesList() {
  rulesList.innerHTML = "";
  if (rules.length === 0) {
    rulesList.innerHTML = '<p style="font-size:12px;color:#888;">No automation rules yet.</p>';
    return;
  }
  rules.forEach((rule) => {
    const item = document.createElement("div");
    item.className = "rule-item";
    const text = document.createElement("div");
    text.className = "rule-text";
    text.innerHTML = `<span class="rule-range">${rule.trigger_range}</span> → ${rule.instruction}`;
    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      await fetch(`${API_BASE}/rules/${rule.id}`, { method: "DELETE" });
      loadRules();
    });
    item.appendChild(text);
    item.appendChild(delBtn);
    rulesList.appendChild(item);
  });
}

document.getElementById("automation-btn").addEventListener("click", () => {
  automationModal.classList.remove("hidden");
  loadRules();
});
document.getElementById("automation-close").addEventListener("click", () => {
  automationModal.classList.add("hidden");
});

document.getElementById("rule-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const trigger_range = document.getElementById("rule-range").value.trim();
  const instruction = document.getElementById("rule-instruction").value.trim();
  if (!trigger_range || !instruction) return;
  await fetch(`${API_BASE}/rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheet_id: currentSheetId, trigger_range, instruction }),
  });
  document.getElementById("rule-form").reset();
  loadRules();
});

// --- Save ---
document.getElementById("save-btn").addEventListener("click", async () => {
  const name = document.getElementById("sheet-name").value || "Untitled sheet";
  const data = getGridState();
  try {
    if (currentSheetId) {
      await fetch(`${API_BASE}/sheets/${currentSheetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, data }),
      });
    } else {
      const res = await fetch(`${API_BASE}/sheets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, data }),
      });
      const saved = await res.json();
      currentSheetId = saved.id;
    }
    logMessage("assistant", "Saved.");
  } catch (err) {
    logMessage("assistant", `Save failed: ${err.message}`);
  }
});

// --- Import ---
document.getElementById("import-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await fetch(`${API_BASE}/import`, { method: "POST", body: formData });
    const data = await res.json();
    applyingProgrammatically = true;
    data.grid.forEach((row, ri) => {
      row.forEach((val, ci) => spreadsheet.cellText(ri, ci, String(val ?? "")));
    });
    lastSnapshot = getFlatGrid();
    setTimeout(() => { applyingProgrammatically = false; }, 50);
    logMessage("assistant", `Imported ${file.name}.`);
  } catch (err) {
    logMessage("assistant", `Import failed: ${err.message}`);
  }
});

// --- Export ---
document.getElementById("export-btn").addEventListener("click", async () => {
  const name = document.getElementById("sheet-name").value || "sheet";
  const grid = getFlatGrid();

  try {
    const res = await fetch(`${API_BASE}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, grid }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    logMessage("assistant", `Export failed: ${err.message}`);
  }
});

// Load any existing automation rules on startup
loadRules();
