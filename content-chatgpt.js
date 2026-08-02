// Floso — content script for chatgpt.com
// Uses the shared scrolling-collector from floso-shared.js (loaded first,
// see manifest.json) to handle ChatGPT's virtualized long conversations.

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

// ChatGPT's input box is also a rich-text editor (ProseMirror), not a plain
// textarea, and has a stable id we can rely on directly.
async function injectText(text) {
  const input = document.querySelector("#prompt-textarea");
  if (!input) {
    flosoShowToast("Floso: Couldn't find the message box on this page.", true);
    return;
  }
  await flosoInjectAllAtOnce(input, text);
}

const CHATGPT_MESSAGE_SELECTOR = "[data-message-author-role]";

function extractChatGptMessage(turn) {
  const role = turn.getAttribute("data-message-author-role");
  const text = turn.innerText.trim();
  if (!text) return null;
  if (role !== "user" && role !== "assistant") return null;
  return { role, text };
}

async function captureConversation() {
  try {
    if (!document.querySelector(CHATGPT_MESSAGE_SELECTOR)) {
      flosoShowToast("Floso: No conversation found on this page.", true);
      return;
    }

    flosoShowToast("Floso: Loading full conversation…", false);
    const messages = await flosoScrollAndCollect(CHATGPT_MESSAGE_SELECTOR, extractChatGptMessage);

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
        site: "chatgpt.com",
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
