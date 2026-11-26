FROM ghcr.io/ayaka-notes/overleaf-pro:6.3.4
COPY catalog.mjs /overleaf/services/web/modules/workbench/app/src/LocalModelCatalog.mjs
COPY connection.mjs /overleaf/services/web/modules/workbench/app/src/LocalConnection.mjs
COPY build.mjs picker.js /tmp/aya-picker/
RUN cd /overleaf/services/web && node /tmp/aya-picker/build.mjs
