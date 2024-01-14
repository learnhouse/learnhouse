# 
FROM python:3.11

# poetry 
RUN pip install poetry

# 
WORKDIR /usr/learnhouse/apps/api

# Copy poetry.lock* in case it doesn't exist in the repo
COPY ./poetry.lock* /usr/learnhouse/

# Copy project requirement files here to ensure they will be cached.
COPY pyproject.toml /usr/learnhouse/

# Install poetry
RUN pip install --upgrade pip \
    && pip install poetry \
    && poetry config virtualenvs.create false

# Install project dependencies.
RUN poetry install --no-interaction --no-ansi

# 
COPY ./ /usr/learnhouse

# 
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "80" , "--reload" ]
