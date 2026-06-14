# syntax=docker/dockerfile:1

# --- Stage 1: build the SPA ---
FROM node:26-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- Stage 2: build the Go binary (with embedded dist) ---
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
# overwrite the placeholder dist with the freshly built SPA
COPY --from=web /web/dist ./web/dist
# Derive the app version from the release-please manifest (in the build context;
# the release commit/tag has it bumped) and stamp it into the binary via -ldflags.
RUN VERSION="$(sed -n 's/.*: *"\([0-9][^"]*\)".*/\1/p' .release-please-manifest.json)"; \
    CGO_ENABLED=0 GOOS=linux go build -trimpath \
      -ldflags="-s -w -X main.version=${VERSION:-dev}" \
      -o /out/traefik-viewer ./cmd/server

# --- Stage 3: minimal runtime ---
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/traefik-viewer /traefik-viewer
EXPOSE 8080
USER nonroot:nonroot
# Self-probe: the image is distroless (no shell/curl), so the binary checks its
# own /healthz. Honors a custom listenAddr via the same -config file.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/traefik-viewer", "-healthcheck", "-config", "/config/config.yaml"]
ENTRYPOINT ["/traefik-viewer"]
CMD ["-config", "/config/config.yaml"]
