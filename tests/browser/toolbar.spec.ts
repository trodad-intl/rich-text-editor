/**
 * Toolbar behaviour on a Bootstrap page.
 *
 * Two failures this guards, both invisible to jsdom because they need layout:
 *
 *  - Text colour. The editor sets none of its own, so every character inherited
 *    Bootstrap's `body { color: #212529 }` — a grey that reads as washed out
 *    where body text should be near-black.
 *
 *  - Dropdowns. Every trigger passes `pressed`, and that branch of ToolbarButton
 *    used to render a Radix ToggleGroup, which does not forward a ref. Radix's
 *    popper ANCHOR ref was swallowed, Floating UI never computed a position, and
 *    the menu mounted at its unpositioned `translate(0, -200%)` far off-screen —
 *    indistinguishable from a dead button.
 */
import { expect, test, type Page } from "@playwright/test";
import { openEditor } from "./support/harness";

/** Open the editor, collecting every console error and page error on the way. */
async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await openEditor(page, "<p>Normal report text</p>");
  await page.waitForTimeout(200);
  return errors;
}

/** Click the "Text" dropdown trigger and read where its menu landed. */
async function openTextMenu(page: Page) {
  const trigger = page.locator('button:has-text("Text")').first();
  await trigger.click();
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const w = document.querySelector("[data-radix-popper-content-wrapper]");
    if (!w) return null;
    const r = w.getBoundingClientRect();
    const style = w.getAttribute("style") ?? "";
    return {
      anchored: style.includes("--radix-popper-anchor-width"),
      unpositioned: style.includes("-200%"),
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  });
}

test.describe("toolbar on a Bootstrap page", () => {
  test("editor text uses the editor foreground, not Bootstrap grey", async ({ page }) => {
    await open(page);
    const text = await page.evaluate(() => {
      const el = document.querySelector("[data-slate-editor]")!;
      const scope = document.querySelector(".rte-scope")!;
      return {
        color: getComputedStyle(el).color,
        token: getComputedStyle(scope).getPropertyValue("--foreground").trim(),
      };
    });
    expect(text.color, `token ${text.token}`).toBe("rgb(10, 10, 10)");
  });

  test("enabled toolbar buttons are not dimmed", async ({ page }) => {
    await open(page);
    const enabled = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .filter((b) => !b.disabled)
        .map((b) => getComputedStyle(b).opacity)
    );
    expect(enabled.length).toBeGreaterThan(0);
    for (const o of enabled) expect(Number(o)).toBe(1);
  });

  test("a dropdown trigger exists and is enabled", async ({ page }) => {
    await open(page);
    const trigger = page.locator('button:has-text("Text")').first();
    expect(await trigger.count()).toBeGreaterThan(0);
    expect(await trigger.isDisabled()).toBe(false);
  });

  // One click, several readings of the menu it opened.
  test("the Text dropdown opens, anchored and on-screen", async ({ page }) => {
    await open(page);
    const menu = await openTextMenu(page);
    expect(menu, "the menu renders").not.toBeNull();
    expect.soft(menu.anchored, "Radix resolved the popper anchor").toBe(true);
    expect.soft(menu.unpositioned, "the menu is positioned, not parked off-screen").toBe(false);
    const where = `at ${menu.x},${menu.y} (${menu.w}x${menu.h})`;
    expect.soft(menu.y, `the menu is inside the viewport — ${where}`).toBeGreaterThanOrEqual(0);
    expect.soft(menu.x, `the menu is inside the viewport — ${where}`).toBeGreaterThanOrEqual(0);
    expect.soft(menu.y, `the menu is inside the viewport — ${where}`).toBeLessThan(900);
  });

  test("no console or page errors", async ({ page }) => {
    const errors = await open(page);
    await openTextMenu(page);
    expect(errors).toEqual([]);
  });
});
