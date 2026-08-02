 // Floso — shared helpers used by all three site content scripts.
// Loaded before the site-specific script in manifest.json, so its
// functions are available there directly (same content-script world).

function flosoShowToast(text, isError) {
  const existing = document.getElementById("floso-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "floso-toast";
  toast.textContent = text;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 999999;
    background: linear-gradient(135deg, #1a1d21, #2b2f36);
    color: ${isError ? "#ff6b6b" : "#e8ecf1"};
    border: 1px solid ${isError ? "#ff6b6b" : "#4aa3ff"};
    padding: 12px 18px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    transition: opacity 0.3s ease;
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// Finds the element that actually contains every currently-loaded message,
// then walks up from there to the nearest scrollable ancestor. This is more
// reliable than just walking up from one sample message, since a small
// scrollable wrapper around a single message (not the whole conversation)
// can otherwise get picked by mistake, making scrolling appear to do nothing.
function flosoFindScrollContainer(messageSelector) {
  const messages = document.querySelectorAll(messageSelector);
  if (!messages.length) return document.scrollingElement;

  // Find the common ancestor that contains both the first and last message.
  let ancestor = messages[0].parentElement;
  const lastMsg = messages[messages.length - 1];
  while (ancestor && !ancestor.contains(lastMsg)) {
    ancestor = ancestor.parentElement;
  }
  if (!ancestor) ancestor = messages[0].parentElement;

  // From there, walk up to the nearest genuinely scrollable ancestor.
  let el = ancestor;
  while (el) {
    const style = getComputedStyle(el);
    const scrollable =
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight + 40;
    if (scrollable) return el;
    el = el.parentElement;
  }
  return document.scrollingElement;
}

// Long conversations are virtualized: at any single moment, only messages
// near the current scroll position actually exist in the page's HTML.
// Scrolling to one end doesn't help by itself — it just loads different
// messages while unloading whatever was there before. So instead of
// grabbing everything at once, we scroll through the WHOLE conversation
// step by step (top to bottom), collecting whatever's visible at each
// step, and skipping messages we've already collected — building up the
// complete conversation piece by piece as it passes through the window.
//
// extractFn(el) should return { role, text } or null for a given matched
// element. messageSelector matches every message-like element on the page.
async function flosoScrollAndCollect(messageSelector, extractFn) {
  const container = flosoFindScrollContainer(messageSelector);
  const collected = new Map();
  let order = 0;

  function collectVisible() {
    document.querySelectorAll(messageSelector).forEach((el) => {
      const result = extractFn(el);
      if (!result || !result.text) return;
      // Key on role + text shape rather than any one site's specific DOM
      // id, so this works the same way across all three sites.
      const key = result.role + "|" + result.text.length + "|" + result.text.slice(0, 80);
      if (!collected.has(key)) {
        collected.set(key, { role: result.role, text: result.text, order: order++ });
      }
    });
  }

  // Start at the very top of the conversation.
  container.scrollTop = 0;
  await new Promise((resolve) => setTimeout(resolve, 350));
  collectVisible();

  let stableRounds = 0;
  const maxSteps = 400;
  let reachedBottom = false;

  for (let i = 0; i < maxSteps; i++) {
    const beforeTop = container.scrollTop;
    const step = Math.max(container.clientHeight * 0.85, 250);
    container.scrollTop = beforeTop + step;
    await new Promise((resolve) => setTimeout(resolve, 200));
    collectVisible();

    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
    const scrollMoved = container.scrollTop !== beforeTop;

    if (atBottom) {
      reachedBottom = true;
      break; // hand off to the settle phase below, which does the careful part
    }
    if (!scrollMoved) {
      stableRounds++;
      if (stableRounds >= 3) break; // scrolling isn't moving anymore for some other reason
    } else {
      stableRounds = 0;
    }
  }

  // Settling phase: once we reach the bottom, the very last message(s) can
  // still be rendering (especially longer replies, or ones with code blocks
  // or images). Give it a few slower, deliberate extra checks right here
  // before finishing, so the tail end of the conversation isn't cut off.
  if (reachedBottom) {
    let lastSize = collected.size;
    let steadyChecks = 0;
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      collectVisible();
      if (collected.size === lastSize) {
        steadyChecks++;
        if (steadyChecks >= 3) break;
      } else {
        steadyChecks = 0;
      }
      lastSize = collected.size;
    }
  }

  return Array.from(collected.values())
    .sort((a, b) => a.order - b.order)
    .map(({ role, text }) => ({ role, text }));
}

// Injects the whole capsule in one shot (no chunking). On a very long
// capsule, this genuinely does block the page for a moment while the site
// processes it — but rather than fight that, we cover that moment with a
// pulsing chain-link loading animation, so it reads as "loading" instead
// of "frozen." A busy flag still guards against a second click landing
// mid-injection and starting a colliding second run.
let flosoInjectionBusy = false;

function flosoShowLoadingOverlay() {
  if (!document.getElementById("floso-loading-style")) {
    const style = document.createElement("style");
    style.id = "floso-loading-style";
    style.textContent = `
      @keyframes flosoPulseZoom {
        0%   { transform: scale(0.8); opacity: 0.55; }
        50%  { transform: scale(1.25); opacity: 1; }
        100% { transform: scale(0.8); opacity: 0.55; }
      }
    `;
    document.head.appendChild(style);
  }

  const existing = document.getElementById("floso-loading-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "floso-loading-overlay";
  overlay.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 999999;
    width: 58px;
    height: 58px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #1a1d21, #2b2f36);
    border: 1px solid #2dd4bf;
    border-radius: 50%;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
  `;
  overlay.innerHTML = `
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
         style="animation: flosoPulseZoom 0.85s ease-in-out infinite; transform-origin: center;">
      <rect x="2" y="7" width="11" height="6" rx="3" transform="rotate(-20 7.5 10)" stroke="url(#flosoLoadGrad)" stroke-width="2"/>
      <rect x="11" y="11" width="11" height="6" rx="3" transform="rotate(-20 16.5 14)" stroke="url(#flosoLoadGrad)" stroke-width="2"/>
      <defs>
        <linearGradient id="flosoLoadGrad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stop-color="#cfd6de"/>
          <stop offset="1" stop-color="#2dd4bf"/>
        </linearGradient>
      </defs>
    </svg>
  `;
  document.body.appendChild(overlay);
}

function flosoHideLoadingOverlay() {
  const el = document.getElementById("floso-loading-overlay");
  if (el) el.remove();
}

async function flosoInjectAllAtOnce(input, text) {
  if (flosoInjectionBusy) {
    flosoShowToast("Floso: Still injecting — give it a moment.", true);
    return;
  }
  flosoInjectionBusy = true;
  flosoShowLoadingOverlay();

  // Let the browser actually paint the loading animation before the
  // (potentially blocking) insertion runs — double rAF guarantees at
  // least one full paint happened in between.
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );

  try {
    input.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);

    // Simulating actual typing (execCommand "insertText") forces these
    // rich-text editors (ProseMirror/Quill) through their heavier,
    // per-keystroke-oriented update path — that's what causes the freeze.
    // A real paste goes through a different, much lighter code path that
    // these editors specifically optimize for bulk content (this is why a
    // person pasting a huge document in by hand doesn't freeze the page).
    // So we simulate an actual paste event instead of simulated typing.
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", text);
    const pasteEvent = new ClipboardEvent("paste", {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true,
    });

    // dispatchEvent returns false if some listener called
    // preventDefault() on it — meaning the page's own paste handler picked
    // it up and processed it (the fast path we want). If it returns true,
    // nothing intercepted it, so we fall back to the slower method rather
    // than silently doing nothing.
    const notIntercepted = input.dispatchEvent(pasteEvent);

    let success = true;
    if (notIntercepted) {
      success = document.execCommand("insertText", false, text);
    }

    flosoHideLoadingOverlay();
    if (success) {
      flosoShowToast("Floso: Injected into the message box ✓", false);
    } else {
      flosoShowToast("Floso: Injection didn't work — try pasting manually.", true);
    }
  } catch (err) {
    flosoHideLoadingOverlay();
    console.error("Floso inject error:", err);
    flosoShowToast("Floso: Injection failed — check the Console for details.", true);
  } finally {
    flosoInjectionBusy = false;
  }
}