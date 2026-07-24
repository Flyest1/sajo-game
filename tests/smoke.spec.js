import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('v3 title has one canonical campaign entry', async ({ page }) => {
  await expect(page.getByText('江湖의 별 · v3 통합판')).toBeVisible();
  await expect(page.getByRole('button', { name: /강호연대기/ })).toBeVisible();
  await expect(page.getByText(/신규 캠페인|베타/)).toHaveCount(0);
  await page.getByRole('button', { name: /강호연대기/ }).click();
  await expect(page.getByRole('heading', { name: '강호연대기' })).toBeVisible();
  await expect(page.getByText('원작 본편').first()).toBeVisible();
});

test('seeded roam creates a ten-node route and enters deployment', async ({ page }) => {
  await page.getByRole('button', { name: /도전과 회상/ }).click();
  await page.getByRole('button', { name: /유람 시작/ }).click();
  await page.getByLabel('시드 코드').fill('R17-SMOKE');
  await page.getByRole('button', { name: '새 유람' }).click();
  await expect(page.getByText('SEED R17-SMOKE')).toBeVisible();
  await expect(page.locator('.roam-node')).toHaveCount(10);
  await expect(page.locator('.roam-party span')).toHaveCount(4);
  await page.getByRole('button', { name: '격전으로' }).click();
  await expect(page.getByRole('heading', { name: /출전 준비/ })).toBeVisible();
  await expect(page.getByText(/승리 조건: 습격자 격파/)).toBeVisible();
  await page.getByRole('button', { name: '출 전 !' }).click();
  await expect(page.locator('.intent-mark')).toHaveCount(5);
  await expect(page.getByRole('button', { name: '턴 종료' })).toBeEnabled();
});

test('legacy classic save is copied into the unified chronicle', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('kimyong_srpg_save_v1', JSON.stringify({ch:2,roster:{},party:[],extra:{},diff:'std'}));
  });
  await page.reload();
  const migrated=await page.evaluate(() => JSON.parse(localStorage.getItem('kimyong_save_v3')));
  const legacyStillPresent=await page.evaluate(() => localStorage.getItem('kimyong_srpg_save_v1') !== null);
  expect(migrated.version).toBe(3);
  expect(migrated.campaigns.chronicle.cleared).toEqual(['ch01','ch02']);
  expect(legacyStillPresent).toBe(true);
});
