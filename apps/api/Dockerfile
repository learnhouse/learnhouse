FROM python:3.14.7-alpine3.24

# Install curl and netcat for health checks and service waiting, plus ffmpeg
# for video faststart remuxing (moves the MP4 moov atom to the front so long
# videos stream smoothly). bash runs the entrypoint; libstdc++ backs a few
# prebuilt wheels. `apk upgrade` picks up fixes published after the base image.
RUN apk upgrade --no-cache \
    && apk add --no-cache curl netcat-openbsd ffmpeg bash libstdc++

# uv manages the application environment. Remove the unused pip installer and
# its bundled bootstrap wheel so their vendored packages do not ship at runtime.
RUN python -m pip uninstall --yes pip \
    && rm -rf /usr/local/lib/python3.14/ensurepip

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
RUN uv sync --frozen --no-dev --no-install-project --no-cache

# Copy the project into the image
COPY . /app

# Remove Enterprise Edition folder for public builds
ARG LEARNHOUSE_PUBLIC=false
RUN if [ "$LEARNHOUSE_PUBLIC" = "true" ]; then rm -rf /app/ee; fi

# Sync again so the lockfile is verified against the copied project
RUN uv sync --frozen --no-dev --no-cache

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
