/**
 * 演示视频录制脚本（Playwright + 系统 Chrome）。
 *
 * 产出三段原始 webm：
 *   v1-clean    对话式数据清洗
 *   v2-train    训练卡一键训练（选模型 → 进度 → 指标曲线）
 *   v3-oneshot  一句话完成「体检 → 清洗 → 给出训练配置」
 *
 * 运行：node demo_videos/_record.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'demo_videos', 'raw');
const DIRTY = path.join(ROOT, 'sample_data', 'dirty_patients.csv');
const CLEAN = path.join(ROOT, 'sample_data', 'cleaned_dirty_patients.csv');
const APP = 'http://localhost:3000';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForText(page, text, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const body = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (body.includes(text)) return true;
    await sleep(2000);
  }
  console.log(`  ! 等待文本超时: ${text}`);
  return false;
}

/** 让页面跟着内容滚动，录出来不至于一直停在顶部 */
function autoScroll(page) {
  const timer = setInterval(() => {
    page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  }, 2500);
  return () => clearInterval(timer);
}

async function newChat(page, file, prompt) {
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await sleep(1200);
  await page.setInputFiles('input[type=file]', file);
  await sleep(1500);
  await page.fill('textarea', prompt);
  await sleep(700);
  // 发送按钮是纯图标，用回车提交
  await page.keyboard.press('Enter');
  console.log('  已发送指令');
}

async function record(browser, name, fn) {
  const dir = path.join(RAW, name);
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir, size: { width: 1280, height: 720 } },
    locale: 'zh-CN',
  });
  const page = await ctx.newPage();
  console.log(`▶ ${name}`);
  const stopScroll = autoScroll(page);
  try {
    await fn(page);
  } catch (err) {
    console.log(`✗ ${name}: ${err.message}`);
  } finally {
    stopScroll();
    await sleep(1500);
    await ctx.close();
    const source = await page.video().path();
    const dest = path.join(ROOT, 'demo_videos', `${name}.webm`);
    fs.renameSync(source, dest);
    console.log(`✔ ${name} -> ${dest}`);
  }
}

const ONLY = process.argv[2] || '';
const browser = await chromium.launch({ channel: 'chrome', headless: true });

const videos = {
  'v1-clean': async (page) => {
    await newChat(page, DIRTY, '帮我体检这份数据并清洗：去掉重复行、统一格式、脱敏隐私字段');
    await waitForText(page, 'cleaned_dirty_patients.csv', 300000);
    await sleep(8000);
  },
  'v2-train': async (page) => {
    await page.goto(APP, { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    await page.setInputFiles('input[type=file]', CLEAN);
    await sleep(1500);
    // 先发一句话进入对话页，头部才有「训练」入口（不必等回复）
    await page.fill('textarea', '你好');
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/chat\//, { timeout: 30000 });
    await sleep(2500);

    await page.locator('button', { hasText: /^训练$/ }).first().click();
    await sleep(2000);

    // 弹窗内的文件列表（同名的附件在弹窗外，会被遮罩挡住）
    const modal = page.locator('[role="presentation"]');
    await modal.locator('text=cleaned_dirty_patients.csv').first().click();
    await sleep(3500);

    await page.locator('button:has-text("下一步")').first().click();
    await sleep(1800);

    await page.locator('button:has-text("神经网络")').first().click();
    await sleep(1000);
    // 把轮数调大，让进度条与曲线在视频里看得见
    await page.getByLabel('训练轮数').fill('200').catch(async () => {});
    await page.locator('input[type="number"]').first().fill('200').catch(() => {});
    await sleep(800);

    await page.locator('button:has-text("开始训练")').first().click();
    console.log('  训练已启动');
    await waitForText(page, '训练完成', 240000);
    await sleep(8000);
  },
  'v3-oneshot': async (page) => {
    await newChat(page, DIRTY, '帮我体检、清洗，并训练一个模型预测「并发症」，按患者编号分组');
    await waitForText(page, '训练配置', 360000);
    await sleep(8000);
  },
  'v4-chat-train': async (page) => {
    // 对话里的训练配置卡：换模型 → 开始训练 → 进度曲线 → 结果 → AI 解读
    await newChat(page, DIRTY, '帮我体检、清洗，并训练一个模型预测「并发症」，按患者编号分组');
    await waitForText(page, '训练配置', 360000);
    await sleep(2500);

    await page.locator('button:has-text("梯度提升")').first().click();
    await sleep(1200);
    await page.locator('button:has-text("开始训练")').first().click();
    console.log('  已在对话里启动训练');
    await waitForText(page, '训练完成', 240000);
    await sleep(3000);

    const interpret = page.locator('button:has-text("让 AI 解读结果")').first();
    if (await interpret.count()) {
      await interpret.click();
      await waitForText(page, '特征重要性', 180000);
    }
    await sleep(8000);
  },
};

for (const [name, fn] of Object.entries(videos)) {
  if (ONLY && name !== ONLY) continue;
  await record(browser, name, fn);
}

await browser.close();
console.log('全部录制完成');
