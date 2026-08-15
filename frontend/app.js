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

// --- Helpers: cell address <-> row/col ---
function cellToRowCol(cell) {
  const match = cell.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  const [, colLetters, rowStr] = match;
  let col = 0;
  for (const ch of colLetters.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { ri: parseInt(rowStr, 10) - 1, ci: col - 1 };
}

function applyActions(actions) {
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
      // Chart insertion left as a follow-up — x-spreadsheet doesn't support
      // native charts out of the box; log for now so nothing is silently lost.
      console.log("Chart requested (not yet rendered):", action);
    }
  });
}

function getGridState() {
  // Simplified snapshot: x-spreadsheet's own data model, sent as-is to the backend.
  return spreadsheet.getData();
}

// --- Chat ---
const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

function logMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const instruction = chatInput.value.trim();
  if (!instruction) return;
  logMessage("user", instruction);
  chatInput.value = "";

  try {
    const res = await fetch(`${API_BASE}/parse-prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction, grid_state: getGridState() }),
    });
    const data = await res.json();
    applyActions(data.actions || []);
    logMessage("assistant", `Applied ${data.actions?.length || 0} change(s).`);
  } catch (err) {
    logMessage("assistant", `Error: ${err.message}`);
  }
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
    data.grid.forEach((row, ri) => {
      row.forEach((val, ci) => spreadsheet.cellText(ri, ci, String(val ?? "")));
    });
    logMessage("assistant", `Imported ${file.name}.`);
  } catch (err) {
    logMessage("assistant", `Import failed: ${err.message}`);
  }
});

// --- Export ---
document.getElementById("export-btn").addEventListener("click", async () => {
  const name = document.getElementById("sheet-name").value || "sheet";
  // Flatten x-spreadsheet's internal data into a simple row-major grid for export.
  const raw = getGridState();
  const rows = raw?.rows || {};
  const grid = [];
  Object.keys(rows)
    .filter((k) => k !== "len")
    .forEach((ri) => {
      const rowData = rows[ri]?.cells || {};
      const rowArr = [];
      Object.keys(rowData).forEach((ci) => {
        rowArr[parseInt(ci, 10)] = rowData[ci]?.text ?? "";
      });
      grid[parseInt(ri, 10)] = rowArr;
    });

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
