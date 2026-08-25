# syntax=docker/dockerfile:1
#
# TrueForge from the published npm package.
#
# Nothing is copied from the build context on purpose: the upstream from-source
# image needs a complete monorepo checkout, and on Windows `git clone` of that
# repository does not produce one. This recipe depends on the registry and
# nothing else, so it builds identically on any host.
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

ARG APP_VERSION
RUN test -n "$APP_VERSION" || (echo "APP_VERSION build-arg is required" >&2 && exit 1)

# Fail closed if the version is not on the registry.
RUN npm install --omit=dev "@truefoundry/trueforge@${APP_VERSION}" \
  && npm cache clean --force

EXPOSE 8790
CMD ["node", "node_modules/@truefoundry/trueforge/dist/main.js"]
