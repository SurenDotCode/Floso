// Floso — content script for claude.ai
// Uses the shared scrolling-collector from floso-shared.js (loaded first,
// see manifest.json) to handle Claude's virtualized long conversations.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "FLOSO_CAPTURE") {
    captureConversation();
    sendResponse({ ok: true });
  }
  if (message && message.type === "FLOSO_INJECT") {
    injectText(message.text);
    sendResponse({ ok: true });
  }
  return true;
});

// Claude's input box is a rich-text editor (TipTap/ProseMirror), not a
// plain textarea. Simply setting its text won't work — the editor ignores
// direct DOM changes. execCommand("insertText") simulates real typing,
// which the editor does listen for.
async function injectText(text) {
  const input = document.querySelector('[data-testid="chat-input"]');
  if (!input) {
    flosoShowToast("Floso: Couldn't find the message box on this page.", true);
    return;
  }
  await flosoInjectAllAtOnce(input, text);
}

// Claude shows small collapsible status pills above its reply, like
// "Thought for 1s" or "Searched the web" (visible text + a hidden
// screen-reader duplicate). We work on a cloned copy so we don't touch the
// real page, remove those pill elements, then read what's left.
function extractCleanAssistantText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('button, [role="status"], .sr-only').forEach((node) => {
    node.remove();
  });
  return clone.innerText.trim();
}

const CLAUDE_MESSAGE_SELECTOR = 'div[role="feed"] div[role="article"]';

function extractClaudeMessage(article) {
  const userBubble = article.querySelector('[data-user-message-bubble="true"]');
  if (userBubble) {
    const textEl = userBubble.querySelector('[data-testid="user-message"]');
    const text = (textEl || userBubble).innerText.trim();
    return text ? { role: "user", text } : null;
  }

  const assistantEl = article.querySelector(".font-claude-response");
  if (assistantEl) {
    const text = extractCleanAssistantText(assistantEl);
    return text ? { role: "assistant", text } : null;
  }

  return null;
}

async function captureConversation() {
  try {
    if (!document.querySelector(CLAUDE_MESSAGE_SELECTOR)) {
      flosoShowToast("Floso: No conversation found on this page.", true);
      return;
    }

    flosoShowToast("Floso: Loading full conversation…", false);
    const messages = await flosoScrollAndCollect(CLAUDE_MESSAGE_SELECTOR, extractClaudeMessage);

    if (!messages.length) {
      flosoShowToast("Floso: Couldn't read any messages from this page.", true);
      return;
    }

    const url = window.location.href;

    chrome.storage.local.get({ capsules: [] }, (data) => {
      const capsules = data.capsules;
      const existingIndex = capsules.findIndex((c) => c.url === url);

      const capsule = {
        id: existingIndex >= 0 ? capsules[existingIndex].id : "capsule_" + Date.now(),
        url,
        site: "claude.ai",
        title: messages[0].text.slice(0, 60),
        messages,
        createdAt:
          existingIndex >= 0 ? capsules[existingIndex].createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (existingIndex >= 0) {
        capsules[existingIndex] = capsule;
      } else {
        capsules.unshift(capsule);
      }

      chrome.storage.local.set({ capsules }, () => {
        const verb = existingIndex >= 0 ? "Updated" : "Captured";
        flosoShowToast(`Floso: ${verb} ${messages.length} messages ✓`, false);
      });
    });
  } catch (err) {
    console.error("Floso capture error:", err);
    flosoShowToast("Floso: Capture failed — check the Console for details.", true);
  }
}
