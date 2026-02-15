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


function startCountingFish() {

  // -----------------------------
  // State
  // -----------------------------
  var mode = " + JSON.stringify(mode) + ";
  var qMs = " + JSON.stringify(qMs) + ";



  // ----------------------------------------------------
// Telemetry Counters
//
// We are NOT measuring time directly.
// We are counting how often certain timing-related
// APIs are being called.
//
// Because we reset these counters every 1 second,
// the value we send is effectively:
//
//    calls per second
//
// That acts as a "rate" signal.
//
// High call rate = suspicious timing behavior.
// ----------------------------------------------------

  var counts = {
    perfNow: 0,
    dateNow: 0,
    raf: 0
  };

  

  var flags = {
    wasmUsed: false,
    workersSpawned: 0
  };

    // -----------------------------
  // Worker telemetry aggregation (per-second)
  // -----------------------------
  var workerAgg = {
    counts: { perfNow: 0, dateNow: 0 },
    bursts: { perfNowPer100msMax: 0 },
    flags: { wasmUsed: false }
  };

  // Track workers later (Step 3/4 will use this)
  var trackedWorkers = [];


  var perfNowWindowCount = 0;
  var perfNowPer100msMax = 0;

  // -----------------------------
  // Helper: Quantize
  // -----------------------------
  function quantizeMs(t) {
    return Math.floor(t / qMs) * qMs;
  }

// ----------------------------------------------------
// Burst Tracking (100ms window)
//
// Some timing attacks use very tight loops that
// generate thousands of calls in very short bursts.
//
// Every 100ms, we:
//   - record how many performance.now() calls happened
//   - keep track of the maximum burst in this second
//
// This helps detect microbenchmark-style behavior.
// ----------------------------------------------------

  setInterval(function () {

    if (perfNowWindowCount > perfNowPer100msMax) {
      perfNowPer100msMax = perfNowWindowCount;
    }

    perfNowWindowCount = 0;

  }, 100);

// ----------------------------------------------------
// Telemetry Emission (every 1 second)
//
// Every second we:
//
// 1) Send the counts to the extension.
//    Since we reset every second, the counts represent:
//
//       calls per second
//
// 2) Reset the counters back to zero.
//
// So the background script receives a rolling
// per-second rate snapshot.
//
// Example:
//   If perfNow = 120000,
//   that means ~120,000 calls per second.
//
// That is extremely abnormal for regular websites.
// ----------------------------------------------------

  setInterval(function () {

    window.postMessage({
      source: "countingfish",
      type: "CF_TELEMETRY",
      payload: {
        counts: {
          perfNow: counts.perfNow,
          dateNow: counts.dateNow,
          raf: counts.raf
        },
        bursts: {
          perfNowPer100msMax: perfNowPer100msMax
        },
        flags: {
          wasmUsed: flags.wasmUsed,
          workersSpawned: flags.workersSpawned
        },

        workers: {
          counts: { perfNow: workerAgg.counts.perfNow, dateNow: workerAgg.counts.dateNow },
          bursts: { perfNowPer100msMax: workerAgg.bursts.perfNowPer100msMax },
          flags: { wasmUsed: workerAgg.flags.wasmUsed },
        },

        mode: mode,
        q_ms: qMs,
        ts: Date.now()
      }
    }, "*");

    // reset per-second counters
    counts.perfNow = 0;
    counts.dateNow = 0;
    counts.raf = 0;
    perfNowPer100msMax = 0;
    workerAgg.counts.perfNow = 0;
    workerAgg.counts.dateNow = 0;
    workerAgg.bursts.perfNowPer100msMax = 0;
    workerAgg.flags.wasmUsed = false;


  }, 1000);

  // -----------------------------
  // Listen for mode updates
  // -----------------------------
  window.addEventListener("message", function (event) {

    var data = event.data;
    if (!data) return;
    if (data.source !== "countingfish") return;
    if (data.type !== "CF_SET_MODE") return;

    if (data.mode === "off" || data.mode === "monitor" || data.mode === "harden") {
      mode = data.mode;
    }

    if (typeof data.q_ms === "number") {
      qMs = data.q_ms;
    }

    broadcastModeToWorkers();

  });

  function broadcastModeToWorkers() {
    for (var i = 0; i < trackedWorkers.length; i++) {
      try {
        trackedWorkers[i].postMessage({
          source: "countingfish",
          type: "CF_SET_MODE",
          mode: mode,
          q_ms: qMs
        });
      } catch (e) {
        // worker might be dead, ignore
      }
    }
  }


  function ingestWorkerTelemetry(payload) {
    if (!payload) return;

    var c = payload.counts || {};
    var b = payload.bursts || {};
    var f = payload.flags || {};

    workerAgg.counts.perfNow += (c.perfNow || 0);
    workerAgg.counts.dateNow += (c.dateNow || 0);

    var burst = b.perfNowPer100msMax || 0;
    if (burst > workerAgg.bursts.perfNowPer100msMax) {
      workerAgg.bursts.perfNowPer100msMax = burst;
    }

    if (f.wasmUsed) workerAgg.flags.wasmUsed = true;
  }

  
// ----------------------------------------------------
// Telemetry Emission (every 1 second)
//
// Every second we:
//
// 1) Send the counts to the extension.
//    Since we reset every second, the counts represent:
//
//       calls per second
//
// 2) Reset the counters back to zero.
//
// So the background script receives a rolling
// per-second rate snapshot.
//
// Example:
//   If perfNow = 120000,
//   that means ~120,000 calls per second.
//
// That is extremely abnormal for regular websites.
// ----------------------------------------------------

  if (window.performance && typeof window.performance.now === "function") {

    var realPerfNow = window.performance.now.bind(window.performance);

    window.performance.now = function () {

      counts.perfNow++;
      perfNowWindowCount++;

      var t = realPerfNow();

      if (mode === "harden") {
        return quantizeMs(t);
      }

      return t;
    };
  }

// ----------------------------------------------------
// Wrap Date.now()
//
// Some pages fall back to Date.now() for timing.
//
// We count calls the same way.
// In harden mode, we quantize it as well.
// ----------------------------------------------------

  if (typeof Date.now === "function") {

    var realDateNow = Date.now.bind(Date);

    Date.now = function () {

      counts.dateNow++;

      var t = realDateNow();

      if (mode === "harden") {
        return quantizeMs(t);
      }

      return t;
    };
  }

  // -----------------------------
  // Wrap requestAnimationFrame (monitor only)
  // -----------------------------
  if (typeof window.requestAnimationFrame === "function") {

    var realRAF = window.requestAnimationFrame.bind(window);

    window.requestAnimationFrame = function (cb) {
      counts.raf++;
      return realRAF(cb);
    };
  }

// ----------------------------------------------------
// Wrap WebAssembly.instantiate()
//
// WebAssembly is often used in high-performance
// timing loops to reduce noise.
//
// We do not block it here.
// We simply flag that it was used.
// ----------------------------------------------------

  if (window.WebAssembly) {

    if (typeof WebAssembly.instantiate === "function") {

      var realInstantiate = WebAssembly.instantiate.bind(WebAssembly);

      WebAssembly.instantiate = function () {
        flags.wasmUsed = true;
        return realInstantiate.apply(null, arguments);
      };
    }

    if (typeof WebAssembly.instantiateStreaming === "function") {

      var realInstantiateStreaming = WebAssembly.instantiateStreaming.bind(WebAssembly);

      WebAssembly.instantiateStreaming = function () {
        flags.wasmUsed = true;
        return realInstantiateStreaming.apply(null, arguments);
      };
    }
  }

// ----------------------------------------------------
// Wrap Worker constructor
//
// Workers are sometimes used to isolate timing loops
// and reduce interference.
//
// We count how many workers are created.
// ----------------------------------------------------

  if (typeof window.Worker === "function") {

    var RealWorker = window.Worker;

    function isModuleWorker(options) {
      return options && options.type === "module";
    }

    function toAbsUrl(u) {
      try {
        return new URL(u, window.location.href).href;
      } catch (e) {
        return u;
      }
    }

    function makeClassicBootstrapUrl(originalUrl) {
      var abs = toAbsUrl(originalUrl);
      console.log("CF importing:", abs);

      var src =
        "(function(){\n" +
        "  'use strict';\n" +
        "  var mode = 'monitor';\n" +
        "  var qMs = 2;\n" +
        "  function quantizeMs(t){ return Math.floor(t / qMs) * qMs; }\n" +

        "  var counts = { perfNow:0, dateNow:0 };\n" +
        "  var flags = { wasmUsed:false };\n" +
        "  var perfNowWindowCount = 0;\n" +
        "  var perfNowPer100msMax = 0;\n" +

        "  setInterval(function(){\n" +
        "    if(perfNowWindowCount > perfNowPer100msMax) perfNowPer100msMax = perfNowWindowCount;\n" +
        "    perfNowWindowCount = 0;\n" +
        "  }, 100);\n" +

        "  setInterval(function(){\n" +
        "    try {\n" +
        "      postMessage({\n" +
        "        source:'countingfish',\n" +
        "        type:'CF_WORKER_TELEMETRY',\n" +
        "        payload:{\n" +
        "          counts:{ perfNow:counts.perfNow, dateNow:counts.dateNow },\n" +
        "          bursts:{ perfNowPer100msMax:perfNowPer100msMax },\n" +
        "          flags:{ wasmUsed:!!flags.wasmUsed },\n" +
        "          ts: Date.now()\n" +
        "        }\n" +
        "      });\n" +
        "    } catch(e) {}\n" +
        "    counts.perfNow=0;\n" +
        "    counts.dateNow=0;\n" +
        "    perfNowPer100msMax=0;\n" +
        "    flags.wasmUsed=false;\n" +
        "  }, 1000);\n" +

        "  addEventListener('message', function(ev){\n" +
        "    var d = ev && ev.data;\n" +
        "    if(!d || d.source!=='countingfish' || d.type!=='CF_SET_MODE') return;\n" +
        "    if(d.mode==='off'||d.mode==='monitor'||d.mode==='harden') mode=d.mode;\n" +
        "    if(typeof d.q_ms==='number') qMs=d.q_ms;\n" +
        "  });\n" +

        "  if(self.performance && typeof self.performance.now==='function'){\n" +
        "    var realPerfNow=self.performance.now.bind(self.performance);\n" +
        "    self.performance.now=function(){\n" +
        "      counts.perfNow++;\n" +
        "      perfNowWindowCount++;\n" +
        "      var t=realPerfNow();\n" +
        "      if(mode==='harden') return quantizeMs(t);\n" +
        "      return t;\n" +
        "    };\n" +
        "  }\n" +

        "  if(typeof Date.now==='function'){\n" +
        "    var realDateNow=Date.now.bind(Date);\n" +
        "    Date.now=function(){\n" +
        "      counts.dateNow++;\n" +
        "      var t=realDateNow();\n" +
        "      if(mode==='harden') return quantizeMs(t);\n" +
        "      return t;\n" +
        "    };\n" +
        "  }\n" +

        "  if(self.WebAssembly){\n" +
        "    if(typeof WebAssembly.instantiate==='function'){\n" +
        "      var ri=WebAssembly.instantiate.bind(WebAssembly);\n" +
        "      WebAssembly.instantiate=function(){ flags.wasmUsed=true; return ri.apply(null, arguments); };\n" +
        "    }\n" +
        "    if(typeof WebAssembly.instantiateStreaming==='function'){\n" +
        "      var ris=WebAssembly.instantiateStreaming.bind(WebAssembly);\n" +
        "      WebAssembly.instantiateStreaming=function(){ flags.wasmUsed=true; return ris.apply(null, arguments); };\n" +
        "    }\n" +
        "  }\n" +

        "  try { importScripts(" + JSON.stringify(abs) + "); } catch(e) {}\n" +
        "})();\n";

      var blob = new Blob([src], { type: "text/javascript" });
      return URL.createObjectURL(blob);
    }

    window.Worker = function (scriptURL, options) {

      flags.workersSpawned++;

      if (
        isModuleWorker(options) ||
        typeof scriptURL === "string" &&
        (scriptURL.startsWith("blob:") || scriptURL.startsWith("data:"))
      ) {
        // Skip bootstrap for module/blob/data workers
        return new RealWorker(scriptURL, options);
      }

      var bootUrl = makeClassicBootstrapUrl(scriptURL);
      var w = new RealWorker(bootUrl, options);

      w.addEventListener("error", function (e) {
        try { console.warn("CF bootstrap worker error:", e && (e.message || e)); } catch (_) {}
      });
      w.addEventListener("messageerror", function (e) {
        try { console.warn("CF bootstrap worker messageerror:", e); } catch (_) {}
      });


      trackedWorkers.push(w);

      // Push current mode/q_ms immediately so worker doesn't lag behind UI
      try {
        w.postMessage({
          source: "countingfish",
          type: "CF_SET_MODE",
          mode: mode,
          q_ms: qMs
        });
      } catch (e) {}


      // Aggregate telemetry
      w.addEventListener("message", function (ev) {
        var d = ev && ev.data;
        if (!d || d.source !== "countingfish" || d.type !== "CF_WORKER_TELEMETRY") return;
        ingestWorkerTelemetry(d.payload);
      });

      return w;
    };

    

    window.Worker.prototype = RealWorker.prototype;
  }

}

// Run immediately
startCountingFish();