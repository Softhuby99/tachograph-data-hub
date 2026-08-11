# Tacho Data Hub (TDH) - Tachograph Cards Info Tool
# Static build: the standalone app is fully self-contained (data embedded).
FROM nginx:1.27-alpine

# App files
COPY standalone/index.html /usr/share/nginx/html/index.html
COPY standalone/data.json  /usr/share/nginx/html/data.json

# Basic hardening / defaults
RUN rm -f /etc/nginx/conf.d/default.conf

EXPOSE 80 443
