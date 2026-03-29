import { test, expect } from "@playwright/test";

function setupMock(listsData: any[]) {
  return (listsData: any[]) => {
    (window as any).__e2e_invokes__ = [];
    let currentLists = JSON.parse(JSON.stringify(listsData));

    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
        (window as any).__e2e_invokes__.push({ cmd, args });
        if (cmd === "get_task_lists") return currentLists;
        if (cmd === "get_config") return { terminal: "terminal" };
        if (cmd === "update_task_status") {
          for (const list of currentLists) {
            const task = list.tasks.find((t: any) => t.id === args?.taskId);
            if (task) {
              task.status = args?.newStatus;
              list.completed = list.tasks.filter((t: any) => t.status === "completed").length;
            }
          }
          return null;
        }
        if (cmd === "update_task_subject") {
          for (const list of currentLists) {
            const task = list.tasks.find((t: any) => t.id === args?.taskId);
            if (task) task.subject = args?.newSubject;
          }
          return null;
        }
        if (cmd === "spawn_list") return null;
        if (cmd === "spawn_task") return null;
        if (cmd === "hide_window") return null;
        if (cmd === "set_terminal") return "ok";
        return null;
      },
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      convertFileSrc: (p: string) => p,
    };
  };
}

function makeLists(lists: { name: string; tasks: any[] }[]) {
  return lists.map((l) => ({
    ...l,
    total: l.tasks.length,
    completed: l.tasks.filter((t: any) => t.status === "completed").length,
    last_updated: Date.now(),
    project_dir: null,
  }));
}

const NAMED_LISTS = makeLists([
  {
    name: "Alpha",
    tasks: [
      { id: "1", subject: "Task A1", description: "desc", status: "in_progress", blocks: [], blockedBy: [] },
      { id: "2", subject: "Task A2", description: "", status: "pending", blocks: [], blockedBy: [] },
    ],
  },
  {
    name: "Beta",
    tasks: [
      { id: "1", subject: "Task B1", description: "", status: "pending", blocks: [], blockedBy: [] },
    ],
  },
  {
    name: "Gamma",
    tasks: [],
  },
]);

async function initPage(page: any, lists = NAMED_LISTS) {
  await page.addInitScript(setupMock(lists), lists);
  await page.goto("http://localhost:1420");
  await page.waitForSelector('[data-testid="app-root"]');
  await page.waitForTimeout(300);
}

function getInvokes(page: any) {
  return page.evaluate(() => (window as any).__e2e_invokes__);
}

test.describe("Keyboard Navigation", () => {
  test.describe("List Screen", () => {
    test("Arrow Down/Up navigates between lists with visual selection", async ({ page }) => {
      await initPage(page);

      // First item should be selected by default
      const firstCard = page.locator('[data-testid="list-card-Alpha"]');
      await expect(firstCard).toHaveClass(/focused/);

      // Arrow Down → second item
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(100);
      const secondCard = page.locator('[data-testid="list-card-Beta"]');
      await expect(secondCard).toHaveClass(/focused/);
      await expect(firstCard).not.toHaveClass(/focused/);

      // Arrow Down → third item
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(100);
      const thirdCard = page.locator('[data-testid="list-card-Gamma"]');
      await expect(thirdCard).toHaveClass(/focused/);

      // Arrow Down wraps to first
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(100);
      await expect(firstCard).toHaveClass(/focused/);

      // Arrow Up wraps to last
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(100);
      await expect(thirdCard).toHaveClass(/focused/);
    });

    test("Enter enters selected TaskList", async ({ page }) => {
      await initPage(page);

      // Navigate to Beta
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(100);

      // Enter to enter
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);

      // Should now be on tasklist screen with Beta's tasks
      await expect(page.locator('[data-testid="btn-back"]')).toBeVisible();
      await expect(page.locator('[data-testid="task-text-1"]')).toContainText("Task B1");
    });

    test("Enter enters empty TaskList", async ({ page }) => {
      await initPage(page);

      // Navigate to Gamma (empty)
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(100);

      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);

      // Should be on tasklist screen with empty state
      await expect(page.locator('[data-testid="btn-back"]')).toBeVisible();
      await expect(page.locator('[data-testid="empty-state"]')).toBeVisible();
    });

    test("Meta+Enter spawns selected list and calls hide_window", async ({ page }) => {
      await initPage(page);

      await page.keyboard.press("Meta+Enter");
      await page.waitForTimeout(300);

      const invokes = await getInvokes(page);
      const spawnCall = invokes.find((i: any) => i.cmd === "spawn_list");
      expect(spawnCall).toBeTruthy();
      expect(spawnCall.args.listName).toBe("Alpha");

      const hideCall = invokes.find((i: any) => i.cmd === "hide_window");
      expect(hideCall).toBeTruthy();
    });

    test("Tab switches between Named and Unnamed tabs", async ({ page }) => {
      await initPage(page);

      // Initially on Named tab
      const namedTab = page.locator('[data-testid="tab-named"]');
      await expect(namedTab).toHaveClass(/tab-active/);

      // Tab to switch to Unnamed
      await page.keyboard.press("Tab");
      await page.waitForTimeout(200);
      const unnamedTab = page.locator('[data-testid="tab-unnamed"]');
      await expect(unnamedTab).toHaveClass(/tab-active/);

      // Tab again to switch back to Named
      await page.keyboard.press("Tab");
      await page.waitForTimeout(200);
      await expect(namedTab).toHaveClass(/tab-active/);
    });

    test("Escape calls hide_window", async ({ page }) => {
      await initPage(page);

      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);

      const invokes = await getInvokes(page);
      const hideCall = invokes.find((i: any) => i.cmd === "hide_window");
      expect(hideCall).toBeTruthy();
    });
  });

  test.describe("Task Screen", () => {
    async function enterAlpha(page: any) {
      await initPage(page);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      await expect(page.locator('[data-testid="btn-back"]')).toBeVisible();
    }

    test("Arrow Down/Up navigates between tasks with wrapping", async ({ page }) => {
      await enterAlpha(page);

      // First task should be selected
      const task1 = page.locator('[data-testid="task-item-1"]');
      await expect(task1).toHaveClass(/focused/);

      // Arrow Down → second task
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(100);
      const task2 = page.locator('[data-testid="task-item-2"]');
      await expect(task2).toHaveClass(/focused/);
      await expect(task1).not.toHaveClass(/focused/);

      // Arrow Down wraps to first
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(100);
      await expect(task1).toHaveClass(/focused/);

      // Arrow Up wraps to last
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(100);
      await expect(task2).toHaveClass(/focused/);
    });

    test("Enter spawns selected task and calls hide_window", async ({ page }) => {
      await enterAlpha(page);

      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);

      const invokes = await getInvokes(page);
      const spawnCall = invokes.find((i: any) => i.cmd === "spawn_task");
      expect(spawnCall).toBeTruthy();
      expect(spawnCall.args.taskId).toBe("1");

      const hideCall = invokes.find((i: any) => i.cmd === "hide_window");
      expect(hideCall).toBeTruthy();
    });

    test("F2 opens inline edit, Enter confirms, subject is updated", async ({ page }) => {
      await enterAlpha(page);

      // F2 to edit first task
      await page.keyboard.press("F2");
      await page.waitForTimeout(200);

      // Input should appear with current subject
      const editInput = page.locator('[data-testid="task-edit-1"]');
      await expect(editInput).toBeVisible();
      await expect(editInput).toHaveValue("Task A1");

      // Type new subject and confirm
      await editInput.fill("Updated A1");
      await page.evaluate(() => {
        const input = document.querySelector('[data-testid="task-edit-1"]') as HTMLInputElement;
        if (input) {
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
      });
      await page.waitForTimeout(500);

      // Check invoke was called
      const invokes = await getInvokes(page);
      const updateCall = invokes.find((i: any) => i.cmd === "update_task_subject");
      expect(updateCall).toBeTruthy();
      expect(updateCall.args.newSubject).toBe("Updated A1");

      // Verify editing ended
      await expect(page.locator('[data-testid="task-text-1"]')).toBeVisible();
    });

    test("F2 opens inline edit, Escape cancels without saving", async ({ page }) => {
      await enterAlpha(page);

      await page.keyboard.press("F2");
      await page.waitForTimeout(200);

      const editInput = page.locator('[data-testid="task-edit-1"]');
      await expect(editInput).toBeVisible();

      // Type something then escape
      await editInput.fill("Should not save");
      await editInput.press("Escape");
      await page.waitForTimeout(200);

      // Input should be gone, no update call
      await expect(editInput).not.toBeVisible();
      const invokes = await getInvokes(page);
      const updateCall = invokes.find((i: any) => i.cmd === "update_task_subject");
      expect(updateCall).toBeFalsy();
    });

    test("Escape returns to list screen", async ({ page }) => {
      await enterAlpha(page);

      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);

      // Should be back on list screen
      await expect(page.locator('[data-testid="tab-named"]')).toBeVisible();
      await expect(page.locator('[data-testid="list-card-Alpha"]')).toBeVisible();
    });

    test("Tooltip appears after 1s dwell on focused task", async ({ page }) => {
      await enterAlpha(page);

      // First task (Task A1) has description "desc"
      // Wait 1.2s for tooltip to appear
      await page.waitForTimeout(1200);

      const tooltip = page.locator('[data-testid="task-tooltip-1"]');
      await expect(tooltip).toBeVisible();

      // Move to next task — tooltip should dismiss
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(200);
      await expect(tooltip).not.toBeVisible();
    });
  });

  test.describe("Unified Focus", () => {
    test("Mouse hover updates focused state", async ({ page }) => {
      await initPage(page);

      // Hover over Beta (second card)
      await page.hover('[data-testid="list-card-Beta"]');
      await page.waitForTimeout(100);

      // Beta should be focused
      await expect(page.locator('[data-testid="list-card-Beta"]')).toHaveClass(/focused/);
      // Alpha should not be focused
      await expect(page.locator('[data-testid="list-card-Alpha"]')).not.toHaveClass(/focused/);
    });

    test("Keyboard overrides mouse focus", async ({ page }) => {
      await initPage(page);

      // Hover over Beta
      await page.hover('[data-testid="list-card-Beta"]');
      await page.waitForTimeout(100);
      await expect(page.locator('[data-testid="list-card-Beta"]')).toHaveClass(/focused/);

      // Press ArrowDown — should move focus to next from wherever keyboard thinks it is
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(100);

      // Focus should have moved via keyboard
      const alphaFocused = await page.locator('[data-testid="list-card-Alpha"]').evaluate(
        (el) => el.classList.contains("focused")
      );
      const betaFocused = await page.locator('[data-testid="list-card-Beta"]').evaluate(
        (el) => el.classList.contains("focused")
      );
      const gammaFocused = await page.locator('[data-testid="list-card-Gamma"]').evaluate(
        (el) => el.classList.contains("focused")
      );
      // Exactly one should be focused
      const focusedCount = [alphaFocused, betaFocused, gammaFocused].filter(Boolean).length;
      expect(focusedCount).toBe(1);
    });
  });

  test.describe("Auto Scroll", () => {
    test("Arrow navigation scrolls focused item into view", async ({ page }) => {
      // Create a list with many tasks to force scrolling
      const manyTasks = Array.from({ length: 20 }, (_, i) => ({
        id: String(i + 1),
        subject: `Task ${i + 1}`,
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
      }));
      const scrollLists = makeLists([
        { name: "ScrollTest", tasks: manyTasks },
      ]);

      await page.addInitScript(setupMock(scrollLists), scrollLists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');
      await page.waitForTimeout(300);

      // Enter the list
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);

      // Navigate down many times to go past visible area
      for (let i = 0; i < 15; i++) {
        await page.keyboard.press("ArrowDown");
        await page.waitForTimeout(50);
      }
      await page.waitForTimeout(200);

      // The focused task (task 16) should be visible in viewport
      const task16 = page.locator('[data-testid="task-item-16"]');
      await expect(task16).toHaveClass(/focused/);
      const isVisible = await task16.isVisible();
      expect(isVisible).toBe(true);
    });
  });
});
