/*
CountingFish popup.js

Popup responsibilities:
- Determine active tab origin
- Request state from background: CF_GET_STATE
- Render score/settings/telemetry
- Send commands:
  - CF_SET_MODE
  - CF_SET_AUTO_HARDEN
  - CF_SET_QMS
*/

var currentOrigin = null;

function $(id) { return document.getElementById(id); }

function setHint(text) {
  $("hintText").textContent = text || "";
}

function originFromUrl(urlStr) {
  try {
    var u = new URL(urlStr);
    return u.origin;
  } catch (e) {
    return null;
  }
}

function getActiveTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs || !tabs[0]) return callback(null);
    callback(tabs[0]);
  });
}

function sendToBackground(msg, callback) {
  chrome.runtime.sendMessage(msg, function (resp) {
    if (chrome.runtime.lastError) {
      callback(null, chrome.runtime.lastError);
      return;
    }
    callback(resp || null, null);
  });
}

function pillForScore(score) {
  if (score >= 60) return { text: "HIGH", color: "#d93025" };
  if (score >= 25) return { text: "MID", color: "#f9ab00" };
  return { text: "LOW", color: "#188038" };
}

function setPill(score) {
  var p = pillForScore(score);
  var el = $("riskPill");
  el.textContent = p.text;
  el.style.borderColor = p.color;
  el.style.color = p.color;
}

function setActiveModeButtons(mode) {
  $("btnOff").classList.toggle("active", mode === "off");
  $("btnMonitor").classList.toggle("active", mode === "monitor");
  $("btnHarden").classList.toggle("active", mode === "harden");
}

function renderState(state) {
  if (!state || !state.ok) {
    setHint("No state available yet (open a normal webpage).");
    return;
  }

  var settings = state.settings || {};
  var score = typeof state.score === "number" ? state.score : 0;
  var reasons = state.reasons || [];
  var latest = state.latest || null;

  $("siteText").textContent = state.origin || "—";
  $("scoreText").textContent = String(score);
  setPill(score);

  setActiveModeButtons(settings.mode || "monitor");
  $("autoHardenToggle").checked = !!settings.autoHarden;
  $("qmsInput").value = String(settings.q_ms || 2);

  // Reasons list
  var list = $("reasonsList");
  list.innerHTML = "";
  for (var i = 0; i < reasons.length; i++) {
    var li = document.createElement("li");
    li.textContent = reasons[i];
    list.appendChild(li);
  }

  // Telemetry fields
  if (latest && latest.counts && latest.bursts && latest.flags) {

    const perfMain = latest.counts.perfNow || 0;
    const perfWorker = latest.counts.workerPerfNow || 0;
    const perfTotal = perfMain + perfWorker;
    const burstMain = latest.bursts.perfNowPer100msMax || 0;
    const burstWorker = latest.counts.workerBurstMax || 0;
    const burstTotal = Math.max(burstMain, burstWorker);

    $("tPerf").textContent = String(latest.counts.perfTotal || 0);
    $("tDate").textContent = String(latest.counts.dateNow || 0);
    $("tRaf").textContent = String(latest.counts.raf || 0);
    $("tBurst").textContent = String(latest.bursts.burstTotal || 0);
    $("tWasm").textContent = (latest.flags.wasmUsed ? "yes" : "no");
    $("tWorkers").textContent = String(latest.flags.workersSpawned || 0);
  } else {
    $("tPerf").textContent = "—";
    $("tDate").textContent = "—";
    $("tRaf").textContent = "—";
    $("tBurst").textContent = "—";
    $("tWasm").textContent = "—";
    $("tWorkers").textContent = "—";
  }

  if (state.lastUpdatedTs) {
    var ageMs = Date.now() - state.lastUpdatedTs;
    $("updatedText").textContent = "Updated " + Math.max(0, Math.round(ageMs / 1000)) + "s ago";
  } else {
    $("updatedText").textContent = "No telemetry yet";
  }

  setHint("");
}

function refresh() {
  if (!currentOrigin) return;

  sendToBackground(
    { type: "CF_GET_STATE", origin: currentOrigin },
    function (resp, err) {
      if (err) {
        setHint("Background error: " + (err.message || String(err)));
        return;
      }
      renderState(resp);
    }
  );
}

function setMode(mode) {
  if (!currentOrigin) return;

  sendToBackground(
    { type: "CF_SET_MODE", origin: currentOrigin, mode: mode },
    function () {
      refresh();
    }
  );
}

function setAutoHarden(on) {
  if (!currentOrigin) return;

  sendToBackground(
    { type: "CF_SET_AUTO_HARDEN", origin: currentOrigin, autoHarden: !!on },
    function () {
      refresh();
    }
  );
}

function setQms(q) {
  if (!currentOrigin) return;

  var qms = parseInt(q, 10);
  if (!isFinite(qms) || qms < 1) qms = 1;
  if (qms > 50) qms = 50;

  sendToBackground(
    { type: "CF_SET_QMS", origin: currentOrigin, q_ms: qms },
    function () {
      refresh();
    }
  );
}

function wireUi() {
  $("btnOff").addEventListener("click", function () { setMode("off"); });
  $("btnMonitor").addEventListener("click", function () { setMode("monitor"); });
  $("btnHarden").addEventListener("click", function () { setMode("harden"); });

  $("autoHardenToggle").addEventListener("change", function (e) {
    setAutoHarden(e.target.checked);
  });

  $("qmsInput").addEventListener("change", function (e) {
    setQms(e.target.value);
  });
}

function init() {
  wireUi();

  getActiveTab(function (tab) {
    if (!tab || !tab.url) {
      setHint("No active tab URL found.");
      return;
    }

    // Chrome special pages can't be injected into
    if (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
      setHint("Open a normal website tab to view state.");
      $("siteText").textContent = "(not available)";
      return;
    }

    currentOrigin = originFromUrl(tab.url);
    if (!currentOrigin) {
      setHint("Could not parse tab origin.");
      return;
    }

    $("siteText").textContent = currentOrigin;
    refresh();

    // Optional: refresh once more after a short delay in case telemetry arrives slightly later
    setTimeout(refresh, 600);
  });
}

init();
