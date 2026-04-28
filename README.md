# Account Resource Manager

Monorepo for the account resource management system.

## Structure

- `apps/web`: Next.js + Ant Design admin console
- `services/api`: reserved for the Go API service
- `services/worker`: Python worker service for ChatGPT payment registration and background tasks
- `packages/shared`: reserved for shared types and utilities
- `infra`: deployment and infrastructure notes
- `docs`: product and technical notes

## Quick start

### Start with Docker Compose (Recommended)

```bash
# Start all services (PostgreSQL + Worker)
docker-compose up -d

# Start web app
npm install
npm run dev:web
```

### Manual Setup

1. Start PostgreSQL:
```bash
docker-compose up postgres -d
```

2. Start Worker Service:
```bash
cd services/worker
pip install -r requirements.txt
python main.py
```

3. Start Web App:
```bash
npm install
npm run dev:web
```

## Environment

For mailbox APIs backed by PostgreSQL, configure:

- `ARM_DATABASE_URL` or `DATABASE_URL`: PostgreSQL connection string
- `ARM_DATABASE_SSL=require`: optional, enables SSL with relaxed certificate validation
- `ARM_DATA_ENCRYPTION_KEY`: optional but recommended, used to encrypt mailbox passwords and tokens
- `WORKER_SERVICE_URL`: Worker service URL (default: http://localhost:8001)

## Features

### ChatGPT Payment Registration

The worker service provides complete ChatGPT payment registration functionality:

1. Automatic email creation via configured email providers
2. Full registration flow with email verification
3. Payment session creation (Plus & Team plans)
4. Account storage in PostgreSQL
5. Background task processing with status tracking

Access the ChatGPT accounts page in the web console to trigger payment registration.
# account-resource-manager
