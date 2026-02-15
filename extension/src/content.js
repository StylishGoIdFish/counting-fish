/*
Message Types:

CF_TELEMETRY:
{
  type: "CF_TELEMETRY",
  origin?: string,
  payload: {
    counts: { perfNow, dateNow, raf },
    bursts: { perfNowPer100msMax },
    flags: { wasmUsed, workersSpawned },
    ts: number
  }
}

CF_SET_MODE:
{
  type: "CF_SET_MODE",
  mode: "off" | "monitor" | "harden",
  q_ms: number
}
*/

/*
CountingFish content.js (runs as a content script)

Responsibilities:
1) Inject inject.js into the page context (NOT the isolated content script world).
2) Relay messages:
   - inject.js -> content.js via window.postMessage
   - content.js -> background.js via chrome.runtime.sendMessage
   - background/popup -> content.js via chrome.runtime.onMessage
   - content.js -> inject.js via window.postMessage

Message contract:
- From page to extension:
  { source:"countingfish", type:"CF_TELEMETRY", payload:{...} }

- From extension to page:
  { source:"countingfish", type:"CF_SET_MODE", mode:"off|monitor|harden", q_ms:number }
*/

(function startContentBridge() {
  "use strict";

  // // --------------------------------------------
  // // 1) Inject inject.js into the page
  // // --------------------------------------------
  // function injectPageScript() {
  //   try {
  //     var script = document.createElement("script");
  //     script.src = chrome.runtime.getURL("inject.js");
  //     script.type = "text/javascript";
  //     script.async = false;

  //     // Put it as early as possible
  //     (document.documentElement || document.head || document.body).appendChild(script);

  //     // Optional cleanup: remove the tag after it loads
  //     script.onload = function () {
  //       script.remove();
  //     };
  //   } catch (e) {
  //     // If injection fails, the extension can't do anything useful.
  //     // You'll see errors in the console.
  //   }
  // }

  // injectPageScript();

  // --------------------------------------------
  // 2) Listen for telemetry from inject.js (page)
  //    and forward it to background.js
  // --------------------------------------------
  window.addEventListener("message", function (event) {
    var data = event.data;

    // Only accept messages from this same window
    if (event.source !== window) return;

    if (!data || data.source !== "countingfish") return;

    if (data.type === "CF_TELEMETRY") {
      // Forward to background with origin info
      chrome.runtime.sendMessage({
        type: "CF_TELEMETRY",
        origin: window.location.origin,
        href: window.location.href,
        payload: data.payload
      });
    }
  });

  // --------------------------------------------
  // 3) Receive mode updates from background/popup
  //    and forward them into the page (inject.js)
  // --------------------------------------------
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "CF_SET_MODE") {
      window.postMessage(
        {
          source: "countingfish",
          type: "CF_SET_MODE",
          mode: msg.mode,
          q_ms: msg.q_ms
        },
        "*"
      );

      // Optional ack
      sendResponse({ ok: true });
    }
  });

})();
