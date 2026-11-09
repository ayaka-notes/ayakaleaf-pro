# Apprise REST API on the official apprise CLI image (apprise lib included).
# One endpoint (POST /notify) for 100+ notification channels
# (mailto, telegram, discord, slack, ntfy, pushover, …).
# server.py is a minimal stdlib REST wrapper implementing the
# apprise-api /notify contract, with SMTP defaults from the env.
FROM caronc/apprise

# apprise 2.x removed the mailto/SMTP plugin; 1.13.x has the full plugin set
RUN pip install --no-cache-dir 'apprise==1.13.1'

# webpush: signs + encrypts Web Push notifications (browser popups) for the
# webpush:// scheme, which apprise itself does not ship.
RUN pip install --no-cache-dir webpush

COPY server.py /app/apprise-rest.py

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/status', timeout=5)" || exit 1

CMD ["python", "/app/apprise-rest.py"]
