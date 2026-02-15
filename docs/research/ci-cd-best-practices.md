# CI/CD Best Practices Research: GitHub Actions & GitLab CI

> Research compiled: February 2026
> Purpose: Reference material for creating a CI skill that generates workflows

---

## Table of Contents

1. [GitHub Actions Best Practices](#1-github-actions-best-practices)
2. [GitLab CI Best Practices](#2-gitlab-ci-best-practices)
3. [Per-Language CI Tools & Workflows](#3-per-language-ci-tools--workflows)
   - [PHP](#31-php)
   - [Python](#32-python)
   - [Node.js / TypeScript](#33-nodejs--typescript)
   - [Go](#34-go)
   - [Rust](#35-rust)
   - [Java](#36-java)
4. [Common CI Patterns](#4-common-ci-patterns)
5. [Dependency Caching Strategies](#5-dependency-caching-strategies)
6. [Security Scanning](#6-security-scanning)

---

## 1. GitHub Actions Best Practices

### 1.1 Workflow Structure

**Core principles:**

- Use descriptive names for workflow files (e.g., `ci.yml`, `build-and-test.yml`)
- Define triggers explicitly with branch filters
- Set explicit `permissions` at the workflow or job level
- Use `concurrency` groups to cancel redundant runs
- Shallow clone with `fetch-depth: 1` for speed

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1
```

### 1.2 Matrix Builds

Use `strategy.matrix` to parallelize testing across OS, language versions, and configurations. Set `fail-fast: false` to avoid cancelling sibling jobs on first failure.

```yaml
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest]
        node-version: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm test
```

### 1.3 Caching

- Use `hashFiles()` for intelligent cache invalidation
- Implement layered `restore-keys` for fallback scenarios
- Prefer built-in cache options in setup actions (e.g., `actions/setup-node` has `cache: npm`)
- Cache package manager directories, not `node_modules` directly

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
```

### 1.4 Security

- **Pin action versions** to full SHA, never `@main` or `@master`
- **Least privilege permissions** on `GITHUB_TOKEN`
- **OIDC authentication** for cloud providers (AWS, Azure, GCP) -- no long-lived credentials
- **Store secrets** in GitHub Secrets, not in code
- **Dependency review** with `dependency-review-action`
- **SAST** with CodeQL or similar

```yaml
permissions:
  contents: read
  pull-requests: write
  checks: write
  security-events: write
```

### 1.5 Artifact Management

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: test-results
    path: coverage/
    retention-days: 14

- uses: actions/download-artifact@v4
  with:
    name: test-results
```

### 1.6 Job Dependencies & Output Passing

```yaml
jobs:
  build:
    outputs:
      version: ${{ steps.version.outputs.value }}
    steps:
      - id: version
        run: echo "value=1.0.0" >> $GITHUB_OUTPUT

  deploy:
    needs: build
    steps:
      - run: echo "Deploying ${{ needs.build.outputs.version }}"
```

### 1.7 Reusable Workflows

```yaml
# .github/workflows/reusable-test.yml
on:
  workflow_call:
    inputs:
      node-version:
        type: string
        default: '20'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs.node-version }}
      - run: npm ci && npm test
```

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    uses: ./.github/workflows/reusable-test.yml
    with:
      node-version: '20'
```

---

## 2. GitLab CI Best Practices

### 2.1 Pipeline Architecture Patterns

GitLab supports four pipeline architectures:

| Pattern | Use Case |
|---------|----------|
| **Basic** | Simple projects; stages run sequentially |
| **DAG (`needs`)** | Complex projects; jobs start as soon as dependencies finish |
| **Parent-Child** | Monorepos; dynamic per-component pipelines |
| **Multi-Project** | Microservices; cross-repo orchestration |

### 2.2 Stage Structure

Standard stage ordering:

```yaml
stages:
  - lint
  - test
  - build
  - security
  - deploy
```

### 2.3 Pipeline Configuration

```yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
    - if: $CI_COMMIT_TAG

default:
  image: ubuntu:22.04
  interruptible: true
  retry:
    max: 2
    when:
      - runner_system_failure
      - stuck_or_timeout_failure
```

### 2.4 Caching

- Use `cache:key:files` to derive keys from lock files
- Set `policy: pull` on jobs that only read the cache (tests)
- Set `policy: pull-push` on jobs that populate the cache (install)
- Use `fallback_keys` for branch cache misses
- Maximum 4 caches per job

```yaml
build:
  stage: build
  cache:
    - key:
        files:
          - composer.lock
      paths:
        - vendor/
      policy: pull-push
    - key:
        files:
          - package-lock.json
      paths:
        - node_modules/
      policy: pull-push

test:
  stage: test
  cache:
    - key:
        files:
          - composer.lock
      paths:
        - vendor/
      policy: pull
```

### 2.5 Artifacts vs. Cache

| Feature | Cache | Artifacts |
|---------|-------|-----------|
| Purpose | Speed up dependency installation | Pass results between stages |
| Scope | Same job across pipelines | Different jobs in same pipeline |
| Storage | Runner machine (or S3) | GitLab server |
| Reliability | Best-effort, may miss | Guaranteed availability |

```yaml
test:
  stage: test
  script:
    - pytest --junitxml=report.xml --cov-report=html
  artifacts:
    when: always
    reports:
      junit: report.xml
    paths:
      - htmlcov/
    expire_in: 7 days
```

### 2.6 DAG with `needs`

```yaml
lint:
  stage: lint
  script: npm run lint

unit-test:
  stage: test
  needs: [lint]
  script: npm test

integration-test:
  stage: test
  needs: [lint]
  script: npm run test:integration

build:
  stage: build
  needs: [unit-test, integration-test]
  script: npm run build
```

### 2.7 Rules & Conditional Jobs

```yaml
deploy:
  stage: deploy
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: on_success
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      when: manual
    - when: never
```

---

## 3. Per-Language CI Tools & Workflows

### 3.1 PHP

**Standard CI tools:**

| Tool | Purpose | Command |
|------|---------|---------|
| **PHPUnit** | Unit/integration testing | `vendor/bin/phpunit` |
| **Pest** | Testing (modern API) | `vendor/bin/pest --ci` |
| **PHPStan** | Static analysis (types) | `vendor/bin/phpstan analyse --memory-limit=512M` |
| **Psalm** | Static analysis (types) | `vendor/bin/psalm --no-cache` |
| **PHP-CS-Fixer** | Code style fixing | `vendor/bin/php-cs-fixer fix --dry-run --diff` |
| **Rector** | Automated refactoring | `vendor/bin/rector process --dry-run` |

#### GitHub Actions - PHP

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  code-style:
    name: Code Style
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          tools: php-cs-fixer
      - run: php-cs-fixer fix --dry-run --diff

  static-analysis:
    name: Static Analysis
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          coverage: none
      - run: composer install --no-interaction --prefer-dist
      - run: vendor/bin/phpstan analyse --memory-limit=512M

  rector:
    name: Rector
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          coverage: none
      - run: composer install --no-interaction --prefer-dist
      - run: vendor/bin/rector process --dry-run

  tests:
    name: Tests (PHP ${{ matrix.php }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        php: ['8.2', '8.3', '8.4']
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php }}
          coverage: xdebug
      - run: composer install --no-interaction --prefer-dist
      - run: vendor/bin/phpunit --coverage-clover coverage.xml
      # Or for Pest:
      # - run: vendor/bin/pest --ci --coverage --min=80
```

#### GitLab CI - PHP

```yaml
image: php:8.3-cli

stages:
  - install
  - lint
  - test

variables:
  COMPOSER_HOME: $CI_PROJECT_DIR/.composer

install:
  stage: install
  before_script:
    - apt-get update && apt-get install -y git unzip
    - curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
  script:
    - composer install --no-interaction --prefer-dist --optimize-autoloader
  cache:
    - key:
        files:
          - composer.lock
      paths:
        - vendor/
        - $COMPOSER_HOME/cache/
      policy: pull-push
  artifacts:
    paths:
      - vendor/
    expire_in: 1 hour

code-style:
  stage: lint
  needs: [install]
  script:
    - vendor/bin/php-cs-fixer fix --dry-run --diff

phpstan:
  stage: lint
  needs: [install]
  script:
    - vendor/bin/phpstan analyse --memory-limit=512M --error-format=gitlab > phpstan-report.json
  artifacts:
    reports:
      codequality: phpstan-report.json
    when: always

rector:
  stage: lint
  needs: [install]
  script:
    - vendor/bin/rector process --dry-run

tests:
  stage: test
  needs: [install]
  script:
    - vendor/bin/phpunit --coverage-clover coverage.xml --log-junit report.xml
  coverage: '/^\s*Lines:\s*\d+.\d+\%/'
  artifacts:
    reports:
      junit: report.xml
    paths:
      - coverage.xml
    when: always
```

---

### 3.2 Python

**Standard CI tools:**

| Tool | Purpose | Command |
|------|---------|---------|
| **pytest** | Testing | `pytest -v --cov=src` |
| **mypy** | Static type checking | `mypy src/` |
| **ruff** | Linting + formatting (fast) | `ruff check .` / `ruff format --check .` |
| **black** | Code formatting | `black --check .` |
| **isort** | Import sorting | `isort --check-only .` |
| **pylint** | Linting (comprehensive) | `pylint src/` |
| **flake8** | Linting (lightweight) | `flake8 .` |
| **bandit** | Security analysis | `bandit -r src/` |

> **2025-2026 trend:** Ruff is replacing black, isort, flake8, and pylint in many projects, as it handles linting and formatting in one tool at significantly higher speed. Mypy remains the primary type checker, though `ty` (from the Ruff team) is emerging as a faster alternative.

#### GitHub Actions - Python

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
          cache-dependency-glob: "uv.lock"
      - run: uv python install 3.13
      - run: uv sync --all-extras --dev
      - name: Ruff lint
        run: uv run ruff check .
      - name: Ruff format
        run: uv run ruff format --check .

  type-check:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
      - run: uv python install 3.13
      - run: uv sync --all-extras --dev
      - run: uv run mypy src/

  test:
    name: Test (Python ${{ matrix.python-version }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        python-version: ['3.11', '3.12', '3.13']
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
      - run: uv python install ${{ matrix.python-version }}
      - run: uv sync --all-extras --dev
      - run: uv run pytest -v --cov=src --cov-report=xml
      - uses: actions/upload-artifact@v4
        if: matrix.python-version == '3.13'
        with:
          name: coverage
          path: coverage.xml

  security:
    name: Security
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
      - run: uv python install 3.13
      - run: uv sync --all-extras --dev
      - run: uv run bandit -r src/
```

**Alternative with pip (traditional setup):**

```yaml
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.13'
          cache: pip
      - run: pip install -r requirements.txt
      - run: pytest -v --cov=src
```

#### GitLab CI - Python

```yaml
image: python:3.13-slim

stages:
  - lint
  - test

variables:
  PIP_CACHE_DIR: $CI_PROJECT_DIR/.pip-cache
  UV_CACHE_DIR: $CI_PROJECT_DIR/.uv-cache

.uv-setup:
  before_script:
    - pip install uv
    - uv sync --all-extras --dev
  cache:
    - key:
        files:
          - uv.lock
      paths:
        - .uv-cache/
        - .venv/
      policy: pull-push

ruff-lint:
  stage: lint
  extends: .uv-setup
  script:
    - uv run ruff check . --output-format=gitlab > ruff-report.json
  artifacts:
    reports:
      codequality: ruff-report.json
    when: always

ruff-format:
  stage: lint
  extends: .uv-setup
  script:
    - uv run ruff format --check .

mypy:
  stage: lint
  extends: .uv-setup
  script:
    - uv run mypy src/

test:
  stage: test
  extends: .uv-setup
  script:
    - uv run pytest -v --cov=src --cov-report=xml --junitxml=report.xml
  coverage: '/(?i)total.*? (100(?:\.0+)?\%|[1-9]?\d(?:\.\d+)?\%)$/'
  artifacts:
    reports:
      junit: report.xml
    paths:
      - coverage.xml
    when: always

security:
  stage: lint
  extends: .uv-setup
  script:
    - uv run bandit -r src/ -f json -o bandit-report.json
  artifacts:
    paths:
      - bandit-report.json
    when: always
  allow_failure: true
```

---

### 3.3 Node.js / TypeScript

**Standard CI tools:**

| Tool | Purpose | Command |
|------|---------|---------|
| **Jest** | Testing (established) | `npx jest --coverage` |
| **Vitest** | Testing (Vite-native, fast) | `npx vitest run --coverage` |
| **ESLint** | Linting | `npx eslint .` |
| **Prettier** | Code formatting | `npx prettier --check .` |
| **tsc** | Type checking | `npx tsc --noEmit` |

> **2025-2026 trend:** Vitest is increasingly preferred over Jest for new projects due to native ES modules support and faster execution. ESLint v9+ uses flat config (`eslint.config.js`). Biome is emerging as a combined linter/formatter alternative.

#### GitHub Actions - Node.js / TypeScript

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  lint:
    name: Lint & Format
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx eslint .
      - run: npx prettier --check .

  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit

  test:
    name: Test (Node ${{ matrix.node-version }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node-version: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      # For Jest:
      - run: npx jest --coverage --ci
      # For Vitest:
      # - run: npx vitest run --coverage
      - uses: actions/upload-artifact@v4
        if: matrix.node-version == 22
        with:
          name: coverage
          path: coverage/
```

**With pnpm:**

```yaml
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
```

#### GitLab CI - Node.js / TypeScript

```yaml
image: node:22-slim

stages:
  - install
  - lint
  - test
  - build

variables:
  npm_config_cache: $CI_PROJECT_DIR/.npm

install:
  stage: install
  script:
    - npm ci
  cache:
    - key:
        files:
          - package-lock.json
      paths:
        - .npm/
      policy: pull-push
  artifacts:
    paths:
      - node_modules/
    expire_in: 1 hour

eslint:
  stage: lint
  needs: [install]
  script:
    - npx eslint . --format json --output-file eslint-report.json
  artifacts:
    reports:
      codequality: eslint-report.json
    when: always

prettier:
  stage: lint
  needs: [install]
  script:
    - npx prettier --check .

typecheck:
  stage: lint
  needs: [install]
  script:
    - npx tsc --noEmit

test:
  stage: test
  needs: [install]
  script:
    - npx jest --coverage --ci --reporters=default --reporters=jest-junit
    # Or for Vitest:
    # - npx vitest run --coverage --reporter=junit --outputFile=report.xml
  coverage: '/All files[^|]*\|[^|]*\s+([\d\.]+)/'
  artifacts:
    reports:
      junit: junit.xml
    paths:
      - coverage/
    when: always

build:
  stage: build
  needs: [test, eslint, typecheck]
  script:
    - npm run build
  artifacts:
    paths:
      - dist/
    expire_in: 7 days
```

---

### 3.4 Go

**Standard CI tools:**

| Tool | Purpose | Command |
|------|---------|---------|
| **go test** | Testing | `go test -race -v ./...` |
| **go vet** | Static analysis (built-in) | `go vet ./...` |
| **golangci-lint** | Meta-linter (aggregates 100+ linters) | `golangci-lint run` |
| **staticcheck** | Advanced static analysis | `staticcheck ./...` |
| **govulncheck** | Vulnerability scanning | `govulncheck ./...` |

> **Note:** `golangci-lint` includes `go vet`, `staticcheck`, and dozens of other linters. It is the de facto standard for Go CI. Configure via `.golangci.yml`.

#### GitHub Actions - Go

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

env:
  GO_VERSION: '1.23'

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: ${{ env.GO_VERSION }}
      - uses: golangci/golangci-lint-action@v6
        with:
          version: latest

  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: ${{ env.GO_VERSION }}
      - run: go mod verify
      - run: go build -v ./...
      - run: go test -race -coverprofile=coverage.out -covermode=atomic ./...
      - uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage.out

  security:
    name: Security
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: ${{ env.GO_VERSION }}
      - run: go install golang.org/x/vuln/cmd/govulncheck@latest
      - run: govulncheck ./...

  build:
    name: Build (${{ matrix.goos }}/${{ matrix.goarch }})
    runs-on: ubuntu-latest
    needs: [lint, test]
    strategy:
      matrix:
        include:
          - goos: linux
            goarch: amd64
          - goos: linux
            goarch: arm64
          - goos: darwin
            goarch: arm64
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: ${{ env.GO_VERSION }}
      - run: |
          GOOS=${{ matrix.goos }} GOARCH=${{ matrix.goarch }} CGO_ENABLED=0 \
            go build -ldflags="-s -w" -o app-${{ matrix.goos }}-${{ matrix.goarch }} ./cmd/app
      - uses: actions/upload-artifact@v4
        with:
          name: app-${{ matrix.goos }}-${{ matrix.goarch }}
          path: app-*
```

#### GitLab CI - Go

```yaml
image: golang:1.23

stages:
  - lint
  - test
  - build

variables:
  GOPATH: $CI_PROJECT_DIR/.go
  GOLANGCI_LINT_CACHE: $CI_PROJECT_DIR/.golangci-lint-cache

.go-cache:
  cache:
    - key:
        files:
          - go.sum
      paths:
        - .go/pkg/mod/
      policy: pull-push

lint:
  stage: lint
  extends: .go-cache
  image: golangci/golangci-lint:latest
  script:
    - golangci-lint run --out-format code-climate > gl-code-quality-report.json
  artifacts:
    reports:
      codequality: gl-code-quality-report.json
    when: always

test:
  stage: test
  extends: .go-cache
  script:
    - go mod verify
    - go vet ./...
    - go test -race -coverprofile=coverage.out -covermode=atomic ./...
    - go tool cover -func=coverage.out
  coverage: '/total:\s+\(statements\)\s+(\d+\.\d+)%/'
  artifacts:
    paths:
      - coverage.out
    when: always

security:
  stage: lint
  extends: .go-cache
  script:
    - go install golang.org/x/vuln/cmd/govulncheck@latest
    - govulncheck ./...
  allow_failure: true

build:
  stage: build
  extends: .go-cache
  needs: [lint, test]
  script:
    - CGO_ENABLED=0 go build -ldflags="-s -w" -o app ./cmd/app
  artifacts:
    paths:
      - app
    expire_in: 7 days
```

---

### 3.5 Rust

**Standard CI tools:**

| Tool | Purpose | Command |
|------|---------|---------|
| **cargo test** | Testing | `cargo test` |
| **cargo clippy** | Linting | `cargo clippy -- -D warnings` |
| **cargo fmt** | Formatting | `cargo fmt --all -- --check` |
| **cargo audit** | Vulnerability scanning | `cargo audit` |
| **cargo deny** | License & vulnerability checking | `cargo deny check` |
| **cargo tarpaulin** | Code coverage | `cargo tarpaulin --ignore-tests` |

> **Note:** Use `dtolnay/rust-toolchain` instead of the unmaintained `actions-rs`. Use `Swatinem/rust-cache@v2` for dependency caching.

#### GitHub Actions - Rust

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

env:
  CARGO_TERM_COLOR: always

jobs:
  fmt:
    name: Rustfmt
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt
      - run: cargo fmt --all -- --check

  clippy:
    name: Clippy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy
      - uses: Swatinem/rust-cache@v2
      - run: cargo clippy --all-targets --all-features -- -D warnings

  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: cargo test --all-features

  coverage:
    name: Coverage
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: cargo install cargo-tarpaulin
      - run: cargo tarpaulin --ignore-tests --out xml
      - uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: cobertura.xml

  audit:
    name: Security Audit
    runs-on: ubuntu-latest
    # Only run when dependencies change
    if: contains(github.event.head_commit.modified, 'Cargo')
    steps:
      - uses: actions/checkout@v4
      - uses: taiki-e/install-action@cargo-deny
      - run: cargo deny check advisories
```

**Scheduled audit (run daily):**

```yaml
name: Security Audit

on:
  schedule:
    - cron: '0 0 * * *'
  push:
    paths:
      - '**/Cargo.toml'
      - '**/Cargo.lock'

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: taiki-e/install-action@cargo-deny
      - run: cargo deny check advisories
```

#### GitLab CI - Rust

```yaml
image: rust:1.83

stages:
  - lint
  - test
  - security

variables:
  CARGO_HOME: $CI_PROJECT_DIR/.cargo
  RUST_BACKTRACE: "1"

.rust-cache:
  cache:
    - key:
        files:
          - Cargo.lock
      paths:
        - .cargo/bin/
        - .cargo/registry/
        - .cargo/git/
        - target/
      policy: pull-push

fmt:
  stage: lint
  extends: .rust-cache
  script:
    - rustup component add rustfmt
    - cargo fmt --all -- --check

clippy:
  stage: lint
  extends: .rust-cache
  script:
    - rustup component add clippy
    - cargo clippy --all-targets --all-features -- -D warnings

test:
  stage: test
  extends: .rust-cache
  script:
    - cargo test --all-features
  artifacts:
    when: always

coverage:
  stage: test
  extends: .rust-cache
  script:
    - cargo install cargo-tarpaulin || true
    - cargo tarpaulin --ignore-tests --out xml
  coverage: '/\d+\.\d+% coverage/'
  artifacts:
    paths:
      - cobertura.xml
    reports:
      coverage_report:
        coverage_format: cobertura
        path: cobertura.xml

audit:
  stage: security
  extends: .rust-cache
  script:
    - cargo install cargo-audit || true
    - cargo audit
  allow_failure: true
```

---

### 3.6 Java

**Standard CI tools:**

| Tool | Purpose | Command (Maven) | Command (Gradle) |
|------|---------|-----------------|-------------------|
| **JUnit 5** | Testing | `mvn test` | `gradle test` |
| **Checkstyle** | Code style | `mvn checkstyle:check` | `gradle checkstyleMain` |
| **SpotBugs** | Bug detection | `mvn spotbugs:check` | `gradle spotbugsMain` |
| **PMD** | Static analysis | `mvn pmd:check` | `gradle pmdMain` |
| **JaCoCo** | Code coverage | `mvn jacoco:report` | `gradle jacocoTestReport` |
| **OWASP Dep Check** | Vulnerability scanning | `mvn dependency-check:check` | `gradle dependencyCheckAnalyze` |

#### GitHub Actions - Java (Maven)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  checkstyle:
    name: Checkstyle
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21
          cache: maven
      - run: mvn checkstyle:check -B

  pmd:
    name: PMD
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21
          cache: maven
      - run: mvn pmd:check -B

  spotbugs:
    name: SpotBugs
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21
          cache: maven
      - run: mvn compile spotbugs:check -B

  test:
    name: Test (Java ${{ matrix.java }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        java: [17, 21]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: ${{ matrix.java }}
          cache: maven
      - run: mvn verify -B
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-results-java${{ matrix.java }}
          path: target/surefire-reports/

  security:
    name: Dependency Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21
          cache: maven
      - run: mvn dependency-check:check -B
```

#### GitHub Actions - Java (Gradle)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  lint:
    name: Code Quality
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21
      - uses: gradle/actions/setup-gradle@v4
      - run: ./gradlew checkstyleMain pmdMain spotbugsMain

  test:
    name: Test (Java ${{ matrix.java }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        java: [17, 21]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: ${{ matrix.java }}
      - uses: gradle/actions/setup-gradle@v4
      - run: ./gradlew test jacocoTestReport
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-results-java${{ matrix.java }}
          path: build/reports/tests/
```

#### GitLab CI - Java (Maven)

```yaml
image: maven:3.9-eclipse-temurin-21

stages:
  - lint
  - test
  - build

variables:
  MAVEN_OPTS: "-Dmaven.repo.local=$CI_PROJECT_DIR/.m2/repository"

.maven-cache:
  cache:
    - key:
        files:
          - pom.xml
      paths:
        - .m2/repository/
      policy: pull-push

checkstyle:
  stage: lint
  extends: .maven-cache
  script:
    - mvn checkstyle:check -B

pmd:
  stage: lint
  extends: .maven-cache
  script:
    - mvn pmd:check -B

spotbugs:
  stage: lint
  extends: .maven-cache
  script:
    - mvn compile spotbugs:check -B

test:
  stage: test
  extends: .maven-cache
  script:
    - mvn verify -B
  artifacts:
    reports:
      junit: target/surefire-reports/TEST-*.xml
    paths:
      - target/site/jacoco/
    when: always

build:
  stage: build
  extends: .maven-cache
  needs: [test, checkstyle, pmd, spotbugs]
  script:
    - mvn package -DskipTests -B
  artifacts:
    paths:
      - target/*.jar
    expire_in: 7 days
```

#### GitLab CI - Java (Gradle)

```yaml
image: gradle:8-jdk21

stages:
  - lint
  - test
  - build

variables:
  GRADLE_USER_HOME: $CI_PROJECT_DIR/.gradle

.gradle-cache:
  cache:
    - key:
        files:
          - build.gradle
          - gradle/wrapper/gradle-wrapper.properties
      paths:
        - .gradle/caches/
        - .gradle/wrapper/
      policy: pull-push

lint:
  stage: lint
  extends: .gradle-cache
  script:
    - ./gradlew checkstyleMain pmdMain spotbugsMain

test:
  stage: test
  extends: .gradle-cache
  script:
    - ./gradlew test jacocoTestReport
  artifacts:
    reports:
      junit: build/test-results/test/TEST-*.xml
    paths:
      - build/reports/jacoco/
    when: always

build:
  stage: build
  extends: .gradle-cache
  needs: [lint, test]
  script:
    - ./gradlew assemble
  artifacts:
    paths:
      - build/libs/*.jar
    expire_in: 7 days
```

---

## 4. Common CI Patterns

### 4.1 Parallel Job Execution

**GitHub Actions:** Jobs run in parallel by default. Use `needs` to define dependencies.

```yaml
jobs:
  lint:      # Runs immediately
    ...
  test:      # Runs immediately (parallel with lint)
    ...
  build:
    needs: [lint, test]  # Waits for lint AND test
    ...
```

**GitLab CI:** Jobs within the same stage run in parallel. Use `needs` for DAG.

```yaml
stages:
  - validate
  - test
  - build

lint:
  stage: validate
  script: npm run lint

typecheck:
  stage: validate  # Parallel with lint
  script: npx tsc --noEmit

unit-test:
  stage: test
  needs: []  # DAG: start immediately, don't wait for validate stage
  script: npm test

build:
  stage: build
  needs: [lint, typecheck, unit-test]
  script: npm run build
```

### 4.2 Branch Protection & Merge Request Checks

**GitHub Actions:**

```yaml
on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened]
```

Configure in GitHub Settings: Settings > Branches > Branch protection rules:
- Require status checks to pass before merging
- Require branches to be up to date before merging
- Require review approvals

**GitLab CI:**

```yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

test:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

Configure in GitLab Settings: Settings > Merge Requests:
- Pipelines must succeed
- All threads must be resolved
- Require approval from code owners

### 4.3 Conditional Execution

**GitHub Actions:**

```yaml
jobs:
  deploy-staging:
    if: github.ref == 'refs/heads/develop'
    ...

  deploy-production:
    if: github.ref == 'refs/heads/main'
    environment: production
    ...

  # Only run on file changes
  docs:
    if: contains(github.event.head_commit.modified, 'docs/')
    ...
```

**With path filters:**

```yaml
on:
  push:
    paths:
      - 'src/**'
      - 'tests/**'
      - 'package.json'
    paths-ignore:
      - '**.md'
      - 'docs/**'
```

**GitLab CI:**

```yaml
deploy:
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: on_success
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      when: manual
    - when: never

docs:
  rules:
    - changes:
        - docs/**
        - "*.md"
```

### 4.4 Monorepo Patterns

**GitHub Actions (path-based triggers):**

```yaml
on:
  push:
    paths:
      - 'packages/api/**'

jobs:
  test-api:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: packages/api
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
```

**GitLab CI (parent-child pipelines):**

```yaml
# .gitlab-ci.yml (parent)
stages:
  - triggers

api:
  stage: triggers
  trigger:
    include: packages/api/.gitlab-ci.yml
    strategy: depend
  rules:
    - changes:
        - packages/api/**

frontend:
  stage: triggers
  trigger:
    include: packages/frontend/.gitlab-ci.yml
    strategy: depend
  rules:
    - changes:
        - packages/frontend/**
```

---

## 5. Dependency Caching Strategies

### 5.1 Per-Language Cache Configuration

| Language | GitHub Actions | Cache Path | Key File |
|----------|---------------|------------|----------|
| **PHP** | `shivammathur/setup-php` | `~/.composer/cache` | `composer.lock` |
| **Python** | `actions/setup-python` + `cache: pip` | `~/.cache/pip` | `requirements.txt` / `uv.lock` |
| **Node.js** | `actions/setup-node` + `cache: npm` | `~/.npm` | `package-lock.json` |
| **Go** | `actions/setup-go` (auto-caches) | `~/go/pkg/mod`, `~/.cache/go-build` | `go.sum` |
| **Rust** | `Swatinem/rust-cache@v2` | `~/.cargo`, `target/` | `Cargo.lock` |
| **Java** | `actions/setup-java` + `cache: maven` | `~/.m2/repository` | `pom.xml` |

### 5.2 GitHub Actions Cache Best Practices

```yaml
# Explicit cache with restore-keys fallback
- uses: actions/cache@v4
  with:
    path: |
      ~/.npm
      ~/.cache
    key: ${{ runner.os }}-deps-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-deps-
```

**Guidelines:**
- Cache limit: 10 GB per repository
- Entries expire after 7 days without access
- Include OS, language version, and lock file hash in key
- Cache package manager caches, not installed dependencies (except for speed-critical cases)
- Use built-in cache support in setup actions when available

### 5.3 GitLab CI Cache Best Practices

```yaml
# Multi-cache with fallback
job:
  cache:
    - key:
        files:
          - Gemfile.lock
      paths:
        - vendor/ruby
      fallback_keys:
        - cache-$CI_DEFAULT_BRANCH
      policy: pull-push
```

**Guidelines:**
- Use `policy: pull` on test/deploy jobs (read-only)
- Use `policy: pull-push` on install/build jobs
- Tag runners and use matching tags on cache-sharing jobs
- Maximum 4 caches per job
- Protected branches get separate cache automatically
- Use `fallback_keys` so feature branches can use main branch cache

---

## 6. Security Scanning

### 6.1 SAST (Static Application Security Testing)

**GitHub Actions:**

```yaml
  codeql:
    name: CodeQL
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript  # or python, java, go, etc.
      - uses: github/codeql-action/autobuild@v3
      - uses: github/codeql-action/analyze@v3
```

**GitLab CI:**

```yaml
include:
  - template: Security/SAST.gitlab-ci.yml

# SAST jobs are automatically added based on detected languages
```

### 6.2 Dependency Audit (SCA)

**Per-language audit commands:**

| Language | Tool | Command |
|----------|------|---------|
| **PHP** | Composer audit | `composer audit` |
| **Python** | pip-audit / safety | `pip-audit` / `safety check` |
| **Node.js** | npm audit | `npm audit --audit-level=high` |
| **Go** | govulncheck | `govulncheck ./...` |
| **Rust** | cargo audit / cargo deny | `cargo audit` / `cargo deny check` |
| **Java** | OWASP Dependency-Check | `mvn dependency-check:check` |

**GitHub Actions (multi-language):**

```yaml
  dependency-review:
    name: Dependency Review
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: high
```

**GitLab CI:**

```yaml
include:
  - template: Security/Dependency-Scanning.gitlab-ci.yml
```

### 6.3 Secret Detection

**GitHub Actions:**

```yaml
  secrets:
    name: Secret Scanning
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: trufflesecurity/trufflehog@main
        with:
          extra_args: --only-verified
```

**GitLab CI:**

```yaml
include:
  - template: Security/Secret-Detection.gitlab-ci.yml
```

### 6.4 Container Scanning

**GitHub Actions:**

```yaml
  container-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aquasecurity/trivy-action@master
        with:
          image-ref: myapp:latest
          format: sarif
          output: trivy-results.sarif
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: trivy-results.sarif
```

**GitLab CI:**

```yaml
include:
  - template: Security/Container-Scanning.gitlab-ci.yml

container_scanning:
  variables:
    CS_IMAGE: $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
```

---

## 7. Quick Reference: Complete CI Template Skeletons

### 7.1 Minimal GitHub Actions Template

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Language-specific setup + lint commands

  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Language-specific setup + test commands

  security:
    name: Security
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Dependency audit + SAST
```

### 7.2 Minimal GitLab CI Template

```yaml
stages:
  - lint
  - test
  - build

workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

default:
  interruptible: true

lint:
  stage: lint
  # Language-specific image + lint commands

test:
  stage: test
  # Language-specific image + test commands
  artifacts:
    reports:
      junit: report.xml

build:
  stage: build
  needs: [lint, test]
  # Build commands
  artifacts:
    paths:
      - dist/
    expire_in: 7 days
```

---

## Sources

### GitHub Actions
- [GitHub Actions CI/CD Best Practices (GitHub Copilot)](https://github.com/github/awesome-copilot/blob/main/instructions/github-actions-ci-cd-best-practices.instructions.md)
- [GitHub Actions Matrix Strategy (Codefresh)](https://codefresh.io/learn/github-actions/github-actions-matrix/)
- [GitHub Actions Caching (Medium)](https://medium.com/@amareswer/github-actions-caching-and-performance-optimization-38c76ac29151)
- [GitHub Actions Security Best Practices (Medium)](https://medium.com/@amareswer/github-actions-security-best-practices-1d3f33cdf705)
- [GitHub Actions Cache (Official)](https://github.com/actions/cache)
- [GitHub Dependency Caching Reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
- [Caching with Popular Languages (WarpBuild)](https://www.warpbuild.com/blog/github-actions-cache)

### GitLab CI
- [GitLab Pipeline Architecture (Docs)](https://docs.gitlab.com/ci/pipelines/pipeline_architectures/)
- [GitLab CI Caching (Docs)](https://docs.gitlab.com/ci/caching/)
- [7 GitLab CI/CD Pipeline Best Practices (TechCloudUp)](https://www.techcloudup.com/2025/04/7-gitlab-cicd-pipeline-best-practices.html)
- [Caching Strategies in GitLab CI (OneUptime)](https://oneuptime.com/blog/post/2026-01-25-caching-strategies-gitlab-ci/view)
- [GitLab CI/CD Pipeline Deployment Guide 2025 (PloyCloud)](https://ploy.cloud/blog/gitlab-cicd-pipeline-deployment-guide-2025/)

### PHP
- [PHPStan GitHub Action](https://github.com/php-actions/phpstan)
- [PHP-CS-Fixer with GitHub Annotations](https://madewithlove.com/blog/adding-github-annotations-with-php-cs-fixer/)
- [Pest CI Documentation](https://pestphp.com/docs/continuous-integration)
- [GitLab CI PHP Testing (Docs)](https://docs.gitlab.com/ee/ci/examples/php.html)
- [PHPStan in GitLab](https://www.guywarner.dev/phpstan-in-gitlab)

### Python
- [GitHub Actions Setup for Python Projects 2025](https://ber2.github.io/posts/2025_github_actions_python/)
- [Building and Testing Python (GitHub Docs)](https://docs.github.com/en/actions/tutorials/build-and-test-code/python)
- [GitHub Actions for Python CI (Sourcery)](https://sourcery.ai/blog/github-actions)
- [Python Testing within GitLab (Luka Zeleznik)](https://lukazeleznik.com/blog/python-testing-ci-infrastructure/)
- [mypy GitLab Code Quality (PyPI)](https://pypi.org/project/mypy-gitlab-code-quality/)

### Node.js / TypeScript
- [Linting Pipeline in GitHub Actions (OneUptime)](https://oneuptime.com/blog/post/2025-12-20-linting-pipeline-github-actions/view)
- [Jest and GitHub Actions (Joel Hooks)](https://joelhooks.com/jest-and-github-actions/)
- [GitLab CI Node.js Template (to-be-continuous)](https://to-be-continuous.gitlab.io/doc/ref/node/)
- [Jest in GitLab CI (GitHub Gist)](https://gist.github.com/rishitells/3c4536131819cff4eba2c8ab5bbb4570)

### Go
- [Go Linting Best Practices for CI/CD (Medium)](https://medium.com/@tedious/go-linting-best-practices-for-ci-cd-with-github-actions-aa6d96e0c509)
- [golangci-lint GitHub Action (Official)](https://github.com/golangci/golangci-lint-action)
- [CI with Go and GitHub Actions (Alex Edwards)](https://www.alexedwards.net/blog/ci-with-go-and-github-actions)
- [Go CI Pipeline with GitHub Actions (OneUptime)](https://oneuptime.com/blog/post/2025-12-20-go-ci-pipeline-github-actions/view)
- [Go Standards (GitLab Docs)](https://docs.gitlab.com/development/go_guide/)
- [Staticcheck GitHub Actions](https://staticcheck.dev/docs/running-staticcheck/ci/github-actions/)

### Rust
- [Rust CI GitHub Actions Setup (LukeMathWalker)](https://gist.github.com/LukeMathWalker/5ae1107432ce283310c3e601fac915f3)
- [Rust CI GitLab Setup (LukeMathWalker)](https://gist.github.com/LukeMathWalker/d98fa8d0fc5394b347adf734ef0e85ec)
- [Rust CI GitHub Actions Template (BamPeers)](https://github.com/BamPeers/rust-ci-github-actions-workflow)
- [Setting up CI/CD for Rust 2025 (Shuttle)](https://www.shuttle.dev/blog/2025/01/23/setup-rust-ci-cd)
- [Secure Rust Development with GitLab](https://about.gitlab.com/blog/secure-rust-development-with-gitlab/)

### Java
- [Automate Java Code Review with GitHub Actions (Kranio)](https://www.kranio.io/en/blog/automatiza-la-revision-de-codigo-java-con-github-actions)
- [SpotBugs GitHub Action](https://github.com/jwgmeligmeyling/spotbugs-github-action)
- [Checkstyle GitHub Action](https://github.com/jwgmeligmeyling/checkstyle-github-action)
- [GitLab CI/CD Pipeline for Java (Medium)](https://medium.com/@ankit630/elevating-software-quality-a-comprehensive-gitlab-ci-cd-pipeline-for-java-projects-8b91d098b4b4)
- [gitlab-code-quality-plugin (Maven)](https://github.com/chkal/gitlab-code-quality-plugin)

### Security
- [GitLab SAST (Docs)](https://docs.gitlab.com/user/application_security/sast/)
- [CI/CD Security Scanning (Wiz)](https://www.wiz.io/academy/application-security/ci-cd-security-scanning)
- [Security Scanning in GitLab CI (OneUptime)](https://oneuptime.com/blog/post/2026-01-26-security-scanning-gitlab-ci/view)
- [DevSecOps StarterKit (GitHub)](https://github.com/4dlt/DevSecOps-StarterKit)
