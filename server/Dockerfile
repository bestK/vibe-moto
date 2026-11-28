FROM golang:1.24-alpine AS builder
WORKDIR /src

RUN apk add --no-cache ca-certificates git

COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/vibe-moto-server ./cmd/server

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata wget
WORKDIR /app

COPY --from=builder /out/vibe-moto-server /app/vibe-moto-server
RUN mkdir -p /app/data/worlds

ENV HTTP_ADDR=:25580
ENV MC_ADDR=:25565
ENV DATA_DIR=/app/data
ENV MC_MOTD="VIBE MOTO Open World // 暴力摩托开放世界"

EXPOSE 25580 25565

VOLUME ["/app/data"]

ENTRYPOINT ["/app/vibe-moto-server"]
