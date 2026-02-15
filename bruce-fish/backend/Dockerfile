FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .

COPY . .

# Run the app
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]