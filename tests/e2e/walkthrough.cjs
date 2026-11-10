// Usage: start db, server (:8080), worker and `vite preview` (:4173), create an admin, then:
//   E2E_ADMIN_USERNAME=... E2E_ADMIN_PASSWORD=... node tests/e2e/walkthrough.cjs <screenshot-dir>
// End-to-end walkthrough against the locally running stack (web :4173, api :8080).
const { chromium, devices } = require('playwright');
const OUT = process.argv[2];
const WEB = 'http://localhost:4173';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/WebSocket|favicon/.test(m.text()) && errors.push(m.text()));

  await page.goto(WEB);
  await page.waitForSelector('text=Bắt đầu khởi nghiệp, text=Vào thế giới kinh doanh', { timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: `${OUT}/01-landing-desktop.png` });
  const anim = await page.$eval('.btn-shimmer', (el) => getComputedStyle(el, '::after').animationName).catch(() => 'none');
  check('Primary CTA runs shimmer animation', anim === 'sweep', anim);
  const shimmerCount = await page.$$eval('.btn-shimmer', (els) => els.length);
  check('Only one shimmer CTA on landing', shimmerCount === 1, String(shimmerCount));

  // Register
  await page.click('role=tab[name="Tạo tài khoản"]');
  const user = 'e2e_' + Date.now().toString(36);
  await page.getByLabel('Tên đăng nhập', { exact: false }).first().fill(user);
  await page.getByLabel('Tên hiển thị', { exact: false }).first().fill('Nguyễn Khởi Nghiệp');
  await page.getByLabel('Mật khẩu', { exact: false }).first().fill('Banh-mi-Sai-Gon-2026');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Xin chào', { timeout: 15000 });
  check('Register logs in and shows dashboard', true);
  const bg = await page.$$eval('.btn-primary', (els) => els.map((e) => getComputedStyle(e).backgroundImage));
  check('Every primary button has its 3D gradient', bg.length > 0 && bg.every((b) => b.includes('gradient')), `${bg.length} buttons`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/02-dashboard-desktop.png` });

  // Found a bakery
  await page.click('text=Thành lập doanh nghiệp >> nth=0');
  await page.waitForSelector('text=Đăng ký thành lập doanh nghiệp');
  await page.click('button:has-text("Tiệm bánh")');
  await page.click('button:has-text("TP. Thủ Đức")');
  await page.fill('input[placeholder="VD: Bánh Mì Sương Mai"]', 'Bánh Mì Bình Minh ' + user.slice(-4));
  await page.screenshot({ path: `${OUT}/03-found-modal.png` });
  await page.click('button:has-text("Nộp hồ sơ")');
  await page.waitForSelector('text=Giấy phép kinh doanh dự kiến', { timeout: 15000 });
  check('Company founded, licence pending shown', true);
  await page.screenshot({ path: `${OUT}/04-company-overview.png` });

  // Buy equipment
  await page.click('role=tab[name="Sản xuất & Kho"]');
  await page.click('button:has-text("Mua thiết bị")');
  await page.click('label:has-text("Lò nướng công nghiệp")');
  await page.click('button:has-text("Mua 1 máy")');
  await page.waitForSelector('text=Đã mua thiết bị', { timeout: 10000 });
  check('Equipment purchase via UI', true);

  // Hire staff
  await page.click('role=tab[name^="Nhân sự"]');
  await page.click('button:has-text("Tuyển dụng")');
  await page.locator('[role=dialog] button:has-text("Kỳ vọng")').first().click();
  await page.click('button:has-text("Gửi đề nghị hợp đồng")');
  await page.waitForSelector('text=Đã ký hợp đồng lao động', { timeout: 10000 });
  await page.keyboard.press('Escape');
  check('Hire employee via UI', true);
  await page.screenshot({ path: `${OUT}/05-staff.png` });

  // Buy inputs from NPC supplier
  await page.click('role=tab[name="Mua hàng & Vận chuyển"]');
  await page.waitForSelector('text=Nhà cung cấp');
  await page.locator('button:has-text("Đặt mua")').first().click();
  await page.waitForSelector('text=Cước vận chuyển', { timeout: 10000 });
  await page.click('button:has-text("Xác nhận đặt hàng")');
  await page.waitForSelector('text=Đã đặt hàng', { timeout: 10000 });
  await page.waitForTimeout(800);
  check('B2B purchase creates an in-transit shipment', (await page.locator('text=Đang vận chuyển').count()) > 0);
  await page.screenshot({ path: `${OUT}/06-supply.png` });

  await page.click('role=tab[name="Tài chính & Báo cáo"]');
  await page.waitForSelector('text=Bảng cân đối kế toán');
  await page.screenshot({ path: `${OUT}/07-finance.png`, fullPage: false });

  for (const [path, file, text] of [
    ['/market', '08-market', 'Thị trường'],
    ['/exchange', '09-exchange', 'Sàn chứng khoán'],
    ['/library', '10-library', 'Thư viện doanh nghiệp'],
    ['/bank', '11-bank', 'Ngân hàng'],
    ['/profile', '12-profile', 'Năm giai đoạn'],
  ]) {
    await page.goto(WEB + path);
    await page.waitForSelector(`text=${text}`, { timeout: 10000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${file}.png` });
  }
  check('Main pages render', true);

  // Double-click protection: rapid double click on a mutation sends one request
  await page.goto(WEB + '/bank');
  const reqs = [];
  page.on('request', (r) => r.method() === 'POST' && r.url().includes('/me/transfer') && reqs.push(r));
  await page.getByLabel('Tên đăng nhập người nhận', { exact: false }).first().fill(process.env.E2E_ADMIN_USERNAME ?? 'quantri');
  const btn = page.locator('button:has-text("Chuyển")').last();
  await btn.dblclick();
  await page.waitForTimeout(1500);
  check('Double click sends one transfer request', reqs.length === 1, `${reqs.length} requests`);

  // Admin
  const admin = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ap = await admin.newPage();
  await ap.goto(WEB);
  await ap.getByLabel('Tên đăng nhập', { exact: false }).first().fill(process.env.E2E_ADMIN_USERNAME ?? 'quantri');
  await ap.getByLabel('Mật khẩu', { exact: false }).first().fill(process.env.E2E_ADMIN_PASSWORD ?? '');
  await ap.click('button[type=submit]');
  await ap.waitForSelector('text=Xin chào');
  await ap.goto(WEB + '/admin');
  await ap.waitForSelector('text=Kiểm toán sổ cái', { timeout: 10000 });
  await ap.waitForTimeout(800);
  check('Admin ledger audit shows balanced', (await ap.locator('text=Cân bằng').count()) > 0);
  await ap.screenshot({ path: `${OUT}/13-admin.png` });

  // Mobile
  const m = await browser.newContext({ ...devices['iPhone 13'] });
  const mp = await m.newPage();
  await mp.goto(WEB);
  await mp.waitForTimeout(800);
  await mp.screenshot({ path: `${OUT}/20-landing-mobile.png` });
  const token = await page.evaluate(() => localStorage.getItem('startup.token'));
  await mp.evaluate((t) => localStorage.setItem('startup.token', t), token);
  for (const [path, file] of [['/', '21-dashboard-mobile'], ['/companies', '22-companies-mobile'], ['/market', '23-market-mobile'], ['/library', '24-library-mobile']]) {
    await mp.goto(WEB + path);
    await mp.waitForTimeout(1200);
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`Mobile ${path} has no horizontal overflow`, !overflow);
    await mp.screenshot({ path: `${OUT}/${file}.png` });
  }
  const small = await mp.$$eval('nav[aria-label="Điều hướng nhanh"] a, nav[aria-label="Điều hướng nhanh"] button', (els) => els.filter((e) => e.getBoundingClientRect().height < 44).length);
  check('Mobile bottom nav targets >= 44px', small === 0);

  // Reduced motion
  const rm = await browser.newContext({ reducedMotion: 'reduce' });
  const rp = await rm.newPage();
  await rp.goto(WEB);
  const disp = await rp.$eval('.btn-shimmer', (el) => getComputedStyle(el, '::after').display).catch(() => '?');
  check('Reduced motion disables shimmer', disp === 'none', disp);

  check('No uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await browser.close();
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('E2E ABORTED:', e.message);
  process.exit(1);
});
