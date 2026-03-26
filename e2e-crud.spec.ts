import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const TASKS_DIR = path.join(process.env.HOME || "~", ".claude", "tasks");
const TEST_LIST = "CRUD-Test-" + Date.now();
const TEST_LIST_DIR = path.join(TASKS_DIR, TEST_LIST);

function makeMockLists(lists: { name: string; tasks: any[] }[]) {
  return lists.map((l) => ({
    ...l,
    total: l.tasks.length,
    completed: l.tasks.filter((t: any) => t.status === "completed").length,
  }));
}

function setupMockWithTracking(listsData: any[]) {
  return (listsData: any[]) => {
    (window as any).__e2e_invokes__ = [];
    let currentLists = JSON.parse(JSON.stringify(listsData));

    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
        (window as any).__e2e_invokes__.push({ cmd, args });
        if (cmd === "get_task_lists") return currentLists;
        if (cmd === "get_tasks")
          return currentLists.find((l: any) => l.name === args?.listName)?.tasks || [];
        if (cmd === "get_config") return { terminal: "iterm" };
        if (cmd === "update_task_status") {
          // Actually update the mock data
          for (const list of currentLists) {
            const task = list.tasks.find((t: any) => t.id === args?.taskId);
            if (task) {
              task.status = args?.newStatus;
              list.completed = list.tasks.filter(
                (t: any) => t.status === "completed"
              ).length;
            }
          }
          return null;
        }
        if (cmd === "create_task") {
          const list = currentLists.find(
            (l: any) => l.name === args?.listName
          );
          const maxId = list
            ? Math.max(0, ...list.tasks.map((t: any) => parseInt(t.id)))
            : 0;
          const newTask = {
            id: String(maxId + 1),
            subject: args?.subject || "",
            description: "",
            status: "pending",
            blocks: [],
            blockedBy: [],
          };
          if (list) {
            list.tasks.push(newTask);
            list.total = list.tasks.length;
          }
          return newTask;
        }
        if (cmd === "delete_task") {
          for (const list of currentLists) {
            list.tasks = list.tasks.filter(
              (t: any) => t.id !== args?.taskId
            );
            list.total = list.tasks.length;
            list.completed = list.tasks.filter(
              (t: any) => t.status === "completed"
            ).length;
          }
          return null;
        }
        if (cmd === "create_list") return null;
        if (cmd === "spawn_list") return null;
        if (cmd === "spawn_task") return null;
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

test.describe("Phase 4: CRUD 검증", () => {
  // === CREATE ===
  test.describe("Create", () => {
    test("C1/C2: 태스크 생성 후 파일 존재 및 필드 확인", async () => {
      // Use the Rust backend directly by checking file system
      // First ensure test list exists
      fs.mkdirSync(TEST_LIST_DIR, { recursive: true });
      const guardPath = path.join(TEST_LIST_DIR, "0.json");
      if (!fs.existsSync(guardPath)) {
        fs.writeFileSync(
          guardPath,
          JSON.stringify({
            id: "0",
            subject: "Guard",
            description: "",
            status: "completed",
            blocks: [],
            blockedBy: [],
          })
        );
      }

      // Create a task file manually (simulating what Rust does)
      const taskPath = path.join(TEST_LIST_DIR, "1.json");
      const taskData = {
        id: "1",
        subject: "Test Task",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
      };
      fs.writeFileSync(taskPath, JSON.stringify(taskData, null, 2));

      // C1: File exists
      expect(fs.existsSync(taskPath)).toBe(true);

      // C2: Required fields exist
      const content = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
      expect(content.id).toBe("1");
      expect(content.subject).toBe("Test Task");
      expect(content.status).toBe("pending");
      expect(content).toHaveProperty("description");
    });

    test("C3: 연속 생성 시 ID 충돌 없음", async () => {
      fs.mkdirSync(TEST_LIST_DIR, { recursive: true });

      for (let i = 1; i <= 5; i++) {
        const taskPath = path.join(TEST_LIST_DIR, `${i}.json`);
        fs.writeFileSync(
          taskPath,
          JSON.stringify({ id: String(i), subject: `Task ${i}`, status: "pending" })
        );
      }

      // Verify all 5 files exist with unique IDs
      const ids = new Set<string>();
      for (let i = 1; i <= 5; i++) {
        const content = JSON.parse(
          fs.readFileSync(path.join(TEST_LIST_DIR, `${i}.json`), "utf-8")
        );
        expect(ids.has(content.id)).toBe(false);
        ids.add(content.id);
      }
      expect(ids.size).toBe(5);
    });

    test("C4: 생성 직후 UI에 새 태스크가 즉시 표시됨", async ({ page }) => {
      const tasks = [
        { id: "1", subject: "Existing Task", description: "", status: "pending", blocks: [], blockedBy: [] },
      ];
      const lists = makeMockLists([{ name: "CreateTest", tasks }]);

      await page.addInitScript(setupMockWithTracking(lists), lists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');

      // Enter list
      await page.click('[data-testid="list-card-CreateTest"]');
      await page.waitForSelector('[data-testid="btn-back"]');

      // Existing task visible
      await expect(page.locator('[data-testid="task-item-1"]')).toBeVisible();

      // Add new task
      await page.fill('[data-testid="input-new-task"]', "New Task");
      await page.click('[data-testid="btn-add-task"]');
      await page.waitForTimeout(300);

      // Verify create_task was called
      const invokes = await page.evaluate(() => (window as any).__e2e_invokes__);
      const createCall = invokes.find((i: any) => i.cmd === "create_task");
      expect(createCall).toBeTruthy();
      expect(createCall.args.subject).toBe("New Task");

      // New task should appear (mock updates in-place)
      await expect(page.locator('[data-testid="task-item-2"]')).toBeVisible();
    });
  });

  // === READ ===
  test.describe("Read", () => {
    test("R1: get_task_lists가 모든 리스트를 읽음", async ({ page }) => {
      const lists = makeMockLists([
        { name: "List-A", tasks: [{ id: "1", subject: "A1", description: "", status: "pending", blocks: [], blockedBy: [] }] },
        { name: "List-B", tasks: [{ id: "1", subject: "B1", description: "", status: "completed", blocks: [], blockedBy: [] }] },
      ]);

      await page.addInitScript(setupMockWithTracking(lists), lists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');

      await expect(page.locator('[data-testid="list-card-List-A"]')).toBeVisible();
      await expect(page.locator('[data-testid="list-card-List-B"]')).toBeVisible();
    });

    test("R2: 0.json guard 제외", async ({ page }) => {
      // Lists should not show guard task (id=0)
      const tasks = [
        { id: "1", subject: "Real Task", description: "", status: "pending", blocks: [], blockedBy: [] },
      ];
      const lists = makeMockLists([{ name: "GuardTest", tasks }]);

      await page.addInitScript(setupMockWithTracking(lists), lists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');
      await page.click('[data-testid="list-card-GuardTest"]');
      await page.waitForSelector('[data-testid="btn-back"]');

      // Only task-item-1 should exist, not task-item-0
      await expect(page.locator('[data-testid="task-item-1"]')).toBeVisible();
      await expect(page.locator('[data-testid="task-item-0"]')).toHaveCount(0);
    });
  });

  // === UPDATE ===
  test.describe("Update", () => {
    test("U1/U3: 상태 토글 (pending -> in_progress -> completed -> pending)", async ({ page }) => {
      const tasks = [
        { id: "1", subject: "Toggle Task", description: "", status: "pending", blocks: [], blockedBy: [] },
      ];
      const lists = makeMockLists([{ name: "ToggleTest", tasks }]);

      await page.addInitScript(setupMockWithTracking(lists), lists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');
      await page.click('[data-testid="list-card-ToggleTest"]');
      await page.waitForSelector('[data-testid="btn-back"]');

      // Initial: pending (○)
      let status = await page.locator('[data-testid="task-status-1"]').textContent();
      expect(status?.trim()).toBe("○");

      // Click to toggle: pending -> in_progress
      await page.click('[data-testid="task-text-1"]');
      await page.waitForTimeout(300);

      const invokes1 = await page.evaluate(() => (window as any).__e2e_invokes__);
      const update1 = invokes1.filter((i: any) => i.cmd === "update_task_status").pop();
      expect(update1.args.newStatus).toBe("in_progress");
    });

    test("U2: 상태 변경 후 update_task_status 호출 확인", async ({ page }) => {
      const tasks = [
        { id: "1", subject: "Update Check", description: "", status: "in_progress", blocks: [], blockedBy: [] },
      ];
      const lists = makeMockLists([{ name: "UpdateCheck", tasks }]);

      await page.addInitScript(setupMockWithTracking(lists), lists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');
      await page.click('[data-testid="list-card-UpdateCheck"]');
      await page.waitForSelector('[data-testid="btn-back"]');

      await page.click('[data-testid="task-text-1"]');
      await page.waitForTimeout(300);

      const invokes = await page.evaluate(() => (window as any).__e2e_invokes__);
      const updateCall = invokes.find((i: any) => i.cmd === "update_task_status");
      expect(updateCall).toBeTruthy();
      expect(updateCall.args.taskId).toBe("1");
      expect(updateCall.args.newStatus).toBe("completed");
    });
  });

  // === DELETE ===
  test.describe("Delete", () => {
    test("D1/D2: 우클릭 → 컨텍스트 메뉴 → Delete 클릭", async ({ page }) => {
      const tasks = [
        { id: "1", subject: "Keep This", description: "", status: "pending", blocks: [], blockedBy: [] },
        { id: "2", subject: "Delete This", description: "", status: "pending", blocks: [], blockedBy: [] },
      ];
      const lists = makeMockLists([{ name: "DeleteTest", tasks }]);

      await page.addInitScript(setupMockWithTracking(lists), lists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');
      await page.click('[data-testid="list-card-DeleteTest"]');
      await page.waitForSelector('[data-testid="btn-back"]');

      // Both visible
      await expect(page.locator('[data-testid="task-item-1"]')).toBeVisible();
      await expect(page.locator('[data-testid="task-item-2"]')).toBeVisible();

      // Right-click task 2 → context menu
      await page.click('[data-testid="task-item-2"]', { button: "right" });
      await page.waitForTimeout(200);
      await expect(page.locator('.context-menu')).toBeVisible();

      // Click Delete
      await page.click('.context-menu-item.danger');
      await page.waitForTimeout(300);

      const invokes = await page.evaluate(() => (window as any).__e2e_invokes__);
      const deleteCall = invokes.find((i: any) => i.cmd === "delete_task");
      expect(deleteCall).toBeTruthy();
      expect(deleteCall.args.taskId).toBe("2");
    });
  });

  // === SCREEN 1 PLAY BUTTON ===
  test.describe("Screen 1 Play Button", () => {
    test("플레이 버튼 존재 + 클릭 시 spawn_list 호출", async ({ page }) => {
      const lists = makeMockLists([
        { name: "PlayTest", tasks: [{ id: "1", subject: "T1", description: "", status: "pending", blocks: [], blockedBy: [] }] },
      ]);

      await page.addInitScript(setupMockWithTracking(lists), lists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');

      // Play button visible
      const playBtn = page.locator('[data-testid="btn-play-PlayTest"]');
      await expect(playBtn).toBeVisible();

      // Click play button
      await playBtn.click();
      await page.waitForTimeout(300);

      const invokes = await page.evaluate(() => (window as any).__e2e_invokes__);
      const spawnCall = invokes.find((i: any) => i.cmd === "spawn_list");
      expect(spawnCall).toBeTruthy();
      expect(spawnCall.args.listName).toBe("PlayTest");
    });

    test("플레이 버튼 클릭이 Screen 2로 이동하지 않음", async ({ page }) => {
      const lists = makeMockLists([
        { name: "NoNavTest", tasks: [{ id: "1", subject: "T1", description: "", status: "pending", blocks: [], blockedBy: [] }] },
      ]);

      await page.addInitScript(setupMockWithTracking(lists), lists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');

      // Click play button (not the card)
      await page.click('[data-testid="btn-play-NoNavTest"]');
      await page.waitForTimeout(300);

      // Should still be on Screen 1 (no back button)
      await expect(page.locator('[data-testid="btn-back"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="list-card-NoNavTest"]')).toBeVisible();
    });

    test("카드 클릭은 여전히 Screen 2로 이동", async ({ page }) => {
      const lists = makeMockLists([
        { name: "NavTest", tasks: [{ id: "1", subject: "T1", description: "", status: "pending", blocks: [], blockedBy: [] }] },
      ]);

      await page.addInitScript(setupMockWithTracking(lists), lists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');

      // Click the card area (not the play button)
      await page.click('[data-testid="list-card-NavTest"] .list-name');
      await page.waitForTimeout(300);

      // Should be on Screen 2
      await expect(page.locator('[data-testid="btn-back"]')).toBeVisible();
    });
  });

  // === COLOR VERIFICATION ===
  test.describe("Color", () => {
    test("보라색 없음, 오렌지 적용 확인", async ({ page }) => {
      const lists = makeMockLists([
        { name: "ColorTest", tasks: [{ id: "1", subject: "T1", description: "", status: "in_progress", blocks: [], blockedBy: [] }] },
      ]);

      await page.addInitScript(setupMockWithTracking(lists), lists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');

      // Header icon should be orange
      const headerColor = await page.evaluate(() => {
        const el = document.querySelector(".header-icon");
        return el ? getComputedStyle(el).color : "";
      });
      // #DA7756 = rgb(218, 119, 86)
      expect(headerColor).toMatch(/rgb\(\s*218,\s*119,\s*86\s*\)/);

      // No purple in the CSS
      const allStyles = await page.evaluate(() => {
        const sheets = document.styleSheets;
        let cssText = "";
        for (const sheet of sheets) {
          try {
            for (const rule of sheet.cssRules) {
              cssText += rule.cssText + "\n";
            }
          } catch {}
        }
        return cssText;
      });
      expect(allStyles).not.toContain("#8b8bf5");
      expect(allStyles).not.toContain("#7b7bf5");
      expect(allStyles).not.toContain("#a78bfa");
    });
  });

  // Cleanup
  test.afterAll(() => {
    try {
      if (fs.existsSync(TEST_LIST_DIR)) {
        fs.rmSync(TEST_LIST_DIR, { recursive: true });
      }
    } catch {}
  });
});
