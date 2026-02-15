import joblib
import numpy as np
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TraceRequest(BaseModel):
    trace: list[float] 

MODEL_PATH = "model.pkl"
model = None
EXPECTED_LENGTH = None

if os.path.exists(MODEL_PATH):
    try:
        model = joblib.load(MODEL_PATH)
        # Random Forest stores the number of training features in n_features_in_
        if hasattr(model, "n_features_in_"):
            EXPECTED_LENGTH = model.n_features_in_
            print(f"Model loaded. Expecting input length: {EXPECTED_LENGTH}")
        else:
            print("Model loaded (Warning: Could not determine expected length)")
    except Exception as e:
        print(f"Error loading model: {e}")
else:
    print(f"⚠️ WARNING: {MODEL_PATH} not found.")

def normalize_trace(trace, target_length):
    """
    Stretches or shrinks the input trace to match the target_length.
    """
    if target_length is None:
        return trace
        
    current_length = len(trace)
    if current_length == target_length:
        return trace
    
    x_old = np.linspace(0, 1, current_length)
    x_new = np.linspace(0, 1, target_length)
    return np.interp(x_new, x_old, trace)

@app.post("/analyze")
def analyze_trace(request: TraceRequest):
    if model is None:
        raise HTTPException(status_code=500, detail="Model not loaded.")

    try:
        raw_trace = np.array(request.trace)
        if EXPECTED_LENGTH:
            clean_trace = normalize_trace(raw_trace, EXPECTED_LENGTH)
        else:
            clean_trace = raw_trace
        input_data = clean_trace.reshape(1, -1)
        prediction = model.predict(input_data)[0]
        probabilities = model.predict_proba(input_data)
        confidence = np.max(probabilities)

        print(f"🔍 Trace resized ({len(raw_trace)}->{len(clean_trace)}). Prediction: {prediction} ({confidence:.2%})")

        return {
            "website": str(prediction),
            "confidence": float(confidence)
        }

    except Exception as e:
        print(f"🔥 Prediction Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)