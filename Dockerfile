# Ranking LAN · imagen de produccion
# El servidor no tiene dependencias (solo modulos nativos de Node), asi que la
# imagen es: copiar el proyecto y arrancar el proxy. Sin npm install.
FROM node:22-alpine3.24

# Parches de Alpine: la imagen oficial de Node se publica con los paquetes de
# la fecha de su build, no con los ultimos del repositorio (ej. CVE-2026-4738:
# zlib 1.3.2-r1 instalado, 1.4-r0 disponible en v3.24/main). Este paso trae
# los parches en cada reconstruccion; en despliegue se construye con --pull.
RUN apk upgrade --no-cache

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
