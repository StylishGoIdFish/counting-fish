/*
CountingFish background.js (Manifest V3 service worker)

This file is the "brain":
- receives telemetry from content.js
- computes a risk score + reasons
- stores per-origin state (settings + latest snapshot)
- updates extension badge (color + text)
- responds to popup requests (popup is just UI)

------------------------------------
Message Contract
------------------------------------

From content.js -> background.js:

1) CF_TELEMETRY
{
  type: "CF_TELEMETRY",
  origin: "https://example.com",
  href: "https://example.com/page",
  payload: {
    counts: { perfNow:number, dateNow:number, raf:number },
    bursts: { perfNowPer100msMax:number },
    flags: { wasmUsed:boolean, workersSpawned:number },
    mode: "off"|"monitor"|"harden",
    q_ms: number,
    ts: number
  }
}

From popup.js -> background.js:

2) CF_GET_STATE
{
  type: "CF_GET_STATE",
  origin: "https://example.com"
}

3) CF_SET_MODE
{
  type: "CF_SET_MODE",
  origin: "https://example.com",
  mode: "off"|"monitor"|"harden"
}

4) CF_SET_AUTO_HARDEN
{
  type: "CF_SET_AUTO_HARDEN",
  origin: "https://example.com",
  autoHarden: true|false
}

5) CF_SET_QMS (optional but handy)
{
  type: "CF_SET_QMS",
  origin: "https://example.com",
  q_ms: number
}

From background.js -> content.js (then content forwards into page to inject.js):

6) CF_SET_MODE (sent to a tab)
{
  type: "CF_SET_MODE",
  mode: "off"|"monitor"|"harden",
  q_ms: number
}

------------------------------------
Per-origin state (what that means)
------------------------------------
We keep a separate record for each origin, e.g.:
stateByOrigin["https://www.reddit.com"] = { ... }

That record includes:
- settings: mode, autoHarden, q_ms
- latest telemetry snapshot
- latest score + reasons
- last seen tabId (so we can send mode updates to the right tab)
*/

var DEFAULT_MODE = "monitor";
var DEFAULT_AUTO_HARDEN = false;
var DEFAULT_QMS = 2;

var AUTO_HARDEN_THRESHOLD = 60; // score >= 60 => harden

// In-memory state (service worker can sleep; settings are persisted separately)
var stateByOrigin = {}; // origin -> { settings, latest, score, reasons, lastTabId }

// Persisted settings live in chrome.storage.local under this key:
var STORAGE_KEY = "cf_site_settings";

/* -----------------------------
   Helpers
----------------------------- */

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function isValidMode(m) {
  return m === "off" || m === "monitor" || m === "harden";
}

function normalizeOrigin(origin) {
  // origin should already be like "https://example.com"
  // but we’ll be defensive.
  try {
    var u = new URL(origin);
    return u.origin;
  } catch (e) {
    return origin;
  }
}

function getOrInitState(origin) {
  origin = normalizeOrigin(origin);

  if (!stateByOrigin[origin]) {
    stateByOrigin[origin] = {
      settings: {
        mode: DEFAULT_MODE,
        autoHarden: DEFAULT_AUTO_HARDEN,
        q_ms: DEFAULT_QMS
      },
      latest: null,
      score: 0,
      reasons: [],
      lastTabId: null,
      href: null,
      lastUpdatedTs: null
    };
  }
  return stateByOrigin[origin];
}

function computeScoreAndReasons(telemetryPayload) {
  // Simple, explainable scoring for v1.
  var counts = telemetryPayload.counts || {};
  var bursts = telemetryPayload.bursts || {};
  var flags = telemetryPayload.flags || {};

  var perfNow = (counts.perfNow || 0) + (counts.workerPerfNow || 0);
  var burst100 = Math.max(bursts.perfNowPer100msMax || 0, counts.workerBurstMax || 0);
  var wasmUsed = !!flags.wasmUsed;
  var workers = flags.workersSpawned || 0;

  var score = 0;
  var reasons = [];

  // High frequency timing = big tell
  if (perfNow > 50000) {
    score += 50;
    reasons.push("High-frequency performance.now: " + perfNow + " calls/sec");
  } else if (perfNow > 5000) {
    score += 25;
    reasons.push("Elevated performance.now usage: " + perfNow + " calls/sec");
  }

  // Burstiness = tight loop style behavior
  if (burst100 > 10000) {
    score += 20;
    reasons.push("Timing burst detected: " + burst100 + " calls/100ms max");
  }

  // “Precision enhancers”
  if (wasmUsed) {
    score += 15;
    reasons.push("WebAssembly used");
  }

  if (workers >= 2) {
    score += 10;
    reasons.push("Multiple Workers spawned: " + workers);
  } else if (workers === 1) {
    score += 5;
    reasons.push("Worker spawned: 1");
  }

  score = clamp(score, 0, 100);

  // If no reasons, still say something (helps UI)
  if (reasons.length === 0) {
    reasons.push("No suspicious timing patterns detected");
  }

  return { score: score, reasons: reasons };
}

function badgeForScore(score) {
  // Return { text, color } where color is [r,g,b,a]
  if (score >= 60) return { text: "HIGH", color: "#d93025" }; // red
  if (score >= 25) return { text: "MID",  color: "#f9ab00" }; // yellow
  return { text: "LOW", color: "#188038" }; // green
}

function setBadgeForTab(tabId, score) {
  if (typeof tabId !== "number") return;

  var b = badgeForScore(score);

  chrome.action.setBadgeText({ tabId: tabId, text: b.text });
  chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: b.color });
}

/* -----------------------------
   Settings persistence
----------------------------- */

function loadSettingsFromStorage(callback) {
  chrome.storage.local.get([STORAGE_KEY], function (res) {
    var all = res && res[STORAGE_KEY] ? res[STORAGE_KEY] : {};
    callback(all);
  });
}

function saveSettingsToStorage(allSettings, callback) {
  var obj = {};
  obj[STORAGE_KEY] = allSettings;
  chrome.storage.local.set(obj, function () {
    if (callback) callback();
  });
}

function getSettingsForOrigin(origin, callback) {
  origin = normalizeOrigin(origin);
  loadSettingsFromStorage(function (all) {
    var s = all[origin];
    if (!s) {
      s = { mode: DEFAULT_MODE, autoHarden: DEFAULT_AUTO_HARDEN, q_ms: DEFAULT_QMS };
      all[origin] = s;
      saveSettingsToStorage(all, function () {
        callback(s);
      });
      return;
    }
    callback(s);
  });
}

function updateSettingsForOrigin(origin, patch, callback) {
  origin = normalizeOrigin(origin);
  loadSettingsFromStorage(function (all) {
    var s = all[origin] || { mode: DEFAULT_MODE, autoHarden: DEFAULT_AUTO_HARDEN, q_ms: DEFAULT_QMS };

    // Apply patch safely
    if (patch.mode && isValidMode(patch.mode)) s.mode = patch.mode;
    if (typeof patch.autoHarden === "boolean") s.autoHarden = patch.autoHarden;
    if (typeof patch.q_ms === "number" && isFinite(patch.q_ms) && patch.q_ms > 0 && patch.q_ms <= 50) s.q_ms = patch.q_ms;

    all[origin] = s;

    saveSettingsToStorage(all, function () {
      callback(s);
    });
  });
}

/* -----------------------------
   Auto-harden logic
----------------------------- */

function maybeApplyAutoHarden(origin, tabId) {
  var st = getOrInitState(origin);

  // If autoHarden is on, we force mode based on score.
  if (!st.settings.autoHarden) return;

  var desiredMode = (st.score >= AUTO_HARDEN_THRESHOLD) ? "harden" : "monitor";

  if (st.settings.mode !== desiredMode) {
    st.settings.mode = desiredMode;

    // Send new mode to the tab so inject.js changes behavior
    chrome.tabs.sendMessage(tabId, {
      type: "CF_SET_MODE",
      mode: st.settings.mode,
      q_ms: st.settings.q_ms
    });
  }
}

/* -----------------------------
   Message handling
----------------------------- */

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg.type !== "string") return;

  // 1) Telemetry from content script
  if (msg.type === "CF_TELEMETRY") {
    var origin = normalizeOrigin(msg.origin || "");
    var st = getOrInitState(origin);

    // Remember where this came from so we can push mode updates later
    if (sender && sender.tab && typeof sender.tab.id === "number") {
      st.lastTabId = sender.tab.id;
    }
    st.href = msg.href || st.href;

    // Load persisted settings for this origin (first time), then process telemetry
    getSettingsForOrigin(origin, function (settings) {
      st.settings = settings;

      st.latest = msg.payload || null;
      st.lastUpdatedTs = Date.now();

      // Compute score + reasons from telemetry
      var sr = computeScoreAndReasons(msg.payload || {});
      st.score = sr.score;
      st.reasons = sr.reasons;

      // Update badge for that tab (if known)
      if (typeof st.lastTabId === "number") {
        setBadgeForTab(st.lastTabId, st.score);
      }

      // Auto-harden if enabled
      if (typeof st.lastTabId === "number") {
        maybeApplyAutoHarden(origin, st.lastTabId);
      }
    });

    // async work, but no need to keep sendResponse open
    return;
  }

  // 2) Popup requests current state
  if (msg.type === "CF_GET_STATE") {
    var o2 = normalizeOrigin(msg.origin || "");
    var st2 = getOrInitState(o2);

    getSettingsForOrigin(o2, function (settings) {
      st2.settings = settings;

      sendResponse({
        ok: true,
        origin: o2,
        href: st2.href,
        settings: st2.settings,
        score: st2.score,
        reasons: st2.reasons,
        latest: st2.latest,
        lastUpdatedTs: st2.lastUpdatedTs
      });
    });

    // IMPORTANT: keep channel open for async response
    return true;
  }

  // 3) Popup sets manual mode
  if (msg.type === "CF_SET_MODE") {
    var o3 = normalizeOrigin(msg.origin || "");
    var requestedMode = msg.mode;

    if (!isValidMode(requestedMode)) {
      sendResponse({ ok: false, error: "Invalid mode" });
      return;
    }

    updateSettingsForOrigin(o3, { mode: requestedMode }, function (settings) {
      var st3 = getOrInitState(o3);
      st3.settings = settings;

      // Push to last seen tab if available
      if (typeof st3.lastTabId === "number") {
        chrome.tabs.sendMessage(st3.lastTabId, {
          type: "CF_SET_MODE",
          mode: settings.mode,
          q_ms: settings.q_ms
        });
      }

      sendResponse({ ok: true, settings: settings });
    });

    return true;
  }

  // 4) Popup toggles auto harden
  if (msg.type === "CF_SET_AUTO_HARDEN") {
    var o4 = normalizeOrigin(msg.origin || "");
    var auto = !!msg.autoHarden;

    updateSettingsForOrigin(o4, { autoHarden: auto }, function (settings) {
      var st4 = getOrInitState(o4);
      st4.settings = settings;

      // If turning on auto harden, immediately apply it once.
      if (auto && typeof st4.lastTabId === "number") {
        maybeApplyAutoHarden(o4, st4.lastTabId);

        // Also push current mode+q_ms to ensure inject has latest q_ms
        chrome.tabs.sendMessage(st4.lastTabId, {
          type: "CF_SET_MODE",
          mode: st4.settings.mode,
          q_ms: st4.settings.q_ms
        });
      }

      sendResponse({ ok: true, settings: settings });
    });

    return true;
  }

  // 5) Popup sets quantization bucket
  if (msg.type === "CF_SET_QMS") {
    var o5 = normalizeOrigin(msg.origin || "");
    var q = msg.q_ms;

    updateSettingsForOrigin(o5, { q_ms: q }, function (settings) {
      var st5 = getOrInitState(o5);
      st5.settings = settings;

      if (typeof st5.lastTabId === "number") {
        chrome.tabs.sendMessage(st5.lastTabId, {
          type: "CF_SET_MODE",
          mode: settings.mode,
          q_ms: settings.q_ms
        });
      }

      sendResponse({ ok: true, settings: settings });
    });

    return true;
  }
});

/* -----------------------------
   On install: set default badge behavior (optional)
----------------------------- */

/* -----------------------------
   Tier 1: MAIN world injector registration
----------------------------- */

async function registerMainWorldInjector() {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) {
    console.warn("[CF][bg] scripting API not available");
    return;
  }

  const scriptDef = {
    id: "cf-main-inject",
    matches: ["<all_urls>"],
    js: ["inject.js"],
    runAt: "document_start",
    world: "MAIN"
  };

  try {
    await chrome.scripting.registerContentScripts([scriptDef]);
    console.log("[CF][bg] MAIN-world injector registered");
  } catch (e) {
    // Already registered? Re-register safely.
    try {
      await chrome.scripting.unregisterContentScripts({ ids: ["cf-main-inject"] });
      await chrome.scripting.registerContentScripts([scriptDef]);
      console.log("[CF][bg] MAIN-world injector re-registered");
    } catch (e2) {
      console.warn("[CF][bg] Failed to register MAIN injector:", e2);
    }
  }
}


chrome.runtime.onInstalled.addListener(function () {
  chrome.action.setBadgeText({ text: "" });

  registerMainWorldInjector();
});

chrome.runtime.onStartup.addListener(function () {
  registerMainWorldInjector();
});

