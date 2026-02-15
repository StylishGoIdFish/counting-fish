import json
import numpy as np
import joblib
import os
from sklearn.ensemble import RandomForestClassifier

# --- CONFIGURATION ---
TRAINING_FILE = "traces.out"
MODEL_FILE = "model.pkl"

def train():
    print(f"Training...")
    
    # Check if data exists
    if not os.path.exists(TRAINING_FILE):
        print(f"Error: {TRAINING_FILE} not found")
        print("   Make sure 'traces.out' is inside the /backend folder.")
        return

    # Load the Data 
    print(f"   Loading data from {TRAINING_FILE}...")
    with open(TRAINING_FILE, "r") as f:
        data = json.load(f)

    # Extract and Clean Data
    X = np.array(data["traces"])
    raw_labels = data["labels"]
    y = [label.replace("https://", "").replace("www.", "").replace("/", "") for label in raw_labels]
    y = np.array(y)

    print(f"   Training on {len(X)} traces.")
    print(f"   Unique sites identified: {len(np.unique(y))}")

    print("   Building Random Forest...")
    clf = RandomForestClassifier(n_estimators=500, n_jobs=-1, random_state=42)
    clf.fit(X, y)

    # Save the model
    joblib.dump(clf, MODEL_FILE)
    print(f"Model saved to {MODEL_FILE}")

if __name__ == "__main__":
    train()