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
  var mode = "monitor";   // default for demo
  var qMs = 2;            // quantization bucket in ms


  // Keep references to all wrapped workers so we can update their mode later
  var trackedWorkers = [];


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
    raf: 0,

    // Worker-side counters (reported by our worker wrapper)
    workerPerfNow: 0,
    workerDateNow: 0,
    workerBurstMax: 0
  };



  var flags = {
    wasmUsed: false,
    workersSpawned: 0
  };

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
          raf: counts.raf,

          workerPerfNow: counts.workerPerfNow,
          workerDateNow: counts.workerDateNow,
          workerBurstMax: counts.workerBurstMax
        },
        bursts: {
          perfNowPer100msMax: perfNowPer100msMax
        },
        flags: {
          wasmUsed: flags.wasmUsed,
          workersSpawned: flags.workersSpawned
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

    counts.workerPerfNow = 0;
    counts.workerDateNow = 0;
    counts.workerBurstMax = 0;


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
      // Propagate new mode to all tracked workers
    for (var i = 0; i < trackedWorkers.length; i++) {
      try {
        trackedWorkers[i].postMessage({
          __cf: "set_mode",
          mode: mode,
          q_ms: qMs
        });
      } catch (e) {
        // Worker might already be terminated; ignore.
      }
    }


  });

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

    // -----------------------------
  // Wrap Worker constructor (instrument + count)
  // Supports classic workers (importScripts). Falls back for module workers.
  // -----------------------------
  if (typeof window.Worker === "function") {

    var RealWorker = window.Worker;

    function buildWorkerWrapperSource(originalUrl) {
      return `
        (function () {
          "use strict";

          var mode = "monitor";
          var qMs = 2;

          var counts = { perfNow: 0, dateNow: 0 };
          var perfNowWindowCount = 0;
          var perfNowPer100msMax = 0;

          function quantizeMs(t) {
            return Math.floor(t / qMs) * qMs;
          }

          // Burst window reset every 100ms
          setInterval(function () {
            if (perfNowWindowCount > perfNowPer100msMax) {
              perfNowPer100msMax = perfNowWindowCount;
            }
            perfNowWindowCount = 0;
          }, 100);

          // Send telemetry to the page every 1s
          setInterval(function () {
            try {
              postMessage({
                __cf: "worker_telemetry",
                payload: {
                  counts: { perfNow: counts.perfNow, dateNow: counts.dateNow },
                  bursts: { perfNowPer100msMax: perfNowPer100msMax },
                  mode: mode,
                  q_ms: qMs,
                  ts: Date.now()
                }
              });
            } catch (e) {}

            counts.perfNow = 0;
            counts.dateNow = 0;
            perfNowPer100msMax = 0;
          }, 1000);

          // Listen for mode updates from the page
          self.addEventListener("message", function (e) {
            var d = e.data;
            if (!d || d.__cf !== "set_mode") return;

            if (d.mode === "off" || d.mode === "monitor" || d.mode === "harden") {
              mode = d.mode;
            }
            if (typeof d.q_ms === "number" && isFinite(d.q_ms) && d.q_ms > 0 && d.q_ms <= 50) {
              qMs = d.q_ms;
            }
          });

          // Wrap performance.now
          if (self.performance && typeof self.performance.now === "function") {
            var realPerfNow = self.performance.now.bind(self.performance);

            self.performance.now = function () {
              counts.perfNow++;
              perfNowWindowCount++;

              var t = realPerfNow();
              if (mode === "harden") return quantizeMs(t);
              return t;
            };
          }

          // Wrap Date.now
          if (typeof Date.now === "function") {
            var realDateNow = Date.now.bind(Date);

            Date.now = function () {
              counts.dateNow++;
              var t = realDateNow();
              if (mode === "harden") return quantizeMs(t);
              return t;
            };
          }

          // Load the original worker script AFTER wrappers are installed
          try {
            importScripts(${JSON.stringify(originalUrl)});
          } catch (e) {
            try { postMessage({ __cf: "worker_error", error: String(e) }); } catch (e2) {}
          }
        })();
      `;
    }

    window.Worker = function (scriptUrl, options) {
      // Count worker creation (page-level flag)
      flags.workersSpawned++;

      // Module workers: v1 fallback (importScripts doesn't work in modules)
      if (options && options.type === "module") {
        return new RealWorker(scriptUrl, options);
      }

      var originalUrl = String(scriptUrl);

      // Create wrapper worker from a Blob
      var wrapperSrc = buildWorkerWrapperSource(originalUrl);
      var blob = new Blob([wrapperSrc], { type: "text/javascript" });
      var blobUrl = URL.createObjectURL(blob);

      var w = new RealWorker(blobUrl);
      trackedWorkers.push(w);
      try { URL.revokeObjectURL(blobUrl); } catch (e) {}

      // Send current mode immediately
      try { w.postMessage({ __cf: "set_mode", mode: mode, q_ms: qMs }); } catch (e) {}

      // Merge worker telemetry into page telemetry counters
      w.addEventListener("message", function (evt) {
        var d = evt.data;
        if (!d || !d.__cf) return;

        if (d.__cf === "worker_telemetry" && d.payload) {
          var c = d.payload.counts || {};
          var b = d.payload.bursts || {};

          counts.workerPerfNow += (c.perfNow || 0);
          counts.workerDateNow += (c.dateNow || 0);

          var wb = (b.perfNowPer100msMax || 0);
          if (wb > counts.workerBurstMax) counts.workerBurstMax = wb;
        }

        // If you want debugging:
        // if (d.__cf === "worker_error") console.warn("Worker wrapper error:", d.error);
      });

      return w;
    };

    window.Worker.prototype = RealWorker.prototype;
  }


}

// Run immediately
startCountingFish();