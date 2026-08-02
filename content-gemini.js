// Floso — content script for gemini.google.com
// Uses the shared scrolling-collector from floso-shared.js (loaded first,
// see manifest.json) to handle Gemini's virtualized long conversations.

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

// Gemini's input box is a Quill editor (contenteditable div with class
// "ql-editor"), not a plain textarea — same idea as Claude/ChatGPT, just a
// different rich-text editor library under the hood.
async function injectText(text) {
  const input = document.querySelector('.ql-editor[contenteditable="true"]');
  if (!input) {
    flosoShowToast("Floso: Couldn't find the message box on this page.", true);
    return;
  }
  await flosoInjectAllAtOnce(input, text);
}

// Gemini embeds hidden screen-reader-only labels right inside the message
// text (e.g. a literal "You said" span next to your real message). We work
// on a cloned copy, remove anything screen-reader-only, then read what's left.
function extractCleanText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll(".cdk-visually-hidden, .sr-only, [aria-hidden='true']").forEach((node) => {
    node.remove();
  });
  return clone.innerText.trim();
}

const GEMINI_MESSAGE_SELECTOR = "user-query, model-response";

function extractGeminiMessage(el) {
  const tag = el.tagName.toLowerCase();

  if (tag === "user-query") {
    const textEl = el.querySelector(".query-text");
    const text = extractCleanText(textEl || el);
    return text ? { role: "user", text } : null;
  }

  if (tag === "model-response") {
    const textEl = el.querySelector("message-content");
    const text = extractCleanText(textEl || el);
    return text ? { role: "assistant", text } : null;
  }

  return null;
}

async function captureConversation() {
  try {
    if (!document.querySelector(GEMINI_MESSAGE_SELECTOR)) {
      flosoShowToast("Floso: No conversation found on this page.", true);
      return;
    }

    flosoShowToast("Floso: Loading full conversation…", false);
    const messages = await flosoScrollAndCollect(GEMINI_MESSAGE_SELECTOR, extractGeminiMessage);

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
        site: "gemini.google.com",
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
