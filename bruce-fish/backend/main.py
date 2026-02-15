import joblib
import numpy as np
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

# Enable CORS
# This allows your frontend (Port 3000 or file://) to talk to this backend (Port 8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your domain. For hackathon, "*" is fine.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
class TraceRequest(BaseModel):
    trace: list[float]  # We expect a list of numbers (the trace)

MODEL_PATH = "model.pkl"
model = None

if os.path.exists(MODEL_PATH):
    try:
        model = joblib.load(MODEL_PATH)
        print(f"Model loaded successfully from {MODEL_PATH}")
    except Exception as e:
        print(f"Error loading model: {e}")
else:
    print(f"WARNING: {MODEL_PATH} not found. Did you run train.py?")

@app.get("/")
def read_root():
    return {"status": "Backend is running", "model_loaded": model is not None}

@app.post("/analyze")
def analyze_trace(request: TraceRequest):
    """
    Receives a memory trace, feeds it to the model, and returns the predicted website.
    """
    if model is None:
        raise HTTPException(status_code=500, detail="Model not loaded. Run train.py first.")

    # 1. Prepare Data
    # Convert list to 2D Numpy array (1 sample, N features)
    # expected shape: (1, length_of_trace)
    input_data = np.array(request.trace).reshape(1, -1)

    # 2. Predict Website
    prediction = model.predict(input_data)[0]

    # 3. Calculate Confidence
    # predict_proba returns an array of probabilities for all classes
    # We take the maximum value (the confidence of the winning class)
    probabilities = model.predict_proba(input_data)
    confidence = np.max(probabilities)

    print(f"Analyzed trace. Prediction: {prediction} ({confidence:.2%})")

    return {
        "website": str(prediction),
        "confidence": float(confidence)
    }

if __name__ == "__main__":
    import uvicorn
    # This allows you to run "python main.py" locally for testing
    uvicorn.run(app, host="0.0.0.0", port=8000)