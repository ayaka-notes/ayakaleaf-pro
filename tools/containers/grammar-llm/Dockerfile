# syntax=docker/dockerfile:1
#
# grammar-llm container — LanguageTool-compatible (v2 API) grammar checker.
# Drop-in replacement for erikvl87/languagetool (docker-languagetool):
# same port (8010), same /v2/languages + /v2/check wire API, backed by the
# grammar-llm engine (GRMR-V3-G4B fine-tuned LLM via node-llama-cpp).
#
# Build (from this project directory):
#   docker build -t grammar-llm .
#
# Run (model auto-downloads on first start unless pre-provisioned):
#   docker run -p 8010:8010 --name grammar-llm -v grammar-llm-models:/models grammar-llm
#
# The model (~2.5 GB for Q4_K_M) is NOT baked into the image: put it in the
# /models volume (file name GRMR-V3-G4B-Q4_K_M.gguf by default) or let the
# container download it from Hugging Face on first start. See README.md.

ARG NODE_TAG=24

# ---------- build stage ----------
FROM node:${NODE_TAG}-bookworm-slim AS build
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /build

# Install all deps (needed for bundling: esbuild; runtime: node-llama-cpp).
# The @node-llama-cpp/* prebuilt platform package for THIS build platform is
# what makes the bundle loadable; we re-install runtime deps for the TARGET
# platform in the next stage (docker build --platform handles cross-arch).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY build.mjs ./
COPY core/ core/
COPY src/ src/
RUN node build.mjs \
    && npm prune --omit=dev

# Sanity: the bundle must resolve its only external (node-llama-cpp).
RUN node --input-type=module -e "import('node-llama-cpp').then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); })"

# ---------- runtime stage ----------
FROM node:${NODE_TAG}-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PORT=8010 \
    GRAMMAR_LLM_MODEL_DIR=/models \
    GRAMMAR_LLM_PRELOAD=true

WORKDIR /app

# Install runtime-only deps (node-llama-cpp + prebuilt native lib) for the
# target platform of the image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && node -e "import('node-llama-cpp').then(() => process.exit(0)).catch(() => process.exit(1))"

COPY --from=build /build/dist ./dist
COPY start.sh ./
RUN chmod +x start.sh \
    && useradd -m -d /home/grammarllm -s /nonexistent grammarllm 2>/dev/null || true \
    && mkdir -p /models \
    && chown -R grammarllm:grammarllm /models /app

USER grammarllm
VOLUME ["/models"]
EXPOSE 8010

# Model download can take a while on first start → generous start period.
HEALTHCHECK --interval=30s --timeout=10s --start-period=1800s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8010) + '/v2/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["./start.sh"]
