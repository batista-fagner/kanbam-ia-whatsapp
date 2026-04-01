# Comandos para rodar o projeto

## Pré-requisitos

- Docker e Docker Compose instalados
- Node.js v22+
- Arquivo `.env` configurado na raiz de `fisio-secretary/`

---

## Docker (Evolution API + Redis + Postgres)

```bash
# Subir todos os serviços de infra
cd fisio-secretary
docker compose up -d

# Ver logs
docker compose logs -f

# Parar tudo
docker compose down

# Parar e remover volumes (cuidado: apaga dados)
docker compose down -v
```
<!-- Ngrok -->
ngrok http 3000 

Serviços que sobem:
| Serviço       | URL                    |
|---------------|------------------------|
| Evolution API | http://localhost:8080  |
| Redis         | localhost:6379         |
| PostgreSQL    | localhost:5432         |

---

## Backend (NestJS)

```bash
cd fisio-secretary/backend

# Instalar dependências (primeira vez)
npm install

# Rodar em modo desenvolvimento (hot reload)
npm run start:dev

# Rodar em modo produção
npm run build
npm run start:prod
```

Backend disponível em: `http://localhost:3000`

---

## Frontend (React + Vite)

```bash
cd fisio-secretary/frontend

# Instalar dependências (primeira vez)
npm install

# Rodar em modo desenvolvimento
npm run dev

# Build para produção
npm run build

# Visualizar build de produção
npm run preview
```

Frontend disponível em: `http://localhost:5173`

---

## Ordem recomendada para subir o projeto

```bash
# 1. Infra (Docker)
cd fisio-secretary
docker compose up -d

# 2. Backend (novo terminal)
cd fisio-secretary/backend
npm run start:dev

# 3. Frontend (novo terminal)
cd fisio-secretary/frontend
npm run dev
```

---

## Comandos úteis

```bash
# Ver containers rodando
docker ps

# Reiniciar apenas a Evolution API
docker compose restart evolution

# Acessar shell do Redis
docker exec -it fisio_redis redis-cli -a $REDIS_PASSWORD

# Acessar shell do Postgres
docker exec -it fisio_postgres psql -U postgres
```
