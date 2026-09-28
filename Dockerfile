FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "dist/src/index.js"]
