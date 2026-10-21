const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Landing page
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/smeltlab-landing.png', fullPage: true });
  console.log('Landing page screenshot saved');

  // Upload page
  await page.goto('http://localhost:3000/upload', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/smeltlab-upload.png', fullPage: true });
  console.log('Upload page screenshot saved');

  await browser.close();
})();
