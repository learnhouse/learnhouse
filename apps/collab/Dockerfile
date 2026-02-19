FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY tsconfig.json ./
COPY src/ ./src/

EXPOSE 4000

CMD ["npx", "tsx", "src/index.ts"]
