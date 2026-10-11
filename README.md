# Apna Billing

All-in-one business billing & management platform.

## Quick Start

### 1. Install Dependencies
Run the standard install command from the root directory (automatically installs root, server, and client dependencies):
```bash
npm install
```
*(Or run `npm run install:all`)*

### 2. Start Both Client & Server Concurrently
Run from the root directory:
```bash
npm run dev
```

This starts:
- **Backend API Server**: [http://localhost:5000](http://localhost:5000)
- **Frontend Client**: [http://localhost:3000](http://localhost:3000)

---

## Available Root Scripts

| Command | Description |
|---|---|
| `npm run dev` | Runs backend server and frontend client concurrently |
| `npm run dev:server` | Runs backend server in watch mode only |
| `npm run dev:client` | Runs frontend Vite dev server only |
| `npm run build` | Builds both frontend and backend |
| `npm run seed` | Seeds SQLite database with demo data |
| `npm start` | Starts the production server build |
