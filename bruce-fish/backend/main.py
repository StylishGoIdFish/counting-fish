import joblib
import numpy as np
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

# Enable CORS
# allows frontend to talk to this backend
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

    input_data = np.array(request.trace).reshape(1, -1)
    prediction = model.predict(input_data)[0]
    probabilities = model.predict_proba(input_data)
    confidence = np.max(probabilities)

    print(f"Analyzed trace. Prediction: {prediction} ({confidence:.2%})")

    return {
        "website": str(prediction),
        "confidence": float(confidence)
    }

if __name__ == "__main__":
    import uvicorn
    # for local testing
    uvicorn.run(app, host="0.0.0.0", port=8000)