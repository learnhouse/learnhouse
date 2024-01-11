# 
FROM python:3.11

# poetry 
RUN pip install poetry

# 
WORKDIR /usr/learnhouse/apps/api

# 
COPY ./requirements.txt /usr/learnhouse/requirements.txt

# 
RUN poetry config virtualenvs.create false \
    && pip install --upgrade pip \
    && pip install -r /usr/learnhouse/requirements.txt

# 
COPY ./ /usr/learnhouse

# 
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "80" , "--reload" ]
