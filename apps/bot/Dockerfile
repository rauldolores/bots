# Imagen para el canal de Voz en un servidor de larga vida (Fly.io, Railway,
# Docker local o cualquier VPS) — ver src/runtime/node.ts. Se instalan las
# devDependencies A PROPÓSITO: "npm start" corre con tsx (src/runtime/node.ts
# no se compila para este destino, a diferencia de Vercel/vercel.ts), y tsx
# vive en devDependencies.
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
