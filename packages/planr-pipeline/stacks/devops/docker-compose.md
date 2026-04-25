# Stack: Docker Compose

> **Category:** devops
> **Version:** Compose v2 (docker compose)
> **Docs:** https://docs.docker.com/compose/
> **Created:** Template — edit via /discover-stack devops

---

## Overview

Docker Compose for local development and staging environments.
Defines multi-container applications in a single `docker-compose.yml`.

---

## Project Structure

```
docker/
├── app/
│   └── Dockerfile              ← App container
├── nginx/
│   └── nginx.conf              ← Reverse proxy config (if used)
└── scripts/
    └── init-db.sh              ← DB initialization script (if needed)

docker-compose.yml              ← Development compose file
docker-compose.prod.yml         ← Production overrides
.env                            ← Local env vars (never commit)
.env.example                    ← Committed env template
```

---

## Standard docker-compose.yml Pattern

```yaml
version: '3.9'

services:
  app:
    build:
      context: .
      dockerfile: docker/app/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/appdb
      - NODE_ENV=development
    volumes:
      - .:/app
      - /app/node_modules
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
      POSTGRES_DB: appdb
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

---

## Common Commands

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f app

# Run command in container
docker compose exec app npm run migrate

# Stop all
docker compose down

# Stop + remove volumes (destroys DB data)
docker compose down -v

# Rebuild app image
docker compose build app
```

---

## .env.example Pattern

```bash
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/appdb
DB_HOST=localhost
DB_PORT=5432
DB_NAME=appdb
DB_USER=postgres
DB_PASSWORD=password

# App
NODE_ENV=development
PORT=3000
JWT_SECRET=change-me-in-production

# Redis (if used)
REDIS_URL=redis://localhost:6379
```

---

## Agent Usage Notes

- Always reference `docker-compose.yml` service names as DB_HOST values
- DB_HOST for containerized app = service name (e.g., `db`), not `localhost`
- Agent must add new env vars to `.env.example` when creating new service integrations
- Never commit `.env` — only `.env.example`
