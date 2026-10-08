$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
    git diff --quiet
    if ($LASTEXITCODE -ne 0) { throw '工作区仍有未提交的已跟踪文件' }
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) { throw '暂存区仍有未提交内容' }

    $release = (git rev-parse --short=12 HEAD).Trim()
    if ($release -notmatch '^[0-9a-f]{12}$') { throw '无法获取发布版本号' }
    $archive = Join-Path $env:TEMP "atc-simulator-$release.tar.gz"
    & tar.exe -czf $archive index.html styles.css js build/icon.ico
    if ($LASTEXITCODE -ne 0) { throw '网页静态资源打包失败' }

    & ssh hp 'mkdir -p /home/ubuntu/atc-simulator-deploy'
    if ($LASTEXITCODE -ne 0) { throw '无法连接 HP 服务器' }
    & scp $archive "hp:/home/ubuntu/atc-simulator-deploy/$release.tar.gz"
    if ($LASTEXITCODE -ne 0) { throw '上传网页资源失败' }
    & scp (Join-Path $PSScriptRoot 'nginx-atc-simulator.conf') 'hp:/home/ubuntu/atc-simulator-deploy/nginx-atc-simulator.conf'
    if ($LASTEXITCODE -ne 0) { throw '上传 Nginx 子路径配置失败' }
    & scp (Join-Path $PSScriptRoot 'enable-nginx.py') 'hp:/home/ubuntu/atc-simulator-deploy/enable-nginx.py'
    if ($LASTEXITCODE -ne 0) { throw '上传 Nginx 安装脚本失败' }
    & scp (Join-Path $PSScriptRoot 'activate-release.sh') 'hp:/home/ubuntu/atc-simulator-deploy/activate-release.sh'
    if ($LASTEXITCODE -ne 0) { throw '上传发布脚本失败' }

    & ssh hp "bash /home/ubuntu/atc-simulator-deploy/activate-release.sh $release"
    if ($LASTEXITCODE -ne 0) { throw '服务器发布失败，请检查远端输出；旧版本链接未主动删除' }

    Write-Output "已发布 $release 到 https://www.airtraffic.site/atc-simulator/"
} finally {
    Pop-Location
}
