# Build Frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend ./
# Build frontend static files (will be exported to /app/frontend/out)
RUN npm run build

# Build Backend and serve
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies (needed for any native compilation during pip install)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend ./backend

# Copy static frontend build from frontend-build stage
COPY --from=frontend-build /app/frontend/out ./frontend/out

# Create data directory for Cognee local storage/fallback
RUN mkdir -p /app/backend/data && chmod 777 /app/backend/data

EXPOSE 8000

ENV PORT=8000
ENV HOST=0.0.0.0

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
