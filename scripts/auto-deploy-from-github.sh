#!/usr/bin/env bash
set -Eeuo pipefail

cd /root/Firefly

git fetch origin master

LOCAL_COMMIT="$(git rev-parse HEAD)"
REMOTE_COMMIT="$(git rev-parse origin/master)"

if [ "${LOCAL_COMMIT}" = "${REMOTE_COMMIT}" ]; then
	exit 0
fi

git reset --hard origin/master
pnpm install --frozen-lockfile
pnpm build
rsync -a --delete dist/ /var/www/firefly/
chown -R www-data:www-data /var/www/firefly
