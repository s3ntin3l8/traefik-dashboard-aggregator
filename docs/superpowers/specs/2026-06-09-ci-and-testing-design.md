# CI and Testing Enhancement Design

## Overview
This document outlines the plan to introduce automated dependency updates, security scanning, and improved test coverage for the `traefik-viewer` project.

## Components

### 1. Dependabot
Automated dependency updates will be configured via `.github/dependabot.yml` to keep the project's dependencies secure and up-to-date.
- **Ecosystems Covered**:
  - `gomod` (Backend, `/`)
  - `npm` (Frontend, `/web`)
  - `docker` (Base images, `/`)
  - `github-actions` (Workflows, `/`)
- **Schedule**: Weekly.
- **Reviewers/Assignees**: None by default, relies on CI passing.

### 2. CodeQL Security Scanning
A new GitHub Actions workflow (`.github/workflows/codeql.yml`) will be created to perform semantic code analysis to find vulnerabilities.
- **Languages**: `go` and `javascript-typescript`.
- **Triggers**: On `push` to `main` and `pull_request` against `main`.

### 3. Unit Test Enhancements
We will improve the test coverage of the Go backend, specifically focusing on the `internal/httpapi` module, which currently has around 47% coverage.
- **Focus Area**: `internal/httpapi`
- **Goal**: Add tests for HTTP handlers, request validation, and error scenarios that are currently untested.

## Out of Scope
- Adding new test frameworks (e.g., E2E testing with Playwright).
- Fixing pre-existing vulnerabilities discovered by CodeQL (these will be addressed separately if found).
