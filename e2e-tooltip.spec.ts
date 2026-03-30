import { test, expect } from "@playwright/test";

function makeLists() {
  return [
    {
      name: "TestList",
      tasks: [
        { id: "1", subject: "Task A", description: "Description of A", status: "in_progress", blocks: [], blockedBy: [] },
        { id: "2", subject: "Task B", description: "Description of B", status: "pending", blocks: [], blockedBy: [] },
        { id: "3", subject: "Task C", description: "", status: "completed", blocks: [], blockedBy: [] },
      ],
      total: 3,
      completed: 1,
      lastUpdated: Date.now(),
      projectDir: null,
    },
    {
      name: "SecondList",
      tasks: [
        { id: "1", subject: "S1", description: "", status: "pending", blocks: [], blockedBy: [] },
        { id: "2", subject: "S2", description: "", status: "in_progress", blocks: [], blockedBy: [] },
      ],
      total: 2,
      completed: 0,
      lastUpdated: Date.now(),
      projectDir: null,
    },
  ];
}

async function initPage(page: any) {
  const lists = makeLists();
  await page.addInitScript((listsData: any) => {
    (window as any).__e2e_invokes__ = [];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
        (window as any).__e2e_invokes__.push({ cmd, args });
        if (cmd === "get_task_lists") return listsData;
        if (cmd === "get_config") return { terminal: "terminal" };
        if (cmd === "show_tooltip") return null;
        if (cmd === "hide_tooltip") return null;
        if (cmd === "hide_window") return null;
        if (cmd === "update_task_status") return null;
        return null;
      },
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      convertFileSrc: (p: string) => p,
    };
  }, lists);
  await page.goto("http://localhost:1420");
  await page.waitForSelector('[data-testid="app-root"]');
  await page.waitForTimeout(300);
}

function getInvokes(page: any) {
  return page.evaluate(() => (window as any).__e2e_invokes__);
}

function clearInvokes(page: any) {
  return page.evaluate(() => { (window as any).__e2e_invokes__ = []; });
}

test.describe("Tooltip Secondary Window", () => {
  test.describe("Task Description Tooltip", () => {
    test("hover on task with description invokes show_tooltip after delay", async ({ page }) => {
      await initPage(page);

      // Enter TestList
      await page.click('[data-testid="list-card-TestList"]');
      await page.waitForSelector('[data-testid="btn-back"]');
      await clearInvokes(page);

      // Hover on task with description
      await page.hover('[data-testid="task-text-1"]');
      await page.waitForTimeout(500);

      const invokes = await getInvokes(page);
      const showCalls = invokes.filter((i: any) => i.cmd === "show_tooltip" && i.args?.payload?.type === "text");
      expect(showCalls.length).toBeGreaterThan(0);
      const call = showCalls[showCalls.length - 1];
      expect(call.args.payload.text).toBe("Description of A");
      expect(call.args.itemY).toBeDefined();
    });

    test("hover on task without description does NOT invoke show_tooltip", async ({ page }) => {
      await initPage(page);

      await page.click('[data-testid="list-card-TestList"]');
      await page.waitForSelector('[data-testid="btn-back"]');
      await clearInvokes(page);

      // Task 3 has empty description
      await page.hover('[data-testid="task-text-3"]');
      await page.waitForTimeout(500);

      const invokes = await getInvokes(page);
      const showCalls = invokes.filter((i: any) => i.cmd === "show_tooltip" && i.args?.payload?.type === "text");
      expect(showCalls.length).toBe(0);
    });

    test("mouse leave invokes hide_tooltip", async ({ page }) => {
      await initPage(page);

      await page.click('[data-testid="list-card-TestList"]');
      await page.waitForSelector('[data-testid="btn-back"]');

      // Hover then leave
      await page.hover('[data-testid="task-text-1"]');
      await page.waitForTimeout(500);
      await clearInvokes(page);

      // Move mouse away
      await page.hover('[data-testid="btn-back"]');
      await page.waitForTimeout(100);

      const invokes = await getInvokes(page);
      const hideCall = invokes.find((i: any) => i.cmd === "hide_tooltip");
      expect(hideCall).toBeTruthy();
    });
  });

  test.describe("List Preview Tooltip", () => {
    test("hover on list card invokes show_tooltip with list payload", async ({ page }) => {
      await initPage(page);
      await clearInvokes(page);

      await page.hover('[data-testid="list-card-TestList"]');
      await page.waitForTimeout(500);

      const invokes = await getInvokes(page);
      const showCalls = invokes.filter((i: any) => i.cmd === "show_tooltip" && i.args?.payload?.type === "list");
      expect(showCalls.length).toBeGreaterThan(0);
      const call = showCalls[showCalls.length - 1];
      expect(call.args.payload.items.length).toBe(3);
      expect(call.args.payload.moreCount).toBe(0);
    });

    test("quick move between cards always waits 400ms delay", async ({ page }) => {
      await initPage(page);

      // First hover to trigger tooltip
      await page.hover('[data-testid="list-card-TestList"]');
      await page.waitForTimeout(500);
      await clearInvokes(page);

      // Quick move to second card — should NOT show instantly, needs 400ms
      await page.hover('[data-testid="list-card-SecondList"]');
      await page.waitForTimeout(200); // Less than 400ms — should NOT have fired yet

      let invokes = await getInvokes(page);
      let showCalls = invokes.filter((i: any) => i.cmd === "show_tooltip" && i.args?.payload?.type === "list");
      expect(showCalls.length).toBe(0); // No show yet

      // Wait remaining delay
      await page.waitForTimeout(300); // Total ~500ms > 400ms

      invokes = await getInvokes(page);
      showCalls = invokes.filter((i: any) => i.cmd === "show_tooltip" && i.args?.payload?.type === "list");
      expect(showCalls.length).toBeGreaterThan(0);
      const call = showCalls[showCalls.length - 1];
      expect(call.args.payload.items.length).toBe(2); // SecondList has 2 tasks
    });
  });

  test.describe("Keyboard Dwell", () => {
    test("1s keyboard dwell invokes show_tooltip for task", async ({ page }) => {
      await initPage(page);

      // Enter TestList
      await page.click('[data-testid="list-card-TestList"]');
      await page.waitForSelector('[data-testid="btn-back"]');
      await clearInvokes(page);

      // Wait 1.2s for dwell tooltip
      await page.waitForTimeout(1200);

      const invokes = await getInvokes(page);
      const showCalls = invokes.filter((i: any) => i.cmd === "show_tooltip" && i.args?.payload?.type === "text");
      expect(showCalls.length).toBeGreaterThan(0);
      expect(showCalls[0].args.payload.text).toBe("Description of A");
    });

    test("keyboard move dismisses tooltip", async ({ page }) => {
      await initPage(page);

      await page.click('[data-testid="list-card-TestList"]');
      await page.waitForSelector('[data-testid="btn-back"]');
      await page.waitForTimeout(1200); // Wait for dwell tooltip
      await clearInvokes(page);

      // Move to next task
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(200);

      const invokes = await getInvokes(page);
      const hideCall = invokes.find((i: any) => i.cmd === "hide_tooltip");
      expect(hideCall).toBeTruthy();
    });
  });
});
