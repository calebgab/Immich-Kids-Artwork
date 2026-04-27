FROM node:20-alpine
WORKDIR /app
COPY server.js .
COPY immich-artwork-camera.html .
COPY manifest.json .
COPY icon.svg .
COPY sw.js .
EXPOSE 3000
CMD ["node", "server.js"]
