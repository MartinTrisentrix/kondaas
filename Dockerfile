# ==========================================
# STAGE 1: The Build Environment (Builder)
# ==========================================
FROM node:20-slim AS builder
WORKDIR /app

COPY package*.json ./

# 🎯 Tell Puppeteer to download the browser inside /app instead of the root folder
ENV PUPPETEER_CACHE_DIR=/app/.cache
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false

RUN npm ci
COPY . .


# ==========================================
# STAGE 2: The Lean Production Runner
# ==========================================
FROM node:20-slim
WORKDIR /app

# Ensure Puppeteer knows exactly where to look for the copied browser build
ENV PUPPETEER_CACHE_DIR=/app/.cache

# Install the baseline system dependencies needed for headless browsers
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-freefont-ttf \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxtst6 \
    libgbm1 \
    libnss3 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Copy everything (including the downloaded browser in /app/.cache) from Stage 1
COPY --from=builder /app /app

# Open Port 3002
EXPOSE 3002

# Start the application
CMD ["node", "index.js"]