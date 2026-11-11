// Renders the SVG logos into the PNG sizes Android/Chrome need for installing
// the PWA (and later the APK). Run with:  npm run icons
// Uses the Chromium that Playwright provides — no extra dependencies.
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '..', 'public', 'icons')
const jobs = [
  ['logo.svg', 'icon-192.png', 192],
  ['logo.svg', 'icon-512.png', 512],
  ['logo-maskable.svg', 'maskable-192.png', 192],
  ['logo-maskable.svg', 'maskable-512.png', 512],
  ['logo.svg', 'apple-touch-icon.png', 180],
]

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  for (const [src, out, size] of jobs) {
    const svg = fs.readFileSync(path.join(dir, src), 'utf8')
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(
      `<html><body style="margin:0;background:transparent">` +
      svg.replace('<svg ', `<svg width="${size}" height="${size}" `) +
      `</body></html>`)
    await page.screenshot({ path: path.join(dir, out), omitBackground: true })
    console.log('wrote', out)
  }
  await browser.close()
})()
