# Worker Service

Python worker service for account resource manager.

## Features

- ChatGPT payment registration with MoeMail integration
- Email service integration with encrypted API keys
- Background task processing

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

Required environment variables:
- `DATABASE_URL` or `ARM_DATABASE_URL`: PostgreSQL connection string
- `ARM_DATA_ENCRYPTION_KEY` or `ARM_SESSION_SECRET`: Encryption key (must match web app)
- `WORKER_PORT`: Service port (default: 8001)
- `PROXY_URL`: Optional proxy for registration

3. Configure email provider in web interface:
   - Go to Settings > Email Providers
   - Add MoeMail provider with API URL and API Key
   - Set as default

4. Test configuration:
```bash
python test_config.py
```

5. Run database migrations:
```bash
psql $DATABASE_URL < migrations/001_create_tables.sql
```

6. Start the service:
```bash
python main.py
```

## Testing

Run the configuration test to verify everything is set up correctly:

```bash
cd services/worker
python test_config.py
```

This will test:
- ✅ Database connection
- ✅ Email provider configuration
- ✅ Encryption/decryption
- ✅ MoeMail API connectivity

## API Endpoints

### POST /api/payment-registration
Create a payment registration task

Request body:
```json
{
  "email_provider_id": 1,
  "proxy_url": "http://127.0.0.1:7890",
  "max_retries": 3
}
```

Response:
```json
{
  "task_id": "uuid",
  "status": "pending",
  "message": "支付注册任务已创建"
}
```

### GET /api/tasks/{task_id}
Get task status

Response:
```json
{
  "task_id": "uuid",
  "task_type": "payment_registration",
  "status": "completed",
  "result": "email@example.com",
  "error_message": null,
  "created_at": "2024-01-01T00:00:00",
  "started_at": "2024-01-01T00:00:01",
  "completed_at": "2024-01-01T00:02:00"
}
```

### GET /health
Health check

Response:
```json
{
  "status": "healthy",
  "service": "worker"
}
```
