# 
FROM python:3.11

# 
WORKDIR /usr/learnhouse

# 
COPY ./requirements.txt /usr/learnhouse/requirements.txt

# 
RUN pip install --no-cache-dir --upgrade -r /usr/learnhouse/requirements.txt

# 
COPY ./ /usr/learnhouse

# 
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "80" ]
