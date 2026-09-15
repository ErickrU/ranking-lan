# Ranking LAN · imagen de produccion
# El servidor no tiene dependencias (solo modulos nativos de Node), asi que la
# imagen es: copiar el proyecto y arrancar el proxy. Sin npm install.
FROM node:22-alpine

ENV NODE_ENV=production \
    PUERTO=8080

WORKDIR /app

# .dockerignore excluye .env (la clave NUNCA se hornea en la imagen),
# herramientas de desarrollo y basura local.
COPY --chown=node:node . .

# Usuario sin privilegios: el puerto 8080 no necesita root.
USER node

EXPOSE 8080

CMD ["node", "servidor/proxy.mjs"]
