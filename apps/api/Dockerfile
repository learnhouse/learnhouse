# Use an official Python runtime as a parent image
FROM python:3.12.3-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=off \
    PIP_DISABLE_PIP_VERSION_CHECK=on 

# Set work directory
WORKDIR /usr/learnhouse-api

# Install system dependencies and Poetry
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

# Copy only requirements to cache them in docker layer
COPY uv.lock pyproject.toml ./

# Install dependencies using uv
RUN uv sync

# Copy the current directory contents into the container
COPY . .

# Run the application
CMD ["python", "app.py"]