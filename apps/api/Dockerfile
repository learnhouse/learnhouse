FROM python:3.14.6-slim-bookworm

# Install curl and netcat for health checks and service waiting, plus ffmpeg
# for video faststart remuxing (moves the MP4 moov atom to the front so long
# videos stream smoothly).
RUN apt-get update && apt-get install -y --no-install-recommends curl netcat-openbsd build-essential ffmpeg && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.10.7 /uv /uvx /bin/

# UV_COMPILE_BYTECODE bakes .pyc into the image. Without it every container start
# recompiles ~2200 modules from source, which measured at 17s of the API's cold start.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# Dependencies first, in their own layer. Previously the whole project was copied
# before `uv sync`, so any source change invalidated the ~340MB venv layer and every
# commit produced a fresh multi-hundred-MB layer for nodes to pull.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

# Copy the project into the image
ADD . /app

# Remove Enterprise Edition folder for public builds
ARG LEARNHOUSE_PUBLIC=false
RUN if [ "$LEARNHOUSE_PUBLIC" = "true" ]; then rm -rf /app/ee; fi

# Sync again so the lockfile is verified against the copied project
RUN uv sync --frozen

# Copy entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Expose port
EXPOSE 9000

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:9000/api/v1/health || exit 1

# Use entrypoint script
ENTRYPOINT ["./docker-entrypoint.sh"]