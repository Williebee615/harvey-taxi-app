# Membrane: Harvey Taxi's own embedding service (Render private service).
# The model is downloaded at build time, so the running service needs no
# outbound access and never sends text anywhere.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt fetch.py serve.py ./
RUN pip install --no-cache-dir -r requirements.txt

ARG MODEL_REPO=intfloat/multilingual-e5-small
ARG MODEL_REVISION=
RUN mkdir -p /model && python -I fetch.py "$MODEL_REPO" /model $MODEL_REVISION

RUN useradd --create-home membrane && chown -R membrane /model
USER membrane
CMD ["python", "-I", "serve.py", "/model"]
