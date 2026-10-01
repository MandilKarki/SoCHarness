FROM node:24-bookworm-slim AS node
FROM python:3.12-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && npm install -g npm@12.2.0 --ignore-scripts
WORKDIR /app
COPY requirements-agents.txt ./
COPY workers/python-bridge/requirements.txt /opt/relay-extended-requirements.txt
RUN python -m venv /opt/relay-extended \
    && /opt/relay-extended/bin/pip install --no-cache-dir -r /opt/relay-extended-requirements.txt \
    && /opt/relay-extended/bin/pip check \
    && /opt/relay-extended/bin/pip freeze > /opt/relay-extended-resolved.txt
# The Windows lock is not a Linux lock. Capture resolved Linux versions at build time.
RUN pip install --no-cache-dir -r requirements-agents.txt \
    && pip freeze > /opt/relay-python-resolved.txt && pip check
COPY workers/agent-bridge/package*.json workers/agent-bridge/
RUN cd workers/agent-bridge && npm ci --ignore-scripts
COPY services/ services/
COPY web/ web/
COPY plugins/ plugins/
COPY workers/agent-bridge/*.mjs workers/agent-bridge/
COPY workers/python-bridge/ workers/python-bridge/
RUN useradd --uid 10001 --create-home relay && mkdir -p /data && chown relay:relay /data
USER relay
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 RELAY_MODE=pilot RELAY_BIND=0.0.0.0 RELAY_DATA_DIR=/data RELAY_MAX_RUNS=2 PORT=8787
ENV RELAY_GOOGLE_ADK_PYTHON=/opt/relay-extended/bin/python RELAY_MICROSOFT_PYTHON=/opt/relay-extended/bin/python RELAY_OPENHANDS_PYTHON=/opt/relay-extended/bin/python
EXPOSE 8787
CMD ["python", "services/app.py"]
