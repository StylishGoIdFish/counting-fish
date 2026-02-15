import json
import time
import os
import sys
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options

# Points to bruce
ATTACKER_URL = "http://localhost:3000" 

# save data for training
OUTPUT_FILE = "traces.out"

# Trace settings 
TRACE_DURATION_MS = 5000
SAMPLES_PER_SITE = 20 

TARGET_SITES = [
    "https://google.com",
    "https://youtube.com",
    "https://facebook.com",
    "https://amazon.com",
    "https://reddit.com",
    "https://yahoo.com",
    "https://bing.com",
    "https://instagram.com",
    "https://x.com",
    "https://chatgpt.com",
    "https://wikipedia.org",
    "https://linkedin.com",
    "https://weather.com",
    "https://ebay.com",
    "https://nytimes.com",
    "https://walmart.com",
    "https://office.com",
    "https://espn.com",
    "https://fandom.com",
    "https://netflix.com",
    "https://duckduckgo.com",
    "https://instructure.com",
    "https://zillow.com",
    "https://cnn.com",
    "https://pinterest.com",
    "https://live.com",
    "https://microsoft.com",
    "https://foxnews.com",
    "https://etsy.com",
    "https://gemini.google.com",
    "https://twitch.tv",
    "https://paypal.com",
    "https://target.com",
    "https://zoom.us",
    "https://aol.com",
    "https://duosecurity.com",
    "https://roblox.com",
    "https://chase.com",
    "https://discord.com",
    "https://office365.com",
    "https://indeed.com",
    "https://imdb.com",
    "https://apple.com",
    "https://homedepot.com",
    "https://quora.com",
    "https://tripadvisor.com",
    "https://mayoclinic.org",
    "https://wellsfargo.com",
    "https://capitalone.com",
    "https://t-mobile.com"
]

def get_browser(is_victim=False):
    """
    Creates a Chrome browser instance using Selenium's built-in manager.
    """
    chrome_opts = Options()
    
    # Anti-bot detection
    chrome_opts.add_argument("--disable-blink-features=AutomationControlled")
    chrome_opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    
    if is_victim:
        chrome_opts.add_argument("--incognito")

    # FIX: We remove 'Service(ChromeDriverManager().install())'
    # Selenium 4.6+ can handle this automatically now.
    driver = webdriver.Chrome(options=chrome_opts)
    return driver

def main():
    print(f"Starting Data Collection")
    print(f"Target: {ATTACKER_URL}")
    print(f"Output: {OUTPUT_FILE}")
    print(f"Sites: {len(TARGET_SITES)} | Samples per site: {SAMPLES_PER_SITE}")

    # Initialize bruce 
    attacker = get_browser(is_victim=False)
    attacker.set_window_size(500, 600)
    
    try:
        attacker.get(ATTACKER_URL)
        time.sleep(2) # Allow React/HTML to load
    except Exception as e:
        print(f"Error connecting to {ATTACKER_URL}. Is Docker running?")
        attacker.quit()
        sys.exit(1)

    # Configure the Attack Script
    attacker.execute_script(f"window.trace_length = {TRACE_DURATION_MS}")
    attacker.execute_script("window.using_automation_script = true")

    collected_traces = []
    collected_labels = []
    
    total_ops = len(TARGET_SITES) * SAMPLES_PER_SITE
    current_op = 0

    for url in TARGET_SITES:
        print(f"\nScanning: {url}")

        for i in range(SAMPLES_PER_SITE):
            current_op += 1
            print(f"   [{current_op}/{total_ops}] Visiting {url}...")
            
            # 1. Start Recording
            attacker.execute_script("collectTrace()")
            
            # 2. Open Victim
            victim = None
            try:
                victim = get_browser(is_victim=True)
                victim.set_window_size(1024, 768)
                victim.get(url)
                time.sleep((TRACE_DURATION_MS / 1000) + 1)
            except Exception as e:
                print(f"Error visiting {url}: {e}")
            finally:
                if victim:
                    victim.quit() 

            # 3. Wait for Recording to Finish
            max_retries = 50
            while attacker.execute_script("return window.recording"):
                time.sleep(0.1)
                max_retries -= 1
                if max_retries == 0:
                    print("Timeout waiting for trace completion")
                    break

            # --- CHANGE 2: Robust Trace Retrieval ---
            # We explicitly check if traces exist before trying to access index -1
            trace_count = attacker.execute_script("return window.traces.length")
            
            if trace_count > 0:
                trace_data = attacker.execute_script("return window.traces[window.traces.length - 1]")
                # Validate the trace isn't empty (sometimes happens on quick loads)
                if trace_data and len(trace_data) > 0:
                    collected_traces.append(trace_data)
                    collected_labels.append(url)
                    print(f"      -> Captured trace length: {len(trace_data)}")
                else:
                    print("      -> WARNING: Trace was empty!")
            else:
                print("      -> WARNING: No traces found in browser memory.")

    # --- CHANGE 3: Write File Logic (Matches Assignment Format) ---
    print(f"\nSaving {len(collected_traces)} traces to {OUTPUT_FILE}...")
    
    output = {
        "traces": collected_traces,
        "labels": collected_labels
    }
    
    # We remove the os.makedirs call because we are saving to the current folder.
    # This prevents the directory error.
    try:
        with open(OUTPUT_FILE, "w") as f:
            # separators=(",", ":") makes the file smaller (compact JSON), matching the lab
            json.dump(output, f, separators=(",", ":")) 
        print(f"SUCCESS: Data saved to {os.path.abspath(OUTPUT_FILE)}")
    except Exception as e:
        print(f"FAILED to write file: {e}")
        
    attacker.quit()

if __name__ == "__main__":
    main()