FROM ubuntu:24.04

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install postfix and cleanup to keep image small
RUN apt-get update && apt-get install -y \
    postfix \
    ca-certificates \
    netcat-openbsd 

# Create the user with home directory at /var/mail/dumpuser
RUN useradd -m -d /var/mail/dumpuser dumpuser && \
    mkdir -p /var/mail/dumpuser/Maildir/{new,cur,tmp} && \
    chown -R dumpuser:mail /var/mail/dumpuser

# Expose SMTP port
EXPOSE 25

# Use a startup script to handle the config copy
COPY <<-"EOT" /entrypoint.sh
#!/bin/bash

echo "overleaf.local" > /etc/mailname

# Copy mounted config to real location
cp /config/main.cf /etc/postfix/main.cf
chown root:root /etc/postfix/main.cf

# Ensure the Maildir exists with correct permissions
chown -R dumpuser:mail /var/mail/dumpuser
chmod 755 /var/mail/dumpuser

# Start postfix in foreground
exec postfix start-fg
EOT

RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
