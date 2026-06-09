# CI and Testing Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up weekly Dependabot updates, CodeQL security scanning on PRs/pushes, and improve Go unit test coverage for the `httpapi` module.

**Architecture:** We are relying on standard GitHub Actions workflows for Dependabot and CodeQL. For testing, we are adding new test functions to the existing `handlers_test.go` file using `net/http/httptest`.

**Tech Stack:** GitHub Actions, Go `net/http/httptest`

---

### Task 1: Configure Dependabot

**Files:**
- Create: `.github/dependabot.yml`

- [ ] **Step 1: Write Dependabot configuration**

```yaml
version: 2
updates:
  - package-ecosystem: "gomod"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "npm"
    directory: "/web"
    schedule:
      interval: "weekly"
  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

- [ ] **Step 2: Commit**

```bash
git add .github/dependabot.yml
git commit -m "ci: configure weekly dependabot updates"
```

### Task 2: Configure CodeQL Scanning

**Files:**
- Create: `.github/workflows/codeql.yml`

- [ ] **Step 1: Write CodeQL workflow**

```yaml
name: "CodeQL"

on:
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]

jobs:
  analyze:
    name: Analyze
    runs-on: ubuntu-latest
    permissions:
      security-events: write

    strategy:
      fail-fast: false
      matrix:
        language: [ 'go', 'javascript-typescript' ]

    steps:
    - name: Checkout repository
      uses: actions/checkout@v6

    - name: Initialize CodeQL
      uses: github/codeql-action/init@v3
      with:
        languages: ${{ matrix.language }}

    - name: Autobuild
      uses: github/codeql-action/autobuild@v3

    - name: Perform CodeQL Analysis
      uses: github/codeql-action/analyze@v3
      with:
        category: "/language:${{matrix.language}}"
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/codeql.yml
git commit -m "ci: add codeql security scanning workflow"
```

### Task 3: Improve `httpapi` Test Coverage

**Files:**
- Modify: `internal/httpapi/handlers_test.go`

- [ ] **Step 1: Write tests for handleConfig and handleSnapshot**

Append the following code to `internal/httpapi/handlers_test.go`:

```go
func TestHandleConfig(t *testing.T) {
	s := testServer(t, nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	s.handleConfig(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, ok := got["lokiEnabled"]; !ok {
		t.Error("missing lokiEnabled in response")
	}
	if _, ok := got["authentikEnabled"]; !ok {
		t.Error("missing authentikEnabled in response")
	}
}

func TestHandleSnapshot(t *testing.T) {
	s := testServer(t, nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/snapshot", nil)
	s.handleSnapshot(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `go test -v ./internal/httpapi/...`
Expected: Tests compile and pass without errors.

- [ ] **Step 3: Commit**

```bash
git add internal/httpapi/handlers_test.go
git commit -m "test: improve coverage for httpapi handlers"
```
