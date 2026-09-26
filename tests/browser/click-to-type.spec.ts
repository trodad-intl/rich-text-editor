/**
 * Does clicking anywhere in the editor give you a caret to type at?
 *
 * The editable is only as tall as its content, so on a short document it filled
 * about 50px of the 600px frame and every click in the space below it landed on
 * the container instead: nothing focused, and typing went nowhere. Only a real
 * browser can show this — it is a question about where a box ends up on screen.
 */
import { expect, test } from "@playwright/test";
import { openEditor } from "./support/harness";

test.describe("the blank space below a short document", () => {
  test("the editable fills the frame rather than just its own text", async ({ page }) => {
    await openEditor(page, "<p>First line of the report.</p>");
    const geometry = await page.evaluate(() => {
      const editable = document.querySelector("[data-slate-editor]")!;
      const frame = editable.parentElement!.getBoundingClientRect();
      return {
        editable: Math.round(editable.getBoundingClientRect().height),
        frame: Math.round(frame.height),
      };
    });
    expect(geometry.editable, `${geometry.editable}px of ${geometry.frame}px`).toBeGreaterThanOrEqual(
      geometry.frame
    );
  });

  // One test: the typing check only means something after the click focused.
  test("clicking the empty space below the text focuses the editor, and typing goes into the document", async ({ page }) => {
    await openEditor(page, "<p>First line of the report.</p>");
    const target = await page.evaluate(() => {
      const frame = document
        .querySelector("[data-slate-editor]")!
        .parentElement!.getBoundingClientRect();
      return {
        x: Math.round(frame.left + frame.width / 2),
        y: Math.round(frame.bottom - 20),
      };
    });

    await page.mouse.click(target.x, target.y);
    const focused = await page.evaluate(
      () => document.activeElement?.hasAttribute("data-slate-editor") ?? false
    );
    expect.soft(focused, "clicking the empty space below the text focuses the editor").toBe(true);

    await page.keyboard.type("TYPED");
    await page.waitForTimeout(250);
    const text = await page.evaluate(
      () => document.querySelector("[data-slate-editor]")!.textContent ?? ""
    );
    expect.soft(text, "and what is typed goes into the document").toContain("TYPED");
  });
});

test("clicking on a line still puts the caret on that line", async ({ page }) => {
  await openEditor(page, "<p>AAAAAAAAAA</p><p>BBBBBBBBBB</p><p>CCCCCCCCCC</p>");
  const target = await page.evaluate(() => {
    const line = document.querySelectorAll("[data-slate-editor] > div")[1].getBoundingClientRect();
    return { x: Math.round(line.left + 4), y: Math.round(line.top + line.height / 2) };
  });
  await page.mouse.click(target.x, target.y);
  await page.keyboard.type("X");
  await page.waitForTimeout(250);

  const lines = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-slate-editor] > div")).map((d) => d.textContent)
  );
  expect(lines[1]).toMatch(/^X/);
  expect(lines[0]).toBe("AAAAAAAAAA");
});

// The placeholder must not drift into the middle of the taller box.
test("the placeholder stays on the first line", async ({ page }) => {
  await openEditor(page, "");
  const offset = await page.evaluate(() => {
    const editable = document.querySelector("[data-slate-editor]")!;
    const placeholder = document.querySelector("[data-slate-placeholder]");
    if (!placeholder) return null;
    return Math.round(
      placeholder.getBoundingClientRect().top - editable.getBoundingClientRect().top
    );
  });
  expect(offset, "placeholder rendered").not.toBeNull();
  expect(offset!, `${offset}px down`).toBeLessThan(40);
});
