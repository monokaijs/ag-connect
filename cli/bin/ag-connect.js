#!/usr/bin/env node

'use strict';

const { AgConnectClient } = require('../src/client');

const args = process.argv.slice(2);

function getArg(flag, short) {
  const idx = args.findIndex(a => a === flag || a === short);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

const hasFlag = (flag, short) => args.includes(flag) || args.includes(short);

if (hasFlag('--help', '-h')) {
  console.log(`
  ag-connect — Run Antigravity IDE locally and connect to your AG Connect server

  Usage:
    npx ag-connect --server <url> --token <jwt> [--folder <path>] [--name <name>]

  Options:
    -s, --server <url>    AG Connect server URL (e.g. https://ag.example.com)
    -t, --token <jwt>     Authentication token from the AG Connect web UI
    -f, --folder <path>   Workspace folder path (default: current directory)
    -n, --name <name>     Workspace display name
    -h, --help            Show this help

  Environment variables:
    AG_SERVER             Server URL (alternative to --server)
    AG_TOKEN              Auth token (alternative to --token)

  Example:
    npx ag-connect -s https://ag.example.com -t eyJhbGci... -f ./my-project
`);
  process.exit(0);
}

const serverUrl = getArg('--server', '-s') || process.env.AG_SERVER;
const token = getArg('--token', '-t') || process.env.AG_TOKEN;
const folder = getArg('--folder', '-f') || process.cwd();
const name = getArg('--name', '-n') || folder.split('/').pop() || 'CLI Workspace';

if (!serverUrl) {
  console.error('Error: --server <url> or AG_SERVER env var is required');
  process.exit(1);
}

if (!token) {
  console.error('Error: --token <jwt> or AG_TOKEN env var is required');
  process.exit(1);
}

console.log('');
console.log('='.repeat(50));
console.log(' AG Connect CLI');
console.log('='.repeat(50));
console.log(' Server:    ' + serverUrl);
console.log(' Folder:    ' + folder);
console.log(' Name:      ' + name);
console.log('-'.repeat(50));
console.log('');

const client = new AgConnectClient({
  serverUrl,
  token,
  folder,
  name,
});

const shutdown = async () => {
  console.log('\nShutting down...');
  await client.disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.connect().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
