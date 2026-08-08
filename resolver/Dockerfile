FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app
ENV NODE_ENV=production PORT=8080

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 8080
CMD ["node", "src/server.js"]
