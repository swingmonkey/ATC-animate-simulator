"""在 HP 上幂等接入静态子路径；失败时恢复配置，不切断现有站点。"""

from datetime import datetime, timezone
from pathlib import Path
import shutil
import subprocess


CONFIG = Path('/etc/nginx/sites-available/airtraffic')
SNIPPET_SOURCE = Path('/home/ubuntu/atc-simulator-deploy/nginx-atc-simulator.conf')
SNIPPET_TARGET = Path('/etc/nginx/snippets/atc-simulator.conf')
MARKER = '    include /etc/nginx/snippets/aahot.conf;'
ADDITION = '    include /etc/nginx/snippets/atc-simulator.conf;'


def main():
    original = CONFIG.read_text()
    if original.count(MARKER) != 2:
        raise RuntimeError('站点配置已变化：预期 HTTP/HTTPS 各有一个 AviationHot include')
    if ADDITION in original and original.count(ADDITION) != 2:
        raise RuntimeError('站点配置只部分安装了 ATC include，请人工检查')

    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    backup = CONFIG.with_name(f'{CONFIG.name}.atc-backup-{stamp}')
    shutil.copy2(CONFIG, backup)
    old_snippet = SNIPPET_TARGET.read_bytes() if SNIPPET_TARGET.exists() else None
    shutil.copy2(SNIPPET_SOURCE, SNIPPET_TARGET)

    try:
        if ADDITION not in original:
            CONFIG.write_text(original.replace(MARKER, MARKER + '\n' + ADDITION))
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    except Exception:
        shutil.copy2(backup, CONFIG)
        if old_snippet is None:
            SNIPPET_TARGET.unlink(missing_ok=True)
        else:
            SNIPPET_TARGET.write_bytes(old_snippet)
        subprocess.run(['nginx', '-t'], check=True)
        raise

    print(f'ATC 子路径已启用；配置备份：{backup}')


if __name__ == '__main__':
    main()
