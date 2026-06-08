import { expect, test } from "@playwright/test";

// Regression guard for the 3D graph view. react-force-graph-3d used to throw
// "Cannot read properties of undefined (reading 'tick')" on its first animation
// frame (the layout was not yet initialised), which killed the render loop and
// left the WebGL canvas blank. The three-forcegraph patch fixes it; this test
// fails loudly if the crash ever returns.
test("renders the 3D graph canvas without the tick crash", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Open an agent so the graph canvas mounts (sample fallback provides "Main Agent").
  await page.getByText("Main Agent", { exact: false }).first().click();

  // The view defaults to 3D; make sure the toggle is present and 3D is active.
  const mode3d = page.locator(".nm-graph__mode-btn", { hasText: "3D" });
  await expect(mode3d).toBeVisible();
  await mode3d.click();

  // The 3D renderer must produce a sized WebGL canvas inside the graph surface.
  const canvas = page.locator(".nm-graph canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);

  // Give the animation loop several frames; a dead loop / crash surfaces here.
  await page.waitForTimeout(2500);

  const tickCrash = pageErrors.filter((m) => m.includes("tick") || m.includes("layout"));
  expect(tickCrash, `unexpected render errors: ${pageErrors.join(" | ")}`).toEqual([]);
});

test("switches between 3D and 2D without errors", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByText("Main Agent", { exact: false }).first().click();

  await page.locator(".nm-graph__mode-btn", { hasText: "2D" }).click();
  await expect(page.locator(".nm-graph canvas").first()).toBeVisible();
  await page.locator(".nm-graph__mode-btn", { hasText: "3D" }).click();
  await expect(page.locator(".nm-graph canvas").first()).toBeVisible();
  await page.waitForTimeout(1500);

  expect(pageErrors, `unexpected errors: ${pageErrors.join(" | ")}`).toEqual([]);
});
