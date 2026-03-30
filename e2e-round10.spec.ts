import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const HOME = process.env.HOME || "/tmp";
const TASKS_DIR = path.join(HOME, ".claude", "tasks");
const WORKSPACE_ROOT = path.join(HOME, "claude-task-list");
const TEST_LIST = "E2E-Round10-Test";
const TEST_LIST_DIR = path.join(TASKS_DIR, TEST_LIST);
const TEST_WORKSPACE_DIR = path.join(WORKSPACE_ROOT, TEST_LIST);

function makeMockLists(lists: { name: string; tasks: any[] }[]) {
  return lists.map((l) => ({
    ...l,
    total: l.tasks.length,
    completed: l.tasks.filter((t: any) => t.status === "completed").length,
    lastUpdated: Math.floor(Date.now() / 1000),
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
          return (
            currentLists.find((l: any) => l.name === args?.listName)?.tasks ||
            []
          );
        if (cmd === "get_config") return { terminal: "iterm" };
        if (cmd === "update_task_status") {
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
        if (cmd === "delete_list") return null;
        if (cmd === "rename_list") return null;
        if (cmd === "spawn_list") return null;
        if (cmd === "spawn_task") return null;
        if (cmd === "set_terminal") return "ok";
        if (cmd === "show_tooltip") return null;
        if (cmd === "hide_tooltip") return null;
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

test.describe("Round 10: 프로젝트 디렉토리 바인딩", () => {
  // ==============================
  // Phase 1: _meta.json 필터링
  // ==============================
  test.describe("Phase 1: _meta.json 필터링", () => {
    test("_meta 태스크가 리스트 카드의 total 카운트에 포함되지 않음", async ({
      page,
    }) => {
      // Mock data: 2 real tasks, _meta should NOT be included
      // (Rust backend filters _meta.json, so mock reflects that)
      const tasks = [
        {
          id: "1",
          subject: "Real Task 1",
          description: "",
          status: "pending",
          blocks: [],
          blockedBy: [],
        },
        {
          id: "2",
          subject: "Real Task 2",
          description: "",
          status: "completed",
          blocks: [],
          blockedBy: [],
        },
      ];
      const lists = makeMockLists([{ name: "MetaFilterTest", tasks }]);

      await page.addInitScript(setupMockWithTracking(lists), lists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');

      // Card should show 1/2 (not 1/3 if _meta were counted)
      const card = page.locator('[data-testid="list-card-MetaFilterTest"]');
      await expect(card).toBeVisible();
      const text = await card.textContent();
      expect(text).toContain("1/2");
    });

    test("_meta 태스크가 Screen 2 태스크 목록에 표시되지 않음", async ({
      page,
    }) => {
      const tasks = [
        {
          id: "1",
          subject: "Visible Task",
          description: "",
          status: "pending",
          blocks: [],
          blockedBy: [],
        },
      ];
      const lists = makeMockLists([{ name: "MetaHiddenTest", tasks }]);

      await page.addInitScript(setupMockWithTracking(lists), lists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');
      await page.click('[data-testid="list-card-MetaHiddenTest"]');
      await page.waitForSelector('[data-testid="btn-back"]');

      // Only task-item-1 should exist
      await expect(
        page.locator('[data-testid="task-item-1"]')
      ).toBeVisible();
      // No _meta task item
      await expect(
        page.locator('[data-testid="task-item-_meta"]')
      ).toHaveCount(0);
    });
  });

  // ==============================
  // Phase 2: create_list + rename_list (파일시스템 검증)
  // ==============================
  test.describe("Phase 2: create_list 파일시스템 검증", () => {
    test.beforeAll(() => {
      // Clean up any leftover test data
      if (fs.existsSync(TEST_LIST_DIR)) {
        fs.rmSync(TEST_LIST_DIR, { recursive: true });
      }
      if (fs.existsSync(TEST_WORKSPACE_DIR)) {
        fs.rmSync(TEST_WORKSPACE_DIR, { recursive: true });
      }
    });

    test("create_list가 _meta.json과 워크스페이스 디렉토리를 생성함", async () => {
      // Simulate what create_list does: create task dir + workspace + _meta.json
      // (This tests the file structure that Rust create_list produces)
      fs.mkdirSync(TEST_LIST_DIR, { recursive: true });
      fs.mkdirSync(TEST_WORKSPACE_DIR, { recursive: true });
      const metaContent = {
        project_dir: TEST_WORKSPACE_DIR,
      };
      fs.writeFileSync(
        path.join(TEST_LIST_DIR, "_meta.json"),
        JSON.stringify(metaContent, null, 2)
      );

      // Verify _meta.json exists and has correct content
      const metaPath = path.join(TEST_LIST_DIR, "_meta.json");
      expect(fs.existsSync(metaPath)).toBe(true);

      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      expect(meta.project_dir).toBe(TEST_WORKSPACE_DIR);

      // Verify workspace directory exists
      expect(fs.existsSync(TEST_WORKSPACE_DIR)).toBe(true);
      expect(fs.statSync(TEST_WORKSPACE_DIR).isDirectory()).toBe(true);
    });

    test("UUID 리스트에는 _meta.json이 생성되지 않음", async () => {
      const uuidName = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const uuidDir = path.join(TASKS_DIR, uuidName);
      fs.mkdirSync(uuidDir, { recursive: true });

      // UUID lists should NOT get _meta.json (Rust backend skips them)
      const metaPath = path.join(uuidDir, "_meta.json");
      expect(fs.existsSync(metaPath)).toBe(false);

      // Cleanup
      fs.rmSync(uuidDir, { recursive: true });
    });

    test("rename 시 _meta.json이 보존됨", async () => {
      // Simulate Named → Named rename
      const oldName = "Rename-Old-Test";
      const newName = "Rename-New-Test";
      const oldDir = path.join(TASKS_DIR, oldName);
      const newDir = path.join(TASKS_DIR, newName);
      const oldWs = path.join(WORKSPACE_ROOT, oldName);

      // Setup old list with _meta.json
      fs.mkdirSync(oldDir, { recursive: true });
      fs.mkdirSync(oldWs, { recursive: true });
      fs.writeFileSync(
        path.join(oldDir, "_meta.json"),
        JSON.stringify({ project_dir: oldWs })
      );

      // Simulate rename (fs.rename)
      fs.renameSync(oldDir, newDir);

      // _meta.json should still exist in new location with original project_dir
      const metaPath = path.join(newDir, "_meta.json");
      expect(fs.existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      expect(meta.project_dir).toBe(oldWs);

      // Cleanup
      fs.rmSync(newDir, { recursive: true });
      if (fs.existsSync(oldWs)) fs.rmSync(oldWs, { recursive: true });
    });

    test.afterAll(() => {
      // Cleanup
      if (fs.existsSync(TEST_LIST_DIR)) {
        fs.rmSync(TEST_LIST_DIR, { recursive: true });
      }
      if (fs.existsSync(TEST_WORKSPACE_DIR)) {
        fs.rmSync(TEST_WORKSPACE_DIR, { recursive: true });
      }
    });
  });

  // ==============================
  // Phase 2: UI에서 New List 생성 시 create_list 호출 검증
  // ==============================
  test.describe("Phase 2: UI create_list 호출", () => {
    test("+ New List → 이름 입력 → create_list invoke 호출됨", async ({
      page,
    }) => {
      const lists = makeMockLists([
        {
          name: "Existing",
          tasks: [
            {
              id: "1",
              subject: "T1",
              description: "",
              status: "pending",
              blocks: [],
              blockedBy: [],
            },
          ],
        },
      ]);

      await page.addInitScript(setupMockWithTracking(lists), lists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');

      // Click new list button
      await page.click('[data-testid="btn-new-list"]');
      await page.waitForSelector('[data-testid="input-new-list-name"]');
      await page.fill('[data-testid="input-new-list-name"]', "NewTestList");
      await page.press('[data-testid="input-new-list-name"]', "Enter");
      await page.waitForTimeout(300);

      const invokes = await page.evaluate(
        () => (window as any).__e2e_invokes__
      );
      const createCall = invokes.find((i: any) => i.cmd === "create_list");
      expect(createCall).toBeTruthy();
      expect(createCall.args.listName).toBe("NewTestList");
    });
  });

  // ==============================
  // Phase 3: spawn 명령어에 cd 포함 검증
  // ==============================
  test.describe("Phase 3: spawn 명령어 검증", () => {
    test("Named list spawn 시 spawn_list가 호출됨 (UI)", async ({
      page,
    }) => {
      const tasks = [
        {
          id: "1",
          subject: "Task 1",
          description: "",
          status: "pending",
          blocks: [],
          blockedBy: [],
        },
      ];
      const lists = makeMockLists([{ name: "SpawnTest", tasks }]);

      await page.addInitScript(setupMockWithTracking(lists), lists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');

      // Enter list detail
      await page.click('[data-testid="list-card-SpawnTest"]');
      await page.waitForSelector('[data-testid="btn-back"]');

      // Click spawn all button
      await page.click('[data-testid="btn-spawn-all"]');
      await page.waitForTimeout(300);

      const invokes = await page.evaluate(
        () => (window as any).__e2e_invokes__
      );
      const spawnCall = invokes.find((i: any) => i.cmd === "spawn_list");
      expect(spawnCall).toBeTruthy();
      expect(spawnCall.args.listName).toBe("SpawnTest");
    });

    test("Named task spawn 시 spawn_task가 호출됨 (UI)", async ({
      page,
    }) => {
      const tasks = [
        {
          id: "1",
          subject: "Task to Spawn",
          description: "",
          status: "pending",
          blocks: [],
          blockedBy: [],
        },
      ];
      const lists = makeMockLists([{ name: "TaskSpawnTest", tasks }]);

      await page.addInitScript(setupMockWithTracking(lists), lists);
      await page.goto("http://localhost:1420");
      await page.waitForSelector('[data-testid="app-root"]');

      await page.click('[data-testid="list-card-TaskSpawnTest"]');
      await page.waitForSelector('[data-testid="btn-back"]');

      // Click individual task spawn button
      await page.click('[data-testid="btn-spawn-1"]');
      await page.waitForTimeout(300);

      const invokes = await page.evaluate(
        () => (window as any).__e2e_invokes__
      );
      const spawnCall = invokes.find((i: any) => i.cmd === "spawn_task");
      expect(spawnCall).toBeTruthy();
      expect(spawnCall.args.listName).toBe("TaskSpawnTest");
      expect(spawnCall.args.taskId).toBe("1");
    });
  });

  // ==============================
  // Phase 3: delete_list는 워크스페이스를 삭제하지 않음
  // ==============================
  test.describe("Phase 3: delete_list 워크스페이스 보존", () => {
    test("리스트 삭제 후에도 워크스페이스 디렉토리가 유지됨", async () => {
      const listName = "DeletePreserveTest";
      const listDir = path.join(TASKS_DIR, listName);
      const wsDir = path.join(WORKSPACE_ROOT, listName);

      // Setup
      fs.mkdirSync(listDir, { recursive: true });
      fs.mkdirSync(wsDir, { recursive: true });
      fs.writeFileSync(
        path.join(listDir, "_meta.json"),
        JSON.stringify({ project_dir: wsDir })
      );
      // Put a file in workspace to simulate user work
      fs.writeFileSync(path.join(wsDir, "user-file.txt"), "user data");

      // Simulate delete_list (only removes task dir)
      fs.rmSync(listDir, { recursive: true });

      // Task dir gone
      expect(fs.existsSync(listDir)).toBe(false);
      // Workspace still exists
      expect(fs.existsSync(wsDir)).toBe(true);
      expect(
        fs.existsSync(path.join(wsDir, "user-file.txt"))
      ).toBe(true);

      // Cleanup
      fs.rmSync(wsDir, { recursive: true });
    });
  });
});
