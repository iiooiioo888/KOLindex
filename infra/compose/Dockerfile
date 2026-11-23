# 只提供 KOLindex 網頁。MyLike 的登入態同步不在這個映像裡，也不會在開機時執行。
FROM node:22.21.0-bookworm-slim@sha256:f9f7f95dcf1f007b007c4dcd44ea8f7773f931b71dc79d57c216e731c87a090b

WORKDIR /app

COPY --chown=node:node index2.html ./index2.html
COPY --chown=node:node css ./css
COPY --chown=node:node js ./js
COPY --chown=node:node fonts ./fonts
COPY --chown=node:node tests/dev-server.mjs ./tests/dev-server.mjs

USER node

ENV HOST=0.0.0.0 \
    PORT=5200 \
    KOL_PROD=1 \
    NODE_ENV=production

EXPOSE 5200

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5200/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "tests/dev-server.mjs", "/app", "5200"]
