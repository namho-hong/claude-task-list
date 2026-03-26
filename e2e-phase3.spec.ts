import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const TASKS_DIR = path.join(
  process.env.HOME || "~",
  ".claude",
  "tasks",
  "E2E-Test"
);

// Mock data matching E2E-Test list
const MOCK_LISTS = () => {
  const tasks = [];
  const dir = TASKS_DIR;
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      if (file === "0.json" || !file.endsWith(".json")) continue;
      try {
        tasks.push(JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")));
      } catch {}
    }
  }
  return [
    {
      name: "E2E-Test",
      tasks,
      total: tasks.length,
      completed: tasks.filter((t: any) => t.status === "completed").length,
    },
  ];
};

async function mockTauriInvoke(page: Page) {
  await page.addInitScript(() => {
    // Mock Tauri IPC
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
        const resp = await fetch("/__e2e_invoke__", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd, args }),
        });
        return resp.json();
      },
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      convertFileSrc: (path: string) => path,
    };
    // Mock event listener (no-op)
    (window as any).__TAURI_INTERNALS__.invoke.listen = () =>
      Promise.resolve(() => {});
  });
}

// Since we can't easily mock the full Tauri IPC in the browser,
// we'll test the rendered DOM by injecting mock data directly.

async function setupPage(page: Page) {
  const lists = MOCK_LISTS();

  // Intercept the page and inject mocks before React loads
  await page.addInitScript((listsData) => {
    // Mock @tauri-apps/api/core invoke
    const mockInvoke = async (cmd: string, args?: any) => {
      if (cmd === "get_task_lists") return listsData;
      if (cmd === "get_tasks") return listsData[0]?.tasks || [];
      if (cmd === "update_task_status") {
        // Return success
        return null;
      }
      if (cmd === "create_task") {
        return {
          id: "999",
          subject: args?.subject || "test",
          description: "",
          status: "pending",
          blocks: [],
          blockedBy: [],
        };
      }
      if (cmd === "delete_task") return null;
      if (cmd === "create_list") return null;
      if (cmd === "spawn_list") return null;
      if (cmd === "spawn_task") return null;
      return null;
    };

    const mockListen = () => Promise.resolve(() => {});

    // Override module resolution
    (window as any).__TAURI_INTERNALS__ = {
      invoke: mockInvoke,
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      convertFileSrc: (p: string) => p,
    };

    // Also patch for @tauri-apps/api/event
    (window as any).__TAURI_MOCK_LISTEN__ = mockListen;
  }, lists);
}

test.describe("Phase 3: Screen 2 태스크 상세 + CRUD", () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
    await page.goto("http://localhost:1420");
    // Wait for app to render
    await page.waitForSelector('[data-testid="app-root"]', { timeout: 5000 });
  });

  test("Screen 1에 리스트가 표시됨", async ({ page }) => {
    const card = page.locator('[data-testid="list-card-E2E-Test"]');
    await expect(card).toBeVisible();
  });

  test("리스트 카드 클릭 → Screen 2 전환", async ({ page }) => {
    await page.click('[data-testid="list-card-E2E-Test"]');
    await expect(page.locator('[data-testid="btn-back"]')).toBeVisible();
    await expect(page.locator('[data-testid="btn-spawn-all"]')).toBeVisible();
  });

  test("태스크가 상태별 정렬됨 (in_progress → pending → completed)", async ({
    page,
  }) => {
    await page.click('[data-testid="list-card-E2E-Test"]');
    await page.waitForSelector('[data-testid="btn-back"]');

    // Get section headers in order
    const headers = await page.locator(".section-header").allTextContents();
    const expectedOrder = ["In Progress", "Pending", "Completed"];
    // Filter to only existing sections
    const filteredExpected = expectedOrder.filter((h) => headers.includes(h));
    expect(headers).toEqual(filteredExpected);
  });

  test("태스크 상태 아이콘 표시 (○ ◉ ✓)", async ({ page }) => {
    await page.click('[data-testid="list-card-E2E-Test"]');
    await page.waitForSelector('[data-testid="btn-back"]');

    // in_progress task (id=1) should show ◉
    const status1 = await page
      .locator('[data-testid="task-status-1"]')
      .textContent();
    expect(status1?.trim()).toBe("◉");

    // pending task (id=2) should show ○
    const status2 = await page
      .locator('[data-testid="task-status-2"]')
      .textContent();
    expect(status2?.trim()).toBe("○");

    // completed task (id=4) should show ✓
    const status4 = await page
      .locator('[data-testid="task-status-4"]')
      .textContent();
    expect(status4?.trim()).toBe("✓");
  });

  test("completed 태스크 dimmed + 스폰 버튼 없음", async ({ page }) => {
    await page.click('[data-testid="list-card-E2E-Test"]');
    await page.waitForSelector('[data-testid="btn-back"]');

    // Completed task should have task-completed class
    const taskItem4 = page.locator('[data-testid="task-item-4"]');
    await expect(taskItem4).toHaveClass(/task-completed/);

    // No spawn button for completed tasks
    const spawnBtn4 = page.locator('[data-testid="btn-spawn-4"]');
    await expect(spawnBtn4).toHaveCount(0);
  });

  test("pending/in_progress 태스크에 스폰 버튼 있음", async ({ page }) => {
    await page.click('[data-testid="list-card-E2E-Test"]');
    await page.waitForSelector('[data-testid="btn-back"]');

    // in_progress task has spawn button
    await expect(page.locator('[data-testid="btn-spawn-1"]')).toBeAttached();
    // pending task has spawn button
    await expect(page.locator('[data-testid="btn-spawn-2"]')).toBeAttached();
  });

  test("Add Task 입력 필드와 버튼 존재", async ({ page }) => {
    await page.click('[data-testid="list-card-E2E-Test"]');
    await page.waitForSelector('[data-testid="btn-back"]');

    await expect(page.locator('[data-testid="input-new-task"]')).toBeVisible();
    await expect(page.locator('[data-testid="btn-add-task"]')).toBeVisible();
  });

  test("뒤로가기 버튼 → Screen 1 복귀", async ({ page }) => {
    await page.click('[data-testid="list-card-E2E-Test"]');
    await page.waitForSelector('[data-testid="btn-back"]');

    await page.click('[data-testid="btn-back"]');
    // Should be back to Screen 1
    await expect(
      page.locator('[data-testid="list-card-E2E-Test"]')
    ).toBeVisible();
    await expect(page.locator('[data-testid="btn-back"]')).toHaveCount(0);
  });

  test("태스크 텍스트 클릭 → 상태 토글 호출", async ({ page }) => {
    // Track invoke calls
    await page.addInitScript(() => {
      const orig = (window as any).__TAURI_INTERNALS__.invoke;
      (window as any).__e2e_invokes__ = [];
      (window as any).__TAURI_INTERNALS__.invoke = async (
        cmd: string,
        args?: any
      ) => {
        (window as any).__e2e_invokes__.push({ cmd, args });
        return orig(cmd, args);
      };
    });
    await page.goto("http://localhost:1420");
    await page.waitForSelector('[data-testid="app-root"]');

    await page.click('[data-testid="list-card-E2E-Test"]');
    await page.waitForSelector('[data-testid="btn-back"]');

    // Click pending task (id=2) text to toggle status
    await page.click('[data-testid="task-text-2"]');
    await page.waitForTimeout(300);

    const invokes = await page.evaluate(
      () => (window as any).__e2e_invokes__
    );
    const statusUpdate = invokes.find(
      (i: any) => i.cmd === "update_task_status"
    );
    expect(statusUpdate).toBeTruthy();
    expect(statusUpdate.args.taskId).toBe("2");
    expect(statusUpdate.args.newStatus).toBe("in_progress"); // pending -> in_progress
  });

  test("description 호버 → 툴팁 표시", async ({ page }) => {
    await page.click('[data-testid="list-card-E2E-Test"]');
    await page.waitForSelector('[data-testid="btn-back"]');

    // Task 1 has description "feature/auth 브랜치 PR 리뷰 필요"
    await page.hover('[data-testid="task-text-1"]');
    await page.waitForTimeout(200);

    const tooltip = page.locator('[data-testid="task-tooltip-1"]');
    await expect(tooltip).toBeVisible();
    const tooltipText = await tooltip.textContent();
    expect(tooltipText).toContain("feature/auth");
  });

  test("우클릭 → 컨텍스트 메뉴 → Delete 클릭", async ({ page }) => {
    await page.addInitScript(() => {
      const orig = (window as any).__TAURI_INTERNALS__.invoke;
      (window as any).__e2e_invokes__ = [];
      (window as any).__TAURI_INTERNALS__.invoke = async (
        cmd: string,
        args?: any
      ) => {
        (window as any).__e2e_invokes__.push({ cmd, args });
        return orig(cmd, args);
      };
    });
    await page.goto("http://localhost:1420");
    await page.waitForSelector('[data-testid="app-root"]');

    await page.click('[data-testid="list-card-E2E-Test"]');
    await page.waitForSelector('[data-testid="btn-back"]');

    // Right-click task 3 → context menu appears
    await page.click('[data-testid="task-item-3"]', { button: "right" });
    await page.waitForTimeout(200);

    // Context menu should be visible
    const contextMenu = page.locator('.context-menu');
    await expect(contextMenu).toBeVisible();

    // Click Delete in the context menu
    await page.click('.context-menu-item.danger');
    await page.waitForTimeout(300);

    const invokes = await page.evaluate(
      () => (window as any).__e2e_invokes__
    );
    const deleteCall = invokes.find((i: any) => i.cmd === "delete_task");
    expect(deleteCall).toBeTruthy();
    expect(deleteCall.args.taskId).toBe("3");
  });
});
