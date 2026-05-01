#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

pnpm install --frozen-lockfile
pnpm build
rsync -a --delete dist/ /var/www/firefly/
chown -R deploy:www-data /var/www/firefly
