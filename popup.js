// Floso — popup script
// Existing capsule capture/view/delete behavior is preserved.
// v1.2 adds a local token optimization workspace.

const listEl = document.getElementById("capsule-list");
const emptyEl = document.getElementById("empty-state");
const statusEl = document.getElementById("status-line");
const captureBtn = document.getElementById("capture-btn");
const listHeaderEl = document.getElementById("list-header");
const capsuleCountEl = document.getElementById("capsule-count");
const clearAllBtn = document.getElementById("clear-all-btn");

const contextTab = document.getElementById("context-tab");
const optimizeTab = document.getElementById("optimize-tab");
const contextView = document.getElementById("context-view");
const optimizeView = document.getElementById("optimize-view");
const contextActions = document.getElementById("context-actions");
const optimizerInput = document.getElementById("optimizer-input");
const optimizerOutput = document.getElementById("optimizer-output");
const modelSelect = document.getElementById("model-select");
const optimizationLevel = document.getElementById("optimization-level");
const runOptimizeBtn = document.getElementById("run-optimize-btn");
const copyOptimizedBtn = document.getElementById("copy-optimized-btn");
const originalTokensEl = document.getElementById("original-tokens");
const optimizedTokensEl = document.getElementById("optimized-tokens");
const savedPercentEl = document.getElementById("saved-percent");
const optimizationNote = document.getElementById("optimization-note");

let activePanel = "context";
let lastOptimization = null;

document.addEventListener("DOMContentLoaded", () => {
  renderCapsules();
  setupTabs();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.capsules) renderCapsules();
});

function setupTabs() {
  contextTab.addEventListener("click", () => switchPanel("context"));
  optimizeTab.addEventListener("click", () => switchPanel("optimize"));
  runOptimizeBtn.addEventListener("click", runOptimization);
  copyOptimizedBtn.addEventListener("click", copyOptimized);
  modelSelect.addEventListener("change", () => {
    if (optimizerInput.value.trim()) runOptimization();
  });
  optimizationLevel.addEventListener("change", () => {
    if (optimizerInput.value.trim()) runOptimization();
  });
}

function switchPanel(panel) {
  if (panel === activePanel) return;
  activePanel = panel;

  const showingOptimize = panel === "optimize";
  contextTab.classList.toggle("active", !showingOptimize);
  optimizeTab.classList.toggle("active", showingOptimize);
  contextTab.setAttribute("aria-selected", String(!showingOptimize));
  optimizeTab.setAttribute("aria-selected", String(showingOptimize));
  contextView.classList.toggle("floso-panel-active", !showingOptimize);
  optimizeView.classList.toggle("floso-panel-active", showingOptimize);
  contextView.setAttribute("aria-hidden", String(showingOptimize));
  optimizeView.setAttribute("aria-hidden", String(!showingOptimize));
  contextActions.classList.toggle("floso-view-hidden", showingOptimize);
}

captureBtn.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      showStatus("Floso: No active tab found.", true);
      return;
    }
    const SUPPORTED_PREFIXES = [
      "https://claude.ai/",
      "https://chatgpt.com/",
      "https://gemini.google.com/",
    ];
    const isSupported = tab.url && SUPPORTED_PREFIXES.some((p) => tab.url.startsWith(p));
    if (!isSupported) {
      showStatus("Floso: Open a claude.ai, chatgpt.com, or gemini.google.com conversation first.", true);
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "FLOSO_CAPTURE" }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus("Floso: Couldn't reach the page. Try refreshing the tab.", true);
        return;
      }
      showStatus("Floso: Capture requested…", false);
    });
  });
});

clearAllBtn.addEventListener("click", () => {
  const confirmed = window.confirm("Delete all saved capsules? This can't be undone.");
  if (!confirmed) return;
  chrome.storage.local.set({ capsules: [] }, () => renderCapsules());
});

function showStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", !!isError);
  statusEl.classList.add("show");
  setTimeout(() => statusEl.classList.remove("show"), 2600);
}

function renderCapsules() {
  chrome.storage.local.get({ capsules: [] }, (data) => {
    const capsules = data.capsules;
    listEl.innerHTML = "";

    if (!capsules.length) {
      emptyEl.hidden = false;
      listHeaderEl.hidden = true;
      return;
    }
    emptyEl.hidden = true;
    listHeaderEl.hidden = false;
    capsuleCountEl.textContent = `${capsules.length} capture${capsules.length === 1 ? "" : "s"}`;
    capsules.forEach((capsule) => listEl.appendChild(buildCapsuleCard(capsule)));
  });
}

function buildCapsuleCard(capsule) {
  const li = document.createElement("li");
  li.className = "floso-card";

  const top = document.createElement("div");
  top.className = "floso-card-top";
  const titleWrap = document.createElement("div");
  const title = document.createElement("p");
  title.className = "floso-card-title";
  title.textContent = capsule.title || "Untitled capsule";
  const meta = document.createElement("p");
  meta.className = "floso-card-meta";
  const dateStr = new Date(capsule.updatedAt || capsule.createdAt).toLocaleString();
  const siteClass = capsule.site === "chatgpt.com" ? "floso-site-badge--chatgpt" : capsule.site === "gemini.google.com" ? "floso-site-badge--gemini" : "floso-site-badge--claude";
  meta.innerHTML = `<span class="floso-site-badge ${siteClass}">${capsule.site}</span><span>${dateStr}</span><span>${capsule.messages.length} msgs</span>`;
  titleWrap.appendChild(title);
  titleWrap.appendChild(meta);
  top.appendChild(titleWrap);
  li.appendChild(top);

  const actions = document.createElement("div");
  actions.className = "floso-card-actions";

  const injectBtn = document.createElement("button");
  injectBtn.className = "floso-icon-btn";
  injectBtn.textContent = "Inject";

  const viewBtn = document.createElement("button");
  viewBtn.className = "floso-icon-btn";
  viewBtn.textContent = "View";

  const optimizeBtn = document.createElement("button");
  optimizeBtn.className = "floso-icon-btn floso-icon-btn--optimize";
  optimizeBtn.textContent = "Optimize";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "floso-icon-btn floso-icon-btn--danger";
  deleteBtn.textContent = "Delete";

  actions.appendChild(injectBtn);
  actions.appendChild(viewBtn);
  actions.appendChild(optimizeBtn);
  actions.appendChild(deleteBtn);
  li.appendChild(actions);

  const messagesWrap = document.createElement("div");
  messagesWrap.className = "floso-card-messages";
  const assistantName = capsule.site === "chatgpt.com" ? "ChatGPT" : capsule.site === "gemini.google.com" ? "Gemini" : "Claude";
  capsule.messages.forEach((msg) => {
    const msgEl = document.createElement("div");
    msgEl.className = "floso-msg " + (msg.role === "user" ? "floso-msg--user" : "floso-msg--assistant");
    msgEl.textContent = (msg.role === "user" ? "You: " : assistantName + ": ") + msg.text;
    messagesWrap.appendChild(msgEl);
  });
  li.appendChild(messagesWrap);

  injectBtn.addEventListener("click", () => {
    if (injectBtn.disabled) return;
    const text = formatCapsuleAsText(capsule, assistantName);
    injectBtn.disabled = true;
    injectBtn.textContent = "Injecting…";
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) {
        showStatus("Floso: No active tab found.", true);
        injectBtn.disabled = false;
        injectBtn.textContent = "Inject";
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "FLOSO_INJECT", text }, (response) => {
        if (chrome.runtime.lastError) showStatus("Floso: Couldn't reach the page. Try refreshing the tab.", true);
        else showStatus("Floso: Injection requested…", false);
        setTimeout(() => {
          injectBtn.disabled = false;
          injectBtn.textContent = "Inject";
        }, 2500);
      });
    });
  });

  viewBtn.addEventListener("click", () => {
    const isOpen = messagesWrap.classList.toggle("open");
    viewBtn.textContent = isOpen ? "Hide" : "View";
  });

  optimizeBtn.addEventListener("click", () => {
    optimizerInput.value = formatCapsuleAsText(capsule, assistantName);
    switchPanel("optimize");
    runOptimization();
  });

  deleteBtn.addEventListener("click", () => {
    chrome.storage.local.get({ capsules: [] }, (data) => {
      const remaining = data.capsules.filter((c) => c.id !== capsule.id);
      chrome.storage.local.set({ capsules: remaining }, () => renderCapsules());
    });
  });

  return li;
}

function formatCapsuleAsText(capsule, assistantName) {
  const lines = capsule.messages.map((msg) => {
    const speaker = msg.role === "user" ? "User" : assistantName;
    return `${speaker}: ${msg.text}`;
  });
  return "Here is context from a previous conversation, so you're up to speed:\n\n" + lines.join("\n\n") + "\n\n---\nPlease continue helping with the above.";
}

function runOptimization() {
  if (!window.FlosoOptimizer) return;
  const input = optimizerInput.value;
  if (!input.trim()) {
    optimizerOutput.value = "";
    originalTokensEl.textContent = "0";
    optimizedTokensEl.textContent = "0";
    savedPercentEl.textContent = "0%";
    copyOptimizedBtn.disabled = true;
    optimizationNote.textContent = "Waiting for input";
    return;
  }

  runOptimizeBtn.disabled = true;
  runOptimizeBtn.textContent = "Optimizing…";
  requestAnimationFrame(() => {
    lastOptimization = window.FlosoOptimizer.optimize(input, {
      model: modelSelect.value,
      level: optimizationLevel.value,
    });
    optimizerOutput.value = lastOptimization.optimized;
    originalTokensEl.textContent = lastOptimization.originalTokens.toLocaleString();
    optimizedTokensEl.textContent = lastOptimization.optimizedTokens.toLocaleString();
    savedPercentEl.textContent = `${lastOptimization.savedPercent}%`;
    optimizationNote.textContent = `${lastOptimization.model} profile · meaning-preserving compression`;
    copyOptimizedBtn.disabled = !lastOptimization.optimized;
    runOptimizeBtn.disabled = false;
    runOptimizeBtn.textContent = "Optimize context";
  });
}

async function copyOptimized() {
  if (!lastOptimization || !lastOptimization.optimized) return;
  try {
    await navigator.clipboard.writeText(lastOptimization.optimized);
    showStatus("Floso: Optimized context copied ✓", false);
  } catch (err) {
    optimizerOutput.focus();
    optimizerOutput.select();
    document.execCommand("copy");
    showStatus("Floso: Optimized context copied ✓", false);
  }
}
