import { expect, test } from "@playwright/test";

test("C4 Arabic and English direction persists and does not overflow", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "ع" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("link", { name: "لوحة المتابعة" }).first()).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: "EN" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("link", { name: "Dashboard" }).first()).toBeVisible();
  await page.getByRole("button", { name: "ع" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/customers/new");
  await expect(page.getByText("الاسم القانوني")).toBeVisible();
  await expect(page.locator('input[name="iban"]')).toHaveAttribute("dir", "ltr");
  const tabletOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(tabletOverflow).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "EN" }).click();
  await expect(page.getByText("Legal name")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});
