import { test, expect } from '@playwright/test';

test('city animation can pause and resume; bilingual hero keeps its application link', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('從香港出發');
  const tramPositions = () =>
    page
      .locator('.city-tram')
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).transform));

  await page.getByRole('button', { name: '暫停動畫', exact: true }).click();
  const stopped = await tramPositions();
  // Sample across time: a paused animation must stay still, rather than just change its label.
  await page.waitForTimeout(250);
  expect(await tramPositions()).toEqual(stopped);
  await page.getByRole('button', { name: '播放動畫', exact: true }).click();
  await expect.poll(tramPositions).not.toEqual(stopped);

  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Your next chapter, starts here.',
  );
  await page.getByRole('link', { name: 'Explore the process', exact: true }).click();
  await expect(page).toHaveURL(/#process$/);
  await expect(
    page.getByRole('heading', { name: 'Know exactly what comes next.' }),
  ).toBeInViewport();
  await page.goto('/');
  await page.getByRole('link', { name: 'Start your company', exact: true }).click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('reduced-motion hero stays still and fits desktop and narrow mobile screens', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const tramPositions = () =>
    page
      .locator('.city-tram')
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).transform));
  const still = await tramPositions();
  await page.waitForTimeout(250);
  expect(await tramPositions()).toEqual(still);
  await expect(page.getByRole('button', { name: '暫停動畫', exact: true })).toHaveCount(0);

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: '開始設立公司', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  }
  await page.getByRole('button', { name: '開啟導覽', exact: true }).click();
  await expect(page.getByRole('link', { name: '登入 / 開始申請', exact: true })).toBeVisible();
});

test('trams travel right and gradually disappear before the desktop and mobile exit', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '暫停動畫', exact: true }).click();

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const sample = (progress: number) =>
      page.locator('.city-tram').evaluateAll(
        (trams, fraction) =>
          trams.map((tram) => {
            const animation = tram.getAnimations()[0];
            // Seek the real CSS animation, with stagger removed solely for deterministic observation.
            animation.pause();
            animation.effect!.updateTiming({ delay: 0 });
            animation.currentTime = Number(animation.effect!.getTiming().duration) * fraction;
            const style = getComputedStyle(tram);
            return {
              x: new DOMMatrixReadOnly(style.transform).m41,
              opacity: Number(style.opacity),
            };
          }),
        progress,
      );

    const start = await sample(width === 1440 ? 0.25 : 0.12);
    const fading = await sample(width === 1440 ? 0.61 : 0.23);
    const end = await sample(width === 1440 ? 0.75 : 0.34);
    for (let i = 0; i < start.length; i++) {
      expect(fading[i].x).toBeGreaterThan(start[i].x);
      expect(end[i].x).toBeGreaterThan(fading[i].x);
      expect(start[i].opacity).toBe(1);
      expect(fading[i].opacity).toBeGreaterThan(0);
      expect(fading[i].opacity).toBeLessThan(1);
      expect(end[i].opacity).toBe(0);
    }
  }
});
