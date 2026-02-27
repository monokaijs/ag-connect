# AG Connect

AG Connect is a fast, web-based IDE designed for AI-assisted development. It acts as a smart wrapper around AI agent containers, providing a modern, rich interface with real-time bidirectional sync between a local host filesystem and isolated workspace containers.

## Features

- **VS Code-like Experience**: A unified vertical activity bar lets you switch seamlessly between a full file explorer and integrated Git source control.
- **AI Agent Integration**: Communicates directly via Chrome DevTools Protocol (CDP) to scrape state, send messages, and monitor agent progress without manual refreshing.
- **Isolated Workspaces**: Each project spins up in its own Docker container, keeping environments clean.
- **Host Syncing**: Safely bind-mount local directories into the workspace container.
- **Rich Markdown Chat**: Task blocks, thinking steps, diffs, and code snippets are styled correctly and parsed in real-time.
- **Integrated Terminal**: Fully featured internal terminal (via `xterm.js` and `node-pty`) to handle shell sessions without leaving the browser.
- **Monaco File Preview**: Built-in syntax highlighting for viewing files directly in the UI.

## Tech Stack

- **Frontend**: React (Vite), Tailwind CSS v4, `lucide-react`, `react-resizable-panels`, `react-virtuoso` (for chat history performance).
- **Backend**: Express (Node.js), WebSocket (`ws`), Dockerode (Docker Engine API), Mongoose / SQLite.
- **Container Management**: Automated startup of Agent containers with remote debug port exposure.

## Setup & Running

**Prerequisites:**
- Docker installed and running
- Node.js (v18 or higher)
- NPM

### Local Development

1. Install dependencies for the backend:
   ```bash
   npm ci
   ```

2. Install dependencies for the frontend:
   ```bash
   cd web && npm ci
   ```

3. Start the system:
   Run the backend and frontend simultaneously. The backend serves the API and websockets, and Vite serves the frontend.

   Terminal 1 (Backend):
   ```bash
   npm run dev
   ```

   Terminal 2 (Frontend):
   ```bash
   cd web && npm run dev
   ```

### Production Build

1. Build the frontend:
   ```bash
   cd web && npm run build
   ```

2. Start the backend:
   ```bash
   npm start
   ```

The backend server automatically discovers and serves the `web/dist` folder in production.

## Architecture & Concepts

- **Workspace**: A document representing a project. It tracks the Docker container ID, the local mapped path, and the IDE's internal state.
- **CDP Bridge**: `cdp-dom.mjs` injects scripts into the headless Chrome instance running inside the agent's Docker container, scraping the exact DOM state to mirror chat logs back to the frontend.
- **Panel Layout**: `react-resizable-panels` provides drag-to-resize layouts for the Sidebar (Explorer/Git), the Chat feed, and the Bottom Terminal.

## Deployment

A `docker-compose.yml` and `Dockerfile` are provided in the repository for pushing to remote VPS instances. Setup requires an Nginx reverse proxy routing port 80/443 to the Node Express server.
