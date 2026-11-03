# OpenAPI SDK Builder

Centralized, language-agnostic automation framework for generating, enriching, and releasing production-ready API Client SDKs across any programming language using **OpenAPI Generator**.

Managed by **United Workspace** (`united-workspace`).

---

## 🚀 Overview

Instead of copying generator scripts, Docker commands, and CI workflows into every individual SDK repository, **OpenAPI SDK Builder** acts as a central engine:

1. **Universal Spec Normalization**: Runs a zero-dependency Node.js cleaner that automatically resolves common upstream API spec bugs (stripping invalid `type: object` declarations on `$ref` nodes, flattening redundant wrapper properties, and handling enum set-unions).
2. **Multi-Language Generation**: Generates clean client libraries for **PHP**, **TypeScript**, **Python**, **Go**, and more via Docker.
3. **Automated Lifecycle**: Periodically checks upstream API specs on a schedule, generates code, and opens PRs with exact version diffs and review assignments.
4. **Automated Version Tagging**: Automatically detects upstream version bumps on `main` merge and creates Git release tags for package managers (Packagist, NPM, PyPI).

---

## 📦 How to Use in an SDK Repository

To use this framework in any client SDK repository (e.g. `kiwiki-php-client`, `airkey-php-client`, `saltoks-php-client`, `kiwi-ts-client`), the client repository needs **no generator scripts**. It only needs:

### 1. The GitHub Action Workflow

Create `.github/workflows/generate-client.yml` in your SDK repository:

```yaml
name: Generate Client

on:
  workflow_dispatch:
  schedule:
    # Check for upstream API spec updates every Monday at 06:00 UTC
    - cron: '0 6 * * 1'

permissions:
  contents: write
  pull-requests: write

jobs:
  build:
    uses: United-Workspace/openapi-sdk-builder/.github/workflows/sdk-generate.yml@main
    with:
      spec-url: 'https://api.kiwi.ki/v1/spec.json'
      generator-name: 'php'                          # php, typescript-fetch, python, go, etc.
      generator-version: 'v7.13.0'                   # or 'latest'
      skip-validate-spec: true                       # optional: bypass legacy Swagger validation quirks
      pr-title: 'feat: Update KIWI.KI API Client'
      pr-reviewers: 'Nolanus'
      pr-assignees: 'Nolanus'
    secrets: inherit
```

### 2. Tagging Releases (`.github/workflows/tag-release.yml`)

Create `.github/workflows/tag-release.yml` in your SDK repository to automatically tag releases upon merging into `main`:

```yaml
name: Tag Release

on:
  push:
    branches:
      - main

permissions:
  contents: write

jobs:
  tag:
    uses: United-Workspace/openapi-sdk-builder/.github/workflows/sdk-tag-release.yml@main
    with:
      spec-file: '.generator/swagger.json'
      tag-prefix: 'v' # optional: produces tags like v18.0.14
    secrets: inherit
```

### 3. Generator Configuration (`.generator/openapi-config.json`)

Define your client options:

```json
{
  "invokerPackage": "KiwiKi",
  "apiPackage": "Api",
  "modelPackage": "Model",
  "packageName": "kiwiki-api",
  "srcBasePath": "lib",
  "variableNamingConvention": "camelCase",
  "hideGenerationTimestamp": true
}
```

### 4. Declarative Enrichments (`.generator/enrichments.json`)

Add any missing enums or polymorphic discriminator mappings:

```json
{
  "$schema": "https://json-schema.org/draft-07/schema#",
  "description": "Declarative API specification enrichments",
  "enumAdditions": {
    "LockProtocolEntry": {
      "eventCategory": ["SYNC_AFTER_UNLOCK_EVENT"]
    }
  },
  "discriminatorMappings": {
    "Medium": {
      "property": "mediumType",
      "mapping": {
        "CARD": "Card",
        "PHONE": "Phone"
      }
    }
  }
}
```

---

## 🛠 Running Locally

You can test generation on any local SDK checkout using the builder script:

```bash
# From the openapi-sdk-builder repository:
./bin/generate.sh \
  --target-dir="/Users/sebastianfuss/projects/kiwiki-php-client" \
  --lang=php \
  --version=v7.13.0 \
  --skip-validate
```

---

## ⚙️ Repository Setup

In each SDK consumer repository:
1. Navigate to **Settings** → **Actions** → **General**.
2. Under **Workflow permissions**, ensure **"Allow GitHub Actions to create and approve pull requests"** is checked so the automated client update PRs can be created.
