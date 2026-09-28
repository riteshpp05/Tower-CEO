FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (e.g. for psycopg2, chromadb, etc if needed)
RUN apt-get update && apt-get install -y build-essential libpq-dev && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY . .

# Expose ports that might be used
EXPOSE 3000 3001 3002

# Default command (overridden by docker-compose)
CMD ["python", "proxy.py"]
