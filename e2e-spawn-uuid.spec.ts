import { test, expect, Page } from "@playwright/test";

/**
 * Verify that spawning from an Unnamed (UUID) task list correctly
 * invokes spawn_list / spawn_task with the right list name.
 * The Rust backend fix ensures project_dir from _meta.json is used.
 */

const UUID_LIST = "34d5e642-515f-4fe2-96ce-f55532ec37c7";

function setupMock(page: Page) {
  return page.evaluate((uuid) => {
    (window as any).__e2e_invokes__ = [];

    const lists = [
      {
        name: uuid,
        total: 2,
        completed: 0,
        lastUpdated: Math.floor(Date.now() / 1000),
        projectDir: "/Users/dan/claude-task-list",
        tasks: [
          {
            id: "1",
            subject: "Test task A",
            description: "desc A",
            status: "pending",
            blocks: [],
            blockedBy: [],
          },
          {
            id: "2",
            subject: "Test task B (in_progress)",
            description: "desc B",
            status: "in_progress",
            blocks: [],
            blockedBy: [],
            metadata: { session_id: "aaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
          },
        ],
      },
    ];

    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
        (window as any).__e2e_invokes__.push({ cmd, args });
        if (cmd === "get_task_lists") return lists;
        if (cmd === "get_tasks") {
          const list = lists.find((l: any) => l.name === args?.listName);
          return list?.tasks || [];
        }
        if (cmd === "get_config") return { terminal: "iterm" };
        if (cmd === "spawn_list") return null;
        if (cmd === "spawn_task") return null;
        if (cmd === "hide_window") return null;
        if (cmd === "set_project_dir") return null;
        if (cmd === "init_project_dir") return "/tmp/test";
        if (cmd === "pick_directory") return null;
        if (cmd === "show_tooltip") return null;
        if (cmd === "hide_tooltip") return null;
        return null;
      },
    };
  }, UUID_LIST);
}

function getInvokes(page: Page) {
  return page.evaluate(() => (window as any).__e2e_invokes__ || []);
}

test.describe("UUID list spawn", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await setupMock(page);
    // Trigger data reload
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(500);
  });

  test("spawn_list is called with UUID list name when clicking play button", async ({
    page,
  }) => {
    // Switch to Unnamed tab
    await page.click('[data-testid="tab-unnamed"]');
    await page.waitForTimeout(300);

    // Verify UUID list is visible
    const listItem = page.getByText(UUID_LIST.substring(0, 8));
    await expect(listItem).toBeVisible();

    // Click the spawn/play button for this list
    const playBtn = page.locator(
      `[data-testid="btn-play-${UUID_LIST}"]`
    );
    await playBtn.click();
    await page.waitForTimeout(300);

    // Verify spawn_list was called with the UUID list name
    const invokes = await getInvokes(page);
    const spawnCall = invokes.find(
      (i: any) => i.cmd === "spawn_list"
    );
    expect(spawnCall).toBeTruthy();
    expect(spawnCall.args.listName).toBe(UUID_LIST);
  });

  test("spawn_task is called with UUID list name and task id", async ({
    page,
  }) => {
    // Switch to Unnamed tab
    await page.click('[data-testid="tab-unnamed"]');
    await page.waitForTimeout(300);

    // Click on the UUID list to expand it
    const listItem = page.getByText(UUID_LIST.substring(0, 8));
    await listItem.click();
    await page.waitForTimeout(300);

    // Click spawn on task #1 (data-testid is btn-spawn-{id} on detail screen)
    const taskPlayBtn = page.locator(
      `[data-testid="btn-spawn-1"]`
    );
    await taskPlayBtn.click();
    await page.waitForTimeout(300);

    const invokes = await getInvokes(page);
    const spawnCall = invokes.find(
      (i: any) => i.cmd === "spawn_task"
    );
    expect(spawnCall).toBeTruthy();
    expect(spawnCall.args.listName).toBe(UUID_LIST);
    expect(spawnCall.args.taskId).toBe("1");
  });
});
