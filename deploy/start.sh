#!/bin/sh
set -e

nginx

exec node src/server.mjs
