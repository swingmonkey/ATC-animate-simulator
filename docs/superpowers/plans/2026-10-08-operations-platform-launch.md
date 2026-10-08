# 模拟运营平台上线 Implementation Plan

> **For agentic workers:** Implement each task in order; keep the existing management engine and preserve the user's untracked `tasks/` directory.

**Goal:** Add a usable web operations home and publish the simulator at a separate HTTPS path.

**Architecture:** A small UI view controller switches between the existing radar layout and a new operations layout. The operations layout hosts the existing management panel and receives the same state snapshots; the management event subscription saves state. Static files are released under a versioned directory and served by a narrow Nginx location.

**Tech Stack:** Native HTML/CSS/ES modules, Canvas 2D, Electron smoke test, Nginx static hosting.

## Global Constraints

- Git fetch/push uses SSH; pull before editing and push after committing.
- Do not add `tasks/`, `.env`, keys, or server secrets.
- The existing AviationHot root site and other paths must continue working.
- Browser save data remains local to that browser and origin.

---

### Task 1: Operations view and navigation

**Files:** `index.html`, `styles.css`, `js/ui/platformView.js`, `js/main.js`, `js/ui/managementPanel.js`.

- [ ] Add a global two-view navigation and move the existing management section into a dedicated operations layout.
- [ ] Bind view switching once; default web to operations and Electron to radar; resize and redraw radar after return.
- [ ] Render a useful next-step prompt from `managementSummary()` and expose an obvious route into duty mode.
- [ ] Add a focused Electron smoke assertion for view switching and the operations content.
- [ ] Run `npm run check` and `npm run smoke`; commit the task in Chinese.

### Task 2: Durable operations progress

**Files:** `js/ui/subscriptions.js`, `desktop/main.js`.

- [ ] Reproduce the missing persistence by taking a snapshot after a management action and reloading.
- [ ] Save on management state changes without duplicating save calls for every narrower event.
- [ ] Verify cash, staff, contract, day and existing radar data survive reload; run checks and commit.

### Task 3: Static web release

**Files:** `README.md`, deployment script or documented deployment procedure.

- [ ] Package only browser assets and copy them to a versioned release directory on HP.
- [ ] Add an isolated Nginx path with a backup, `nginx -t`, and rollback instructions.
- [ ] Test the public HTML, CSS, ES module responses and the operating flow in a browser.
- [ ] Push the Git branch and report the deployed URL, commit and any remaining limitations.
