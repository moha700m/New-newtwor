FROM mcr.microsoft.com/playwright:v1.63.0-noble AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json eslint.config.js .prettierrc ./
COPY src ./src
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN chown -R pwuser:pwuser /app
USER pwuser
EXPOSE 8787
CMD ["node", "dist/index.js"]
