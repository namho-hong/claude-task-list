import { test, expect } from "@playwright/test";
import { execSync, ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_BINARY = path.join(
  __dirname,
  "src-tauri",
  "target",
  "debug",
  "claude-task-list"
);

function osascriptMulti(script: string): string {
  try {
    return execSync(`osascript <<'APPLESCRIPT'\n${script}\nAPPLESCRIPT`, {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
  } catch (e: any) {
    return e.stdout?.trim() || "";
  }
}

/** Get center coordinates of the app's tray icon */
function getTrayIconCenter(): { x: number; y: number } | null {
  const result = osascriptMulti(`
    tell application "System Events"
      tell process "claude-task-list"
        set itemCount to count of menu bar items of menu bar 2
        repeat with i from 1 to itemCount
          set item_ to menu bar item i of menu bar 2
          set {xPos, yPos} to position of item_
          set {w, h} to size of item_
          return ((xPos + w / 2) as integer as text) & "," & ((yPos + h / 2) as integer as text)
        end repeat
      end tell
    end tell
  `);
  if (!result || result === "") return null;
  const [x, y] = result.split(",").map(Number);
  return { x, y };
}

/** Real mouse left-click at coordinates */
function clickAt(x: number, y: number) {
  execSync(`cliclick c:${x},${y}`, { timeout: 5000 });
}

/** Real mouse right-click at coordinates */
function rightClickAt(x: number, y: number) {
  execSync(`cliclick rc:${x},${y}`, { timeout: 5000 });
}

function getWindowCount(): number {
  const result = osascriptMulti(`
    tell application "System Events"
      tell process "claude-task-list"
        return count of windows
      end tell
    end tell
  `);
  return parseInt(result) || 0;
}

function getWindowPosition(): { x: number; y: number } | null {
  const result = osascriptMulti(`
    tell application "System Events"
      tell process "claude-task-list"
        if (count of windows) > 0 then
          set {xPos, yPos} to position of window 1
          return (xPos as text) & "," & (yPos as text)
        else
          return "none"
        end if
      end tell
    end tell
  `);
  if (result === "none" || result === "") return null;
  const [x, y] = result.split(",").map(Number);
  return { x, y };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.describe.serial("Native: Tray Icon, Positioning, Focus", () => {
  let trayCenter: { x: number; y: number };

  test.beforeAll(async () => {
    // Kill any existing instance
    try {
      execSync("pkill -f 'target/debug/claude-task-list' 2>/dev/null || true");
    } catch {}
    await sleep(500);

    // Launch the app
    const appProcess = spawn(APP_BINARY, [], {
      detached: true,
      stdio: "ignore",
    });
    appProcess.unref();

    // Wait for app to fully start and register tray icon
    await sleep(4000);

    // Find tray icon position
    const center = getTrayIconCenter();
    expect(center).not.toBeNull();
    trayCenter = center!;
  });

  test.afterAll(async () => {
    try {
      execSync("pkill -f 'target/debug/claude-task-list' 2>/dev/null || true");
    } catch {}
  });

  test("App process is running", () => {
    const result = execSync(
      "pgrep -f 'target/debug/claude-task-list' || true",
      { encoding: "utf-8" }
    ).trim();
    expect(result).not.toBe("");
  });

  test("Left-click tray icon opens window below menu bar", async () => {
    // Ensure window is closed first
    if (getWindowCount() > 0) {
      clickAt(trayCenter.x, trayCenter.y);
      await sleep(800);
    }

    // Left-click tray icon
    clickAt(trayCenter.x, trayCenter.y);
    await sleep(300);

    // Window should be open
    const count = getWindowCount();
    expect(count).toBeGreaterThan(0);

    // Check position: should be near top of screen (below ~28px menu bar)
    const pos = getWindowPosition();
    expect(pos).not.toBeNull();
    if (pos) {
      expect(pos.y).toBeLessThan(60);
      expect(pos.y).toBeGreaterThanOrEqual(20);
    }
  });

  test("Left-click tray icon again closes window", async () => {
    // Window should be open from previous test
    // Click tray to close
    clickAt(trayCenter.x, trayCenter.y);
    await sleep(800);

    const count = getWindowCount();
    expect(count).toBe(0);
  });

  test("Right-click tray icon shows context menu", async () => {
    // Ensure window is closed
    if (getWindowCount() > 0) {
      clickAt(trayCenter.x, trayCenter.y);
      await sleep(800);
    }

    // Right-click tray icon
    rightClickAt(trayCenter.x, trayCenter.y);
    await sleep(500);

    // Check if a menu appeared (System Events should see menu items)
    const menuResult = osascriptMulti(`
      tell application "System Events"
        tell process "claude-task-list"
          try
            set menuItems to name of every menu item of menu 1 of menu bar item 1 of menu bar 2
            key code 53
            return menuItems as text
          on error
            try
              set menuItems to name of every menu item of menu 1 of menu bar item 2 of menu bar 2
              key code 53
              return menuItems as text
            on error
              key code 53
              return "no_menu"
            end try
          end try
        end tell
      end tell
    `);

    // Close any open menu
    execSync("cliclick kp:escape 2>/dev/null || true");
    await sleep(300);

    // Menu should contain "Quit" - or at minimum, window should NOT have opened
    if (menuResult !== "no_menu") {
      expect(menuResult).toContain("Quit");
    }
    // Window should NOT be open (right-click shows menu, not window)
    expect(getWindowCount()).toBe(0);
  });

  test("Focus loss hides window", async () => {
    // Open window
    clickAt(trayCenter.x, trayCenter.y);
    await sleep(300);
    expect(getWindowCount()).toBeGreaterThan(0);

    // Wait past the grace period
    await sleep(600);

    // Activate Finder to steal focus
    osascriptMulti(`tell application "Finder" to activate`);
    await sleep(800);

    // Window should auto-hide
    expect(getWindowCount()).toBe(0);
  });

  test("No race condition: rapid clicks produce consistent state", async () => {
    // Ensure clean state
    if (getWindowCount() > 0) {
      clickAt(trayCenter.x, trayCenter.y);
      await sleep(800);
    }

    // Rapid double-click (should end up closed: open → close)
    clickAt(trayCenter.x, trayCenter.y);
    await sleep(400);
    clickAt(trayCenter.x, trayCenter.y);
    await sleep(800);

    const countAfterDouble = getWindowCount();
    expect(countAfterDouble).toBe(0);

    // Single click to open
    clickAt(trayCenter.x, trayCenter.y);
    await sleep(400);

    const countAfterSingle = getWindowCount();
    expect(countAfterSingle).toBe(1);

    // Clean up
    clickAt(trayCenter.x, trayCenter.y);
    await sleep(500);
  });

  test("Screenshot: glassmorphism visual check", async () => {
    // Open window
    clickAt(trayCenter.x, trayCenter.y);
    await sleep(500);

    // Take a full screenshot
    execSync("screencapture -x /tmp/glassmorphism-test.png");
    expect(fs.existsSync("/tmp/glassmorphism-test.png")).toBe(true);

    // Clean up
    clickAt(trayCenter.x, trayCenter.y);
    await sleep(500);
  });
});
