#!/usr/bin/env bash

# Universal Local SDK Generator
# Part of @united-workspace/openapi-sdk-builder

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

show_help() {
    echo "Usage: ./bin/generate.sh [options]"
    echo ""
    echo "Options:"
    echo "  --spec-url=<url>          URL to fetch specification from"
    echo "  --spec-file=<path>        Local path to specification file (default: .generator/swagger.json)"
    echo "  --enrichments=<path>      Path to enrichments JSON (default: .generator/enrichments.json)"
    echo "  --config=<path>           Path to generator config JSON (default: .generator/openapi-config.json)"
    echo "  --lang=<language>         Target language generator (default: php)"
    echo "  --version=<version>       OpenAPI Generator Docker tag (default: latest)"
    echo "  --skip-validate           Skip specification validation"
    echo "  --target-dir=<path>       Target repository directory (default: current working directory)"
    echo ""
    exit 0
}

SPEC_URL=""
SPEC_FILE=".generator/swagger.json"
ENRICHMENTS_FILE=".generator/enrichments.json"
CONFIG_FILE=".generator/openapi-config.json"
TARGET_LANG="php"
GEN_VERSION="latest"
SKIP_VALIDATE="false"
TARGET_DIR="$PWD"

for arg in "$@"; do
    case $arg in
        --help|-h) show_help ;;
        --spec-url=*) SPEC_URL="${arg#*=}" ;;
        --spec-file=*) SPEC_FILE="${arg#*=}" ;;
        --enrichments=*) ENRICHMENTS_FILE="${arg#*=}" ;;
        --config=*) CONFIG_FILE="${arg#*=}" ;;
        --lang=*) TARGET_LANG="${arg#*=}" ;;
        --version=*) GEN_VERSION="${arg#*=}" ;;
        --skip-validate) SKIP_VALIDATE="true" ;;
        --target-dir=*) TARGET_DIR="${arg#*=}" ;;
    esac
done

cd "$TARGET_DIR"

if [ -f "$CONFIG_FILE" ] && command -v jq &> /dev/null; then
    SPEC_URL="${SPEC_URL:-$(jq -r '.swaggerUrl // .apiPayload.swaggerUrl // empty' "$CONFIG_FILE")}"
    TARGET_LANG="${TARGET_LANG:-$(jq -r '.generatorName // empty' "$CONFIG_FILE")}"
    GEN_VERSION="${GEN_VERSION:-$(jq -r '.generatorVersion // "latest"' "$CONFIG_FILE")}"
    if [ "$SKIP_VALIDATE" = "false" ]; then
        SKIP_VALIDATE="$(jq -r '.skipValidateSpec // false' "$CONFIG_FILE")"
    fi
fi

if [ -n "$SPEC_URL" ]; then
    echo "Downloading specification from $SPEC_URL..."
    mkdir -p "$(dirname "$SPEC_FILE")"
    curl -s "$SPEC_URL" -o "$SPEC_FILE"
fi

if [ ! -f "$SPEC_FILE" ]; then
    echo "Error: Specification file not found at $SPEC_FILE"
    exit 1
fi

echo "Applying universal spec cleanups & enrichments..."
ENRICH_ARGS=(--spec="$SPEC_FILE" --output="$SPEC_FILE")
if [ -f "$ENRICHMENTS_FILE" ]; then
    ENRICH_ARGS+=(--enrichments="$ENRICHMENTS_FILE")
fi
node "$SCRIPT_DIR/scripts/enrich-spec.js" "${ENRICH_ARGS[@]}"

OUTPUT_DIR=".generator/generated-client"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

EXTRA_ARGS=()
if [ "$SKIP_VALIDATE" = "true" ]; then
    EXTRA_ARGS+=(--skip-validate-spec)
fi

CONFIG_ARG=()
if [ -f "$CONFIG_FILE" ]; then
    CONFIG_ARG=(-c "/local/$CONFIG_FILE")
fi

echo "Generating SDK via openapitools/openapi-generator-cli:${GEN_VERSION} (${TARGET_LANG})..."
docker run --rm \
    -u "$(id -u):$(id -g)" \
    -v "$PWD:/local" \
    "openapitools/openapi-generator-cli:${GEN_VERSION}" generate \
    -i "/local/$SPEC_FILE" \
    -g "$TARGET_LANG" \
    "${CONFIG_ARG[@]}" \
    -o "/local/${OUTPUT_DIR}" \
    "${EXTRA_ARGS[@]}"

echo "Extracting generated source files..."
case "$TARGET_LANG" in
    php)
        mkdir -p lib docs test
        cp -R "$OUTPUT_DIR/lib/." lib/ || true
        cp -R "$OUTPUT_DIR/docs/." docs/ || true
        cp -R "$OUTPUT_DIR/test/." test/ || true
        cp "$OUTPUT_DIR/README.md" API_README.md || true
        ;;
    typescript*|javascript*)
        mkdir -p src docs
        cp -R "$OUTPUT_DIR/src/." src/ || cp -R "$OUTPUT_DIR/"*.ts src/ 2>/dev/null || true
        cp -R "$OUTPUT_DIR/docs/." docs/ || true
        cp "$OUTPUT_DIR/README.md" API_README.md || true
        ;;
    python)
        mkdir -p docs test
        cp -R "$OUTPUT_DIR/docs/." docs/ || true
        cp -R "$OUTPUT_DIR/test/." test/ || true
        cp "$OUTPUT_DIR/README.md" API_README.md || true
        find "$OUTPUT_DIR" -maxdepth 1 -mindepth 1 -type d ! -name "docs" ! -name "test" -exec cp -R {} . \;
        ;;
    *)
        mkdir -p docs
        cp -R "$OUTPUT_DIR/." . || true
        ;;
esac

rm -rf "$OUTPUT_DIR"
echo "✅ Generation complete."
