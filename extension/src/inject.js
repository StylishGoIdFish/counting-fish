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

  if (typeof window.Worker === "function") {

    var RealWorker = window.Worker;

    window.Worker = function () {
      flags.workersSpawned++;
      return new RealWorker(arguments[0], arguments[1]);
    };

    window.Worker.prototype = RealWorker.prototype;
  }

}

// Run immediately
startCountingFish();