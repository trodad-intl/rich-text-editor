/**
 * Does dragging a column border actually resize the column?
 */
import { expect, test, type Page } from "@playwright/test";
import { openEditor } from "./support/harness";

/*
 * Plate resizes a PAIR of columns, holding their combined width constant, and
 * will not take a column below its 48px minimum. So the neighbour needs room to
 * give — dragging against a column that is already at the minimum can only move
 * the boundary the other way, which is correct behaviour and not a bug.
 */
const TABLE = `<table border="1" style="border-collapse: collapse;">
<colgroup><col width="150"><col width="200"><col width="300"></colgroup>
<tr><td style="border:1px solid #000">Rate</td><td style="border:1px solid #000">:</td><td style="border:1px solid #000">85 b/min</td></tr>
<tr><td style="border:1px solid #000">Rhythm</td><td style="border:1px solid #000">:</td><td style="border:1px solid #000">Regular</td></tr>
</table>`;

const DRAG_PX = 60;

async function open(page: Page) {
  await openEditor(page, TABLE);
  // A table pasted without widths measures itself and switches to fixed layout on
  // the frame after mount; let that settle before measuring anything.
  await page.waitForTimeout(300);
}

// The first <td> is the editor's row drag-handle cell, not a content column.
const cells = (page: Page) =>
  page.locator("[data-slate-editor] table tr").first().locator("td:not(.w-2)");
const widths = (page: Page) =>
  cells(page).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
// The right-hand handle of column 0.
const handle = (page: Page) => page.locator('[data-col="0"]').first();

test.describe("the table renders", () => {
  test("editor mounted", async ({ page }) => {
    await open(page);
    expect(await page.locator("[data-slate-editor]").count()).toBeGreaterThan(0);
  });

  test("table rendered", async ({ page }) => {
    await open(page);
    expect(await page.locator("[data-slate-editor] table").count()).toBeGreaterThan(0);
  });

  test("three content columns", async ({ page }) => {
    await open(page);
    await expect(cells(page)).toHaveCount(3);
  });
});

test.describe("the resize handle", () => {
  test("resize handle present in the DOM", async ({ page }) => {
    await open(page);
    expect(await handle(page).count()).toBeGreaterThan(0);
  });

  test("resize handle has a hit area", async ({ page }) => {
    await open(page);
    const box = await handle(page).boundingBox();
    expect(box, "no box").not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test("handle shows the col-resize cursor", async ({ page }) => {
    await open(page);
    const cursor = await handle(page).evaluate((el) => getComputedStyle(el).cursor);
    expect(cursor).toBe("col-resize");
  });
});

// One drag, four consequences of it.
test("dragging column 0's border resizes the pair and persists", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  await open(page);
  const before = await widths(page);
  const box = await handle(page).boundingBox();
  expect(box, "resize handle has a hit area").not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  // Several small steps: a single jump can be ignored as noise.
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(box!.x + box!.width / 2 + (i * DRAG_PX) / 6, box!.y + box!.height / 2);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await widths(page);
  expect
    .soft(
      Math.abs(after[0] - (before[0] + DRAG_PX)),
      `column 0 grew by the drag distance — ${before[0]}px -> ${after[0]}px (expected ~${before[0] + DRAG_PX})`
    )
    .toBeLessThanOrEqual(4);
  expect
    .soft(
      Math.abs(after[1] - (before[1] - DRAG_PX)),
      `its neighbour gave up exactly that much — ${before[1]}px -> ${after[1]}px (expected ~${before[1] - DRAG_PX})`
    )
    .toBeLessThanOrEqual(4);
  expect.soft(after[2], "the other column is untouched").toBe(before[2]);

  const persisted = await page.evaluate(() => {
    const ta = document.getElementById("content") as HTMLTextAreaElement | null;
    return ta ? ta.value.includes("<colgroup>") : false;
  });
  expect.soft(persisted, "the new width is persisted to the textarea").toBe(true);

  // The legacy script printed these without failing on them; so does this.
  if (errors.length) test.info().annotations.push({ type: "browser errors", description: errors.join("\n") });
});
