FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server.mjs ./
USER node
EXPOSE 8080
# /healthz needs the key, which the container already has in its environment.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz',{headers:{'x-proxy-key':process.env.PROXY_KEY}}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.mjs"]
