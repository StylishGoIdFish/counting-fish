# 1. Base Image: Use a lightweight Python version optimized for ML
FROM python:3.11-slim

# 2. Set the working directory inside the container
WORKDIR /app

# 3. Install System Dependencies
# 'build-essential' is often needed to compile math libraries like NumPy
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 4. Install Python Libraries
# We copy requirements.txt FIRST to leverage Docker caching.
# If you change your code but not your libraries, this step is skipped (saving time).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. Copy the Application Code
# This includes main.py and your model.pkl
COPY . .

# 6. Expose the API Port
EXPOSE 8000

# 7. Start the Server
# We bind to 0.0.0.0 to allow access from outside the container
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]