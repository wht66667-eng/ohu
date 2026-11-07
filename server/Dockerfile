FROM node:20-alpine

WORKDIR /app

# 仅复制依赖清单以利用 Docker 缓存
COPY package*.json ./
RUN npm install --omit=dev

# 复制源代码
COPY src/ ./src/
COPY sql/ ./sql/

# 云托管会注入 DATABASE_URL、PORT 等环境变量
ENV NODE_ENV=production
ENV PORT=80

EXPOSE 80

CMD ["node", "src/server.js"]
