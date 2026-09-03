# One image, two runtimes. Node serves the API, the WebSocket and the React
# build; Python serves the RAG service on localhost. One deploy, one cold start,
# no CORS — the same "one process, one port" property the app had before P5,
# with a second process that only Node can reach.
FROM node:22-slim

# Python for rag/, plus the toolchain PyMuPDF and onnxruntime wheels expect.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a source change doesn't reinstall them.
COPY package.json package-lock.json ./
RUN npm ci

COPY rag/requirements.txt ./rag/
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r rag/requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

COPY . .
RUN npm run build

# Download the embedding model at build time. Left to first use it would be a
# ~90MB download inside the first upload, which reads as a hung request.
RUN python3 -c "from fastembed import TextEmbedding; TextEmbedding(model_name='sentence-transformers/all-MiniLM-L6-v2')"

ENV NODE_ENV=production
ENV RAG_SERVICE_URL=http://127.0.0.1:8000
EXPOSE 4000

# uvicorn in the background, Node in the foreground so the container's lifetime
# tracks the process that actually serves users. `exec` keeps Node as PID 1 so
# it receives SIGTERM directly on shutdown.
CMD ["sh", "-c", "uvicorn main:app --app-dir rag --host 127.0.0.1 --port 8000 & exec npx tsx src/server/index.ts"]
