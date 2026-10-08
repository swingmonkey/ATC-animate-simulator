#!/usr/bin/env bash
set -euo pipefail

release="${1:-}"
if [[ ! "$release" =~ ^[0-9a-f]{12}$ ]]; then
    echo 'Invalid release id' >&2
    exit 2
fi

root=/var/www/atc-simulator
source_archive="/home/ubuntu/atc-simulator-deploy/$release.tar.gz"
release_dir="$root/releases/$release"
old_release=''
if [[ -L "$root/current" ]]; then
    old_release="$(readlink -f "$root/current")"
fi

sudo install -d -o ubuntu -g www-data -m 755 "$root" "$root/releases"
install -d "$release_dir"
tar -xzf "$source_archive" -C "$release_dir"
ln -sfn "$release_dir" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"

if ! sudo python3 /home/ubuntu/atc-simulator-deploy/enable-nginx.py; then
    if [[ -n "$old_release" ]]; then
        ln -sfn "$old_release" "$root/current.next"
        mv -Tf "$root/current.next" "$root/current"
    else
        rm -f "$root/current"
    fi
    echo 'Nginx 配置失败，已恢复上一版本' >&2
    exit 1
fi

if [[ -n "$old_release" ]]; then
    ln -sfn "$old_release" "$root/previous.next"
    mv -Tf "$root/previous.next" "$root/previous"
fi
echo "ATC 发布成功：$release"
