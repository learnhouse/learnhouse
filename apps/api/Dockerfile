FROM python:3.14.3-slim-bookworm

# Install curl and netcat for health checks and service waiting, plus ffmpeg
# for video faststart remuxing (moves the MP4 moov atom to the front so long
# videos stream smoothly).
RUN apt-get update && apt-get install -y --no-install-recommends curl netcat-openbsd build-essential ffmpeg && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.10.7 /uv /uvx /bin/

# Copy the project into the image
ADD . /app

# Remove Enterprise Edition folder for public builds
ARG LEARNHOUSE_PUBLIC=false
RUN if [ "$LEARNHOUSE_PUBLIC" = "true" ]; then rm -rf /app/ee; fi

# Sync the project into a new environment, using the frozen lockfile
WORKDIR /app
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