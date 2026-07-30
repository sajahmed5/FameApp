# Phixr video transcode worker — Node + ffmpeg, for Cloud Run.
# Node 22 (not 20): supabase-js's realtime client needs native WebSocket, which
# only exists in Node 22+.
FROM node:22-slim

# ffmpeg (+ ffprobe) for transcoding.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
