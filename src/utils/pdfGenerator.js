import os from 'os';
import puppeteer from 'puppeteer';

export const generatePDF = async (htmlContent, outputPath) => {
  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-features=dbus'
    ]
  };

  // 🎯 CRITICAL FIX: Do NOT force executablePath to /usr/bin/chromium anymore!
  // Puppeteer will automatically find its own matching standalone browser.

  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent);
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true
    });
    return outputPath;
  } finally {
    await browser.close();
  }
};