# ==========================================
# STAGE 1: The Build Environment (Builder)
# ==========================================
FROM node:20-slim AS builder
WORKDIR /app

# Copy your package configuration files first
COPY package*.json ./

# 💡 TRICK 1: Block Puppeteer from automatically downloading its own massive browser copy
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install your dependencies cleanly inside the build stage
RUN npm ci

# Copy the rest of your backend source code
COPY . .


# ==========================================
# STAGE 2: The Lean Production Runner
# ==========================================
FROM node:20-slim
WORKDIR /app

# 💡 TRICK 2: Install ONLY the system Chromium and minimal fonts, 
# then immediately clean up the apt cache records to save hundreds of MBs!
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Copy the pre-built files and node_modules straight from Stage 1 (Builder)
COPY --from=builder /app /app

# 💡 TRICK 3: Force Puppeteer to launch the system-wide Linux Chromium executable path
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Open Port 3002
EXPOSE 3002

# The command to start your backend server
CMD ["node", "index.js"]