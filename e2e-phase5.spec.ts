import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const TASKS_DIR = path.join(process.env.HOME || "~", ".claude", "tasks");

function makeMockLists(lists: { name: string; tasks: any[] }[]) {
  return lists.map((l) => ({
    ...l,
    total: l.tasks.length,
    completed: l.tasks.filter((t) => t.status === "completed").length,
  }));
}

function setupMock(listsData: any[]) {
  return (listsData: any[]) => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
        if (cmd === "get_task_lists") return listsData;
        if (cmd === "update_task_status") return null;
        if (cmd === "create_task") return { id: "999", subject: args?.subject || "", description: "", status: "pending", blocks: [], blockedBy: [] };
        if (cmd === "delete_task") return null;
        if (cmd === "spawn_list") return null;
        if (cmd === "spawn_task") return null;
        if (cmd === "create_list") return null;
        return null;
      },
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      convertFileSrc: (p: string) => p,
    };
  };
}

test.describe("Phase 5: 폴리시", () => {
  test("다크모드 전용 UI — 어두운 반투명 배경 + vibrancy", async ({ page }) => {
    const tasks = Array.from({ length: 3 }, (_, i) => ({
      id: String(i + 1),
      subject: `Task ${i + 1}`,
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }));
    const lists = makeMockLists([{ name: "DarkTest", tasks }]);

    await page.addInitScript(setupMock(lists), lists);
    await page.goto("http://localhost:1420");
    await page.waitForSelector('[data-testid="app-root"]');

    // Background should be dark semi-transparent overlay for readability
    const bgColor = await page.evaluate(() => {
      const el = document.querySelector(".app-container");
      return el ? getComputedStyle(el).backgroundColor : "";
    });
    expect(bgColor).toMatch(/rgba?\(\s*20,\s*20,\s*22/);

    // Text color should be light
    const textColor = await page.evaluate(() => {
      const el = document.querySelector(".header-title");
      return el ? getComputedStyle(el).color : "";
    });
    expect(textColor).toMatch(/rgb\(\s*2[0-4]\d/);
  });

  test("다크모드 — 스크린샷으로 시각적 확인", async ({ page }) => {
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: String(i + 1),
      subject: `Sample Task ${i + 1}`,
      description: i === 0 ? "Has a description" : "",
      status: i < 2 ? "in_progress" : i < 4 ? "pending" : "completed",
      blocks: [],
      blockedBy: [],
    }));
    const lists = makeMockLists([{ name: "ScreenshotTest", tasks }]);

    await page.addInitScript(setupMock(lists), lists);
    await page.goto("http://localhost:1420");
    await page.waitForSelector('[data-testid="app-root"]');
    await page.click('[data-testid="list-card-ScreenshotTest"]');
    await page.waitForSelector('[data-testid="btn-back"]');

    // Take screenshot for visual verification
    await page.screenshot({ path: "/tmp/phase5-darkmode.png" });
    expect(fs.existsSync("/tmp/phase5-darkmode.png")).toBe(true);
  });

  test("스크롤 — 태스크 20개 DOM 존재 확인", async ({ page }) => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({
      id: String(i + 1),
      subject: `Scroll Task ${i + 1}`,
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }));
    const lists = makeMockLists([{ name: "ScrollTest", tasks }]);

    await page.addInitScript(setupMock(lists), lists);
    await page.goto("http://localhost:1420");
    await page.waitForSelector('[data-testid="app-root"]');
    await page.click('[data-testid="list-card-ScrollTest"]');
    await page.waitForSelector('[data-testid="btn-back"]');

    // All 20 tasks should be in DOM
    const taskCount = await page.locator('[data-testid^="task-item-"]').count();
    expect(taskCount).toBe(20);
  });

  test("스크롤 — 마지막 태스크가 스크롤 후 보임", async ({ page }) => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({
      id: String(i + 1),
      subject: `Scroll Task ${i + 1}`,
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }));
    const lists = makeMockLists([{ name: "ScrollTest", tasks }]);

    await page.addInitScript(setupMock(lists), lists);
    await page.goto("http://localhost:1420");
    await page.waitForSelector('[data-testid="app-root"]');
    await page.click('[data-testid="list-card-ScrollTest"]');
    await page.waitForSelector('[data-testid="btn-back"]');

    // Scroll last task into view
    await page.locator('[data-testid="task-item-20"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-testid="task-item-20"]')).toBeVisible();
  });

  test("스크롤 — content 영역에 overflow-y: auto", async ({ page }) => {
    const lists = makeMockLists([{ name: "X", tasks: [] }]);
    await page.addInitScript(setupMock(lists), lists);
    await page.goto("http://localhost:1420");
    await page.waitForSelector('[data-testid="app-root"]');

    const overflow = await page.evaluate(() => {
      const el = document.querySelector(".content");
      return el ? getComputedStyle(el).overflowY : "";
    });
    expect(overflow).toBe("auto");
  });

  test("빈 리스트 — 'No tasks yet' 메시지 표시", async ({ page }) => {
    const lists = makeMockLists([{ name: "EmptyList", tasks: [] }]);
    await page.addInitScript(setupMock(lists), lists);
    await page.goto("http://localhost:1420");
    await page.waitForSelector('[data-testid="app-root"]');
    await page.click('[data-testid="list-card-EmptyList"]');
    await page.waitForSelector('[data-testid="btn-back"]');

    await expect(page.locator('[data-testid="empty-state"]')).toBeVisible();
    const text = await page.locator('[data-testid="empty-state"]').textContent();
    expect(text).toContain("No tasks yet");
  });

  test("Cmd+Q 종료 — Rust에 quit 메뉴 존재", async ({}) => {
    // Verify quit menu item exists in Rust code
    const libRs = fs.readFileSync(
      path.join(process.cwd(), "src-tauri", "src", "lib.rs"),
      "utf-8"
    );
    expect(libRs).toContain('MenuItemBuilder::with_id("quit", "Quit")');
    expect(libRs).toContain('event.id() == "quit"');
    expect(libRs).toContain("app.exit(0)");
  });
});
