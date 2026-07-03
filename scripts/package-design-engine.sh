#!/usr/bin/env bash
set -euo pipefail

# 打包并发布 OpenPencil 设计引擎为 downloadable_local 分发包（模块 14 / 实施 27，OPENG-1）。
#
# 设计目标：**一个脚本、不带参数即默认构建并发布当前机器能产出的包**，所有上传参数放配置文件
# config.yaml（默认=生产）/ config-dev.yaml（本地）。日常发布只需（脚本已随引擎收编进
# huanxing-apps/openpencil/scripts/，紧邻引擎源码）：
#   scripts/package-design-engine.sh            # 默认读同目录 config.yaml（生产）
#   scripts/package-design-engine.sh --dev      # 读同目录 config-dev.yaml（本地/测试环境）
#
# 产出 daemon `domains/design/{engine,install}.rs` + `locator.rs` 期望的契约：
#   - 包格式 = **zip**，顶层含 `out/`（OpenPencil 构建产物：`out/web/`(Nitro node-server) +
#     `out/mcp-server.cjs`(pen-mcp)），解压后落到 `<install_root>/current/out/...`；结构闸门：包内必须有
#     `out/web/server/index.mjs` + `out/mcp-server.cjs`（install.rs 同口径硬校验）。
#   - manifest.json：`{"version","packages":{"<os-arch>":{"key","url","sha256","size"}}}`。
#
# 关于 os-arch 与**内置 bun 运行时**（福仔 2026-06-27「终端用户机器没有 node/bun，必须打进 sidecar」）：
# OpenPencil 的 JS 产物（Nitro `node-server` bundle + canvaskit-wasm）本身平台无关，但终端用户不是
# 开发者、机器上**没有 node/bun**，故包内**自带 bun 二进制**（`runtime/bun`，按目标架构从 bun 官方
# release 下载）——装出来 daemon 直接用它起 sidecar，零宿主依赖。因 bun 是**原生二进制**，包从此
# **平台特定**：每个目标架构（darwin-aarch64 / darwin-x86_64 / win-x86_64 / linux-x86_64）各打/各发
# 一份，daemon `download_and_install` **精确按 host os-arch 选包**（选不到即如实报错，绝不回落异架构）。
# bun 单二进制能同时跑 web Nitro node-server 产物（ESM）与 pen-mcp（CJS），故内置一个 bun 覆盖双进程。
# 用 `--no-bundle-runtime` 可退回「不打 bun、运行依赖宿主 node」的旧行为（仅 dev/CI 自带 node 时用）。
#
# 用法:
#   scripts/package-design-engine.sh [选项]
#
# 配置（优先级 命令行 > 环境变量 > 配置文件 > 内置默认）:
#   --dev              读同目录 config-dev.yaml（本地/测试环境）而非默认的 config.yaml（生产）。
#                      等价于 --env=dev；不给则默认 config.yaml。
#   --env=<name>       指定环境：dev → config-dev.yaml；prod/空 → config.yaml。
#   --config=<file>    显式指定配置文件路径（覆盖 --dev/--env 的默认选择）。亦可用环境变量
#                      DESIGN_ENGINE_CONFIG 指定。**YAML 扁平 key: value、# 注释，安全逐行解析（不 source、
#                      不引 YAML 库）**。真实上传参数放 config.yaml/config-dev.yaml（均已 .gitignore），
#                      模板见 config.example.yaml。
#   --version=<v>      包版本（配置键 version；留空则读 openpencil package.json 的 version）。
#   --src=<dir>        OpenPencil 收编根（配置键 src；默认引擎仓根 huanxing-apps/openpencil）。
#   --os-arch=<v>      覆盖 os-arch 标识（配置键 os_arch；留空则按 host 自动探测）。
#   --out=<dir>        产物输出目录（配置键 out；默认 <引擎仓根>/.engine-build/design-engine）。
#   --publish=<url>    云端 API 基址（配置键 DESIGN_ENGINE_PUBLISH_URL）。给了即开启发布：打包后自动
#                      POST 引擎包到 <url>/api/v1/hasn/app-catalogs/<pk>/engine-package（落公共桶 +
#                      写 config_json.engine + push platform_config，在线 daemon 秒级重拉、自动装引擎）。
#                      服务端**权威**算 sha256/size、与本地交叉校验。需 app-pk + 管理端 token。
#   --app-pk=<id>      发布必填：云端应用目录行 ID（配置键 app_pk；design 那行主键）。
#   --admin-token=<t>  发布必填：管理端 JWT（配置键 admin_token；放配置文件或环境变量 HASN_ADMIN_TOKEN）。
#   --base-url=<u>     仅手工上传场景：manifest.url=<base>/<包名>（配置键 base_url）。
#                      给 --publish 时无需本项（URL 由云端公共桶分配）。
#   --skip-build       **仅验证打包流水线**：跳过 bun 构建，直接用 src 既有 `out/` 打包（产物须已存在）。
#   --bun-version=<v>  内置 bun 运行时版本（配置键 bun_version；默认内置常量 BUN_VERSION_DEFAULT）。
#   --no-bundle-runtime  不把 bun 打进包（退回依赖宿主 node 的旧行为；仅 dev/CI 自带 node 时用）。
#   --help

# ---- 参数解析 -------------------------------------------------------------
VERSION="${DESIGN_ENGINE_VERSION:-}"
SRC="${DESIGN_OPENPENCIL_SRC:-}"
OS_ARCH_OVERRIDE="${DESIGN_ENGINE_OS_ARCH:-}"
OUT_DIR="${DESIGN_ENGINE_OUT:-}"
BASE_URL="${DESIGN_ENGINE_BASE_URL:-}"
PUBLISH_URL="${DESIGN_ENGINE_PUBLISH_URL:-}"
APP_PK="${DESIGN_ENGINE_APP_PK:-}"
ADMIN_TOKEN="${HASN_ADMIN_TOKEN:-}"
SKIP_BUILD=0
# 内置 bun 运行时：默认打进包（终端用户无 node/bun）。pin 一个实测可跑 web+pen-mcp 双进程的版本。
BUN_VERSION_DEFAULT="1.3.8"
BUN_VERSION="${DESIGN_ENGINE_BUN_VERSION:-}"
BUNDLE_RUNTIME=1
ENV_NAME=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${DESIGN_ENGINE_CONFIG:-}"

# usage 打印脚本头注释（行 4 至「参数解析」分隔线），对 header 增长鲁棒（不硬编码行号）。
usage() { sed -n '4,/^# ----/p' "${BASH_SOURCE[0]}" | sed '/^# ----/d; s/^# \{0,1\}//'; }

# 安全解析 YAML 扁平配置文件（key: value，# 注释）——**逐行解析、不 source、不引 YAML 库**（防任意代码执行）。
# 仅取顶层 `key: value`（value 按首个冒号切分，故 URL 里的 :// 不受影响）；缩进/嵌套/列表不支持（本配置全扁平）。
# 仅填充「当前仍为空」的变量，故优先级 = 命令行 > 环境变量 > 配置文件 > 内置默认。
load_config_file() {
  local file="$1" line key value
  [[ -f "${file}" ]] || return 0
  echo "[design-pkg] 读配置文件: ${file}"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"                       # 去尾部 CR（CRLF 文件兼容）
    line="${line#"${line%%[![:space:]]*}"}"    # 去前导空白
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    [[ "${line}" != *:* ]] && continue          # 非 key: value 行跳过
    key="${line%%:*}"; value="${line#*:}"       # 首个冒号切分（value 里的 :// 保留）
    key="${key//[[:space:]]/}"
    value="${value#"${value%%[![:space:]]*}"}"; value="${value%"${value##*[![:space:]]}"}"  # 去 value 首尾空白
    value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"      # 去成对引号
    case "${key}" in
      version) [[ -z "${VERSION}" ]] && VERSION="${value}" ;;
      src) [[ -z "${SRC}" ]] && SRC="${value}" ;;
      os_arch) [[ -z "${OS_ARCH_OVERRIDE}" ]] && OS_ARCH_OVERRIDE="${value}" ;;
      out) [[ -z "${OUT_DIR}" ]] && OUT_DIR="${value}" ;;
      publish_url) [[ -z "${PUBLISH_URL}" ]] && PUBLISH_URL="${value}" ;;
      app_pk) [[ -z "${APP_PK}" ]] && APP_PK="${value}" ;;
      admin_token) [[ -z "${ADMIN_TOKEN}" ]] && ADMIN_TOKEN="${value}" ;;
      base_url) [[ -z "${BASE_URL}" ]] && BASE_URL="${value}" ;;
      bun_version) [[ -z "${BUN_VERSION}" ]] && BUN_VERSION="${value}" ;;
      *) echo "[design-pkg] ⚠ 配置文件未知键，忽略: ${key}" >&2 ;;
    esac
  done < "${file}"
  return 0
}

# 先扫一遍找 --config / --dev / --env（让命令行能指定配置文件/环境），再加载配置（不覆盖已设环境变量）。
for arg in "$@"; do
  case "${arg}" in
    --config=*) CONFIG_FILE="${arg#--config=}" ;;
    --dev) ENV_NAME="dev" ;;
    --env=*) ENV_NAME="${arg#--env=}" ;;
  esac
done
# 默认 config.yaml（生产）；--dev / --env=dev → config-dev.yaml（本地）；--config 显式路径优先级最高。
if [[ -z "${CONFIG_FILE}" ]]; then
  case "${ENV_NAME}" in
    dev | test | local) CONFIG_FILE="${SCRIPT_DIR}/config-dev.yaml" ;;
    *) CONFIG_FILE="${SCRIPT_DIR}/config.yaml" ;;
  esac
fi
load_config_file "${CONFIG_FILE}"

for arg in "$@"; do
  case "${arg}" in
    --config=* | --dev | --env=*) ;; # 已在上面处理
    --version=*) VERSION="${arg#--version=}" ;;
    --src=*) SRC="${arg#--src=}" ;;
    --os-arch=*) OS_ARCH_OVERRIDE="${arg#--os-arch=}" ;;
    --out=*) OUT_DIR="${arg#--out=}" ;;
    --base-url=*) BASE_URL="${arg#--base-url=}" ;;
    --publish=*) PUBLISH_URL="${arg#--publish=}" ;;
    --app-pk=*) APP_PK="${arg#--app-pk=}" ;;
    --admin-token=*) ADMIN_TOKEN="${arg#--admin-token=}" ;;
    --skip-build) SKIP_BUILD=1 ;;
    --bun-version=*) BUN_VERSION="${arg#--bun-version=}" ;;
    --no-bundle-runtime) BUNDLE_RUNTIME=0 ;;
    --help | -h) usage; exit 0 ;;
    *)
      echo "未知参数: ${arg}" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# ---- os-arch 探测（对齐包发布命名 darwin-aarch64 / linux-x86_64 / win-x86_64 …）-----------
detect_os_arch() {
  local os arch
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    MINGW* | MSYS* | CYGWIN*) os=win ;;
    *) echo "不支持的构建主机 OS: $(uname -s)" >&2; exit 1 ;;
  esac
  local machine
  machine="$(uname -m)"
  # Rosetta 陷阱：Apple Silicon 上若本脚本由 x86_64 版 bash（如 /usr/local/bin/bash homebrew Intel 版）
  # 经 Rosetta 运行，uname -m 会谎报 x86_64。真实硬件仍是 arm64（Rosetta 只在 arm64 主机上翻译 x86_64），
  # 据 sysctl.proc_translated=1 纠正回 arm64，避免把 arm64 包错标成 darwin-x86_64 发上云。
  if [[ "${os}" == "darwin" && "${machine}" == "x86_64" \
        && "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" == "1" ]]; then
    machine="arm64"
  fi
  case "${machine}" in
    arm64 | aarch64) arch=aarch64 ;;
    x86_64 | amd64) arch=x86_64 ;;
    *) echo "不支持的构建主机架构: ${machine}" >&2; exit 1 ;;
  esac
  echo "${os}-${arch}"
}
OS_ARCH="${OS_ARCH_OVERRIDE:-$(detect_os_arch)}"
BUN_VERSION="${BUN_VERSION:-${BUN_VERSION_DEFAULT}}"

# os-arch → bun 官方 release 资产名（github.com/oven-sh/bun/releases）。决定下载哪份原生 bun 打进包。
bun_asset_for_os_arch() {
  case "$1" in
    darwin-aarch64) echo "bun-darwin-aarch64" ;;
    darwin-x86_64)  echo "bun-darwin-x64" ;;
    linux-aarch64)  echo "bun-linux-aarch64" ;;
    linux-x86_64)   echo "bun-linux-x64" ;;
    win-x86_64)     echo "bun-windows-x64" ;;
    *) echo "" ;;
  esac
}
# 包内置 bun 的相对路径（win 为 bun.exe），与 daemon locator::RUNTIME_BIN_REL 同口径。
case "${OS_ARCH}" in
  win-*) RUNTIME_BIN_REL="runtime/bun.exe" ;;
  *)     RUNTIME_BIN_REL="runtime/bun" ;;
esac

# ---- 路径与版本前置校验（fail-fast）----------------------------------------
ENGINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# 本脚本随引擎收编进 huanxing-apps/openpencil/scripts/，故 ENGINE_ROOT=引擎仓根（scripts/ 的上一层，即 openpencil 根）。
SRC="${SRC:-${ENGINE_ROOT}}"
OUT_DIR="${OUT_DIR:-${ENGINE_ROOT}/.engine-build/design-engine}"

if [[ ! -f "${SRC}/package.json" ]]; then
  echo "[design-pkg] 找不到 OpenPencil 收编根（缺 ${SRC}/package.json）；用 --src 指定" >&2
  exit 1
fi

# 版本：未显式给则从 package.json 读 version。
if [[ -z "${VERSION}" ]]; then
  VERSION="$(python3 - "${SRC}/package.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    print((json.load(fh).get("version") or "").strip())
PY
)"
fi
if [[ -z "${VERSION}" ]]; then
  echo "[design-pkg] 无法确定版本（package.json 无 version，且未给 --version / DESIGN_ENGINE_VERSION）" >&2
  exit 1
fi

# 构建依赖：bun（除非 --skip-build）。
if [[ "${SKIP_BUILD}" != "1" ]]; then
  command -v bun >/dev/null 2>&1 || { echo "[design-pkg] 需要 bun 构建 OpenPencil（或加 --skip-build 用既有 out/）" >&2; exit 1; }
fi
command -v zip >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 || { echo "[design-pkg] 需要 zip 或 python3 打包" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "[design-pkg] 需要 python3 写 manifest" >&2; exit 1; }

# 内置 bun 运行时依赖：下载（curl）+ 解包（unzip）+ 当前 os-arch 有对应 bun 资产。
if [[ "${BUNDLE_RUNTIME}" == "1" ]]; then
  BUN_ASSET="$(bun_asset_for_os_arch "${OS_ARCH}")"
  [[ -n "${BUN_ASSET}" ]] || { echo "[design-pkg] 无对应 os-arch 的 bun 资产: ${OS_ARCH}（或加 --no-bundle-runtime 退回宿主 node）" >&2; exit 1; }
  command -v curl >/dev/null 2>&1 || { echo "[design-pkg] 内置 bun 需要 curl 下载（或 --no-bundle-runtime）" >&2; exit 1; }
  command -v unzip >/dev/null 2>&1 || { echo "[design-pkg] 内置 bun 需要 unzip 解包（或 --no-bundle-runtime）" >&2; exit 1; }
fi

# 发布前置：fail-fast，缺要素立即报错（别等打完才发现没法上传）。
if [[ -n "${PUBLISH_URL}" ]]; then
  [[ -n "${APP_PK}" ]] || { echo "[design-pkg] 发布需要 --app-pk / DESIGN_ENGINE_APP_PK（云端应用目录行ID，design 那行主键）" >&2; exit 1; }
  [[ -n "${ADMIN_TOKEN}" ]] || { echo "[design-pkg] 发布需要 --admin-token / HASN_ADMIN_TOKEN（管理端 JWT）" >&2; exit 1; }
  command -v curl >/dev/null 2>&1 || { echo "[design-pkg] 发布需要 curl 上传引擎包" >&2; exit 1; }
fi

echo "[design-pkg] os-arch=${OS_ARCH} 版本=${VERSION} 源=${SRC}"
[[ "${SKIP_BUILD}" == "1" ]] && echo "[design-pkg] ⚠ --skip-build：跳过 bun 构建，直接打包 src 既有 out/"
[[ -n "${PUBLISH_URL}" ]] && echo "[design-pkg] 发布开启 → ${PUBLISH_URL}（app-pk=${APP_PK}）" || echo "[design-pkg] 未配 --publish/DESIGN_ENGINE_PUBLISH_URL：只打包不发布"

# ---- 构建 OpenPencil（Nitro node-server + pen-mcp）-------------------------
if [[ "${SKIP_BUILD}" != "1" ]]; then
  echo "[design-pkg] 构建 web Nitro node-server（BUILD_TARGET=node-server bun --bun run build）"
  ( cd "${SRC}" && BUILD_TARGET=node-server bun --bun run build )
  echo "[design-pkg] 编译 pen-mcp（bun run mcp:compile → out/mcp-server.cjs）"
  ( cd "${SRC}" && bun run mcp:compile )
fi

# 构建产物结构闸门（与 install.rs / locator.rs 同口径，提前在打包侧失败而非等下载后才发现坏包）。
[[ -f "${SRC}/out/web/server/index.mjs" ]] || { echo "[design-pkg] 构建异常：缺 out/web/server/index.mjs" >&2; exit 1; }
[[ -f "${SRC}/out/mcp-server.cjs" ]] || { echo "[design-pkg] 构建异常：缺 out/mcp-server.cjs" >&2; exit 1; }

# ---- staging：拷 out/web + out/mcp-server.cjs（保留 out/ 前缀）-------------
STAGE="${OUT_DIR}/stage-${OS_ARCH}"
rm -rf "${STAGE}"
mkdir -p "${STAGE}/out/web"
COPY_EXCLUDES=(
  --exclude='*.map'            # sourcemap 不随包发（体积大、运行不需）
  --exclude='__pycache__' --exclude='.DS_Store'
)
if command -v rsync >/dev/null 2>&1; then
  rsync -a "${COPY_EXCLUDES[@]}" "${SRC}/out/web/" "${STAGE}/out/web/"
else
  cp -R "${SRC}/out/web/." "${STAGE}/out/web/"
  find "${STAGE}/out/web" \( -name '*.map' -o -name '.DS_Store' \) -delete 2>/dev/null || true
fi
cp "${SRC}/out/mcp-server.cjs" "${STAGE}/out/mcp-server.cjs"

# ---- 内置 bun 运行时：按目标架构下载 bun 二进制放 runtime/bun（终端用户无 node/bun）----------
ZIP_RUNTIME_DIR=""   # 非空则打进 zip（与 out 并列）
if [[ "${BUNDLE_RUNTIME}" == "1" ]]; then
  BUN_CACHE="${OUT_DIR}/.bun-cache"
  mkdir -p "${BUN_CACHE}"
  BUN_ZIP="${BUN_CACHE}/${BUN_ASSET}-v${BUN_VERSION}.zip"
  BUN_URL="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${BUN_ASSET}.zip"
  if [[ ! -f "${BUN_ZIP}" ]]; then
    echo "[design-pkg] 下载内置 bun 运行时 ${BUN_ASSET} v${BUN_VERSION} → ${BUN_ZIP}"
    curl -fsSL -o "${BUN_ZIP}.tmp" "${BUN_URL}" || { echo "[design-pkg] ✗ 下载 bun 失败：${BUN_URL}" >&2; rm -f "${BUN_ZIP}.tmp"; exit 1; }
    mv "${BUN_ZIP}.tmp" "${BUN_ZIP}"
  else
    echo "[design-pkg] 复用缓存的 bun：${BUN_ZIP}"
  fi
  # bun release zip 内为 <asset>/bun（win 为 <asset>/bun.exe）。解出该单文件到 staging runtime/。
  mkdir -p "${STAGE}/runtime"
  BUN_BIN_NAME="bun"; [[ "${OS_ARCH}" == win-* ]] && BUN_BIN_NAME="bun.exe"
  unzip -p "${BUN_ZIP}" "${BUN_ASSET}/${BUN_BIN_NAME}" > "${STAGE}/${RUNTIME_BIN_REL}" \
    || { echo "[design-pkg] ✗ 从 bun zip 解出 ${BUN_ASSET}/${BUN_BIN_NAME} 失败" >&2; exit 1; }
  chmod 0755 "${STAGE}/${RUNTIME_BIN_REL}"
  [[ -s "${STAGE}/${RUNTIME_BIN_REL}" ]] || { echo "[design-pkg] ✗ 内置 bun 落地为空：${STAGE}/${RUNTIME_BIN_REL}" >&2; exit 1; }
  ZIP_RUNTIME_DIR="runtime"
  echo "[design-pkg] 内置 bun 就绪：${RUNTIME_BIN_REL}（$(wc -c < "${STAGE}/${RUNTIME_BIN_REL}" | tr -d ' ') 字节，0755）"
else
  echo "[design-pkg] ⚠ --no-bundle-runtime：不打 bun，运行将依赖宿主 node（终端用户须自备）"
fi

# staging 结构闸门：与 install.rs 同一硬校验。
[[ -f "${STAGE}/out/web/server/index.mjs" ]] || { echo "[design-pkg] staging 异常：缺 out/web/server/index.mjs" >&2; exit 1; }
[[ -f "${STAGE}/out/mcp-server.cjs" ]] || { echo "[design-pkg] staging 异常：缺 out/mcp-server.cjs" >&2; exit 1; }
[[ "${BUNDLE_RUNTIME}" != "1" || -x "${STAGE}/${RUNTIME_BIN_REL}" ]] || { echo "[design-pkg] staging 异常：缺可执行 ${RUNTIME_BIN_REL}" >&2; exit 1; }
# symlink 守卫：daemon unpack_zip 不还原 symlink，包内任何 symlink 都会损坏。
if find "${STAGE}" -type l | grep -q .; then
  echo "[design-pkg] ✗ 包内仍存在 symlink（daemon 解压不还原 symlink → 包会损坏）：" >&2
  find "${STAGE}" -type l >&2
  exit 1
fi

# ---- 打包 zip（顶层 out/）+ sha256 + size ----------------------------------
mkdir -p "${OUT_DIR}"
PKG_NAME="design-${OS_ARCH}-${VERSION}.zip"
PKG_PATH="${OUT_DIR}/${PKG_NAME}"
rm -f "${PKG_PATH}"
echo "[design-pkg] 打包 → ${PKG_PATH}（含 out${ZIP_RUNTIME_DIR:+ + ${ZIP_RUNTIME_DIR}}）"
# 顶层含 out/（+ runtime/bun，若内置）；zip 保留 unix 可执行位（daemon unpack_zip 据此还原 +x）。
if command -v zip >/dev/null 2>&1; then
  ( cd "${STAGE}" && zip -r -q -X "${PKG_PATH}" out ${ZIP_RUNTIME_DIR} )
else
  # 无 zip（如 Windows Git Bash）：用 python zipfile 打包顶层 out/(+ runtime/)。win 包 runtime 为 bun.exe，
  # Windows 侧无需 unix 可执行位；deflate 压缩，保持相对路径顶层前缀。
  ( cd "${STAGE}" && PKG_OUT="${PKG_PATH}" ZIP_DIRS="out ${ZIP_RUNTIME_DIR}" python3 - <<'PY'
import os, zipfile
out = os.environ["PKG_OUT"]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for d in os.environ["ZIP_DIRS"].split():
        if not d or not os.path.isdir(d):
            continue
        for root, _dirs, files in os.walk(d):
            for name in files:
                full = os.path.join(root, name)
                z.write(full, full.replace(os.sep, "/"))
PY
  )
fi

if command -v sha256sum >/dev/null 2>&1; then
  SHA256="$(sha256sum "${PKG_PATH}" | awk '{print $1}')"
else
  SHA256="$(shasum -a 256 "${PKG_PATH}" | awk '{print $1}')"
fi
SIZE="$(wc -c < "${PKG_PATH}" | tr -d ' ')"

# ---- manifest.json：本架构条目 ---------------------------------------------
MANIFEST="${OUT_DIR}/manifest.json"
PKG_URL="${BASE_URL:+${BASE_URL%/}/${PKG_NAME}}"
PKG_URL="${PKG_URL:-REPLACE_WITH_OBJECT_STORAGE_URL/${PKG_NAME}}"
PKG_KEY="design/${VERSION}/${PKG_NAME}"
MANIFEST="${MANIFEST}" OS_ARCH="${OS_ARCH}" VERSION="${VERSION}" \
PKG_KEY="${PKG_KEY}" PKG_URL="${PKG_URL}" SHA256="${SHA256}" SIZE="${SIZE}" \
python3 - <<'PY'
import json, os, sys

path = os.environ["MANIFEST"]
os_arch = os.environ["OS_ARCH"]
version = os.environ["VERSION"]
entry = {
    "key": os.environ["PKG_KEY"],
    "url": os.environ["PKG_URL"],
    "sha256": os.environ["SHA256"],
    "size": int(os.environ["SIZE"]),
}
data = {"version": version, "packages": {}}
if os.path.exists(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if data.get("version") and data["version"] != version:
        sys.exit(f"manifest 版本冲突：已有 {data['version']}，本次 {version}（多架构须同版本）")
    data["version"] = version
    data.setdefault("packages", {})
data["packages"][os_arch] = entry
with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
print(f"[design-pkg] manifest 写入 {path}（packages: {', '.join(sorted(data['packages']))}）")
PY

echo "[design-pkg] 完成 ${OS_ARCH}: ${PKG_PATH}（sha256=${SHA256:0:12}… size=${SIZE}）"
if [[ "${PKG_URL}" == REPLACE_WITH_OBJECT_STORAGE_URL/* && -z "${PUBLISH_URL}" ]]; then
  echo "            ⚠ url 为占位：用 --base-url 重跑 manifest，或配 --publish 一键发布。"
fi

# ---- 一键发布：POST 引擎包到云端 admin 端点 --------------------------------
if [[ -n "${PUBLISH_URL}" ]]; then
  ENDPOINT="${PUBLISH_URL%/}/api/v1/hasn/app-catalogs/${APP_PK}/engine-package"
  echo "[design-pkg] 发布 → ${ENDPOINT}（os_arch=${OS_ARCH} version=${VERSION}）"
  # 服务端权威算 sha256（交叉校验）+ size，落公共桶，写 config_json.engine，push platform_config。
  # token 经 Authorization 头（不进 URL/日志）；-sS 静默但报错，-w 附 HTTP 码。
  HTTP_BODY_FILE="${OUT_DIR}/.publish-resp-${OS_ARCH}.json"
  HTTP_CODE="$(curl -sS -o "${HTTP_BODY_FILE}" -w '%{http_code}' \
    -X POST "${ENDPOINT}" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -F "file=@${PKG_PATH};type=application/zip" \
    -F "os_arch=${OS_ARCH}" \
    -F "version=${VERSION}" \
    -F "sha256=${SHA256}" || echo "000")"
  if [[ "${HTTP_CODE}" != "200" ]]; then
    echo "[design-pkg] ✗ 发布失败（HTTP ${HTTP_CODE}）：" >&2
    cat "${HTTP_BODY_FILE}" >&2 2>/dev/null || true
    echo >&2
    rm -f "${HTTP_BODY_FILE}"
    exit 1
  fi
  # 解析统一信封 {code,msg,data}：code 非 0 即业务失败；data 为写入后的 engine 配置。
  RESP_FILE="${HTTP_BODY_FILE}" OS_ARCH="${OS_ARCH}" python3 - <<'PY' || exit 1
import json, os, sys

with open(os.environ["RESP_FILE"], encoding="utf-8") as fh:
    env = json.load(fh)
code = env.get("code")
if code not in (0, 200):
    print(f"[design-pkg] ✗ 云端业务失败 code={code} msg={env.get('msg')}", file=sys.stderr)
    sys.exit(1)
engine = env.get("data") or {}
pkgs = engine.get("packages") or {}
print(f"[design-pkg] ✓ 已发布 {os.environ['OS_ARCH']}。云端 engine.version={engine.get('version')} "
      f"packages={', '.join(sorted(pkgs))}")
PY
  rm -f "${HTTP_BODY_FILE}"
fi

echo
echo "[design-pkg] ✅ 完成：os-arch ${OS_ARCH} 版本 ${VERSION}。manifest: ${OUT_DIR}/manifest.json"
if [[ -n "${PUBLISH_URL}" ]]; then
  echo "[design-pkg] 已发布到云端并 push platform_config —— 在线 daemon 将秒级重拉并自动安装引擎。"
fi
if [[ "${BUNDLE_RUNTIME}" == "1" ]]; then
  echo "[design-pkg] ✅ 包内已内置 bun 运行时（${RUNTIME_BIN_REL}，v${BUN_VERSION}）——终端用户无需自备 node/bun，daemon 直接用它起 sidecar。"
  echo "[design-pkg] ⚠ 包已平台特定（含原生 bun）：每个目标架构各发一份；daemon 按 host os-arch 精确选包。"
else
  echo "[design-pkg] ⚠ --no-bundle-runtime：运行依赖宿主 node（daemon HUANXING_NODE_BIN 或 PATH node）。"
fi
