// Test script for optimized CPR functionality
// Run: node test-cpr-optimized.js

const puppeteer = require('puppeteer');

async function testCPROptimized() {
  console.log('🔄 Testing optimized CPR viewport...');

  const browser = await puppeteer.launch({ 
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Listen for console messages
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('CPR') || text.includes('WebGL') || text.includes('texture') || text.includes('📷') || text.includes('🔧')) {
      console.log(`Browser: ${text}`);
    }
  });

  try {
    console.log('📱 Navigating to application...');
    await page.goto('http://localhost:5174', { waitUntil: 'networkidle0', timeout: 30000 });

    console.log('🔍 Waiting for TAVI app to load...');
    await page.waitForSelector('[data-testid="tavi-app"], .bg-gradient-to-r', { timeout: 15000 });

    // Look for patient search button and click it
    console.log('👤 Looking for patient search...');
    const searchButton = await page.waitForSelector('button:has-text("Search Patients"), button[class*="bg-blue"]:has-text("Search")', { timeout: 10000 });
    if (searchButton) {
      await searchButton.click();
      console.log('✅ Clicked search patients button');
    }

    // Wait for patient search modal
    await page.waitForTimeout(2000);

    // Look for the test patient in the list
    console.log('🔍 Looking for test patient...');
    const patientRow = await page.waitForSelector('tr:has-text("TCGA-LUAD"), tr:has-text("1.2.840.113654"), tr', { timeout: 10000 });
    if (patientRow) {
      await patientRow.click();
      console.log('✅ Selected test patient');
    }

    // Wait for series selection and select one
    await page.waitForTimeout(1000);
    const seriesRow = await page.$('tr[class*="cursor-pointer"]:not([class*="bg-blue"])');
    if (seriesRow) {
      await seriesRow.click();
      console.log('✅ Selected test series');
    }

    // Wait for MPR to load
    console.log('⏳ Waiting for MPR viewport to initialize...');
    await page.waitForTimeout(5000);

    // Place 3 sphere markers to enable CPR
    console.log('🎯 Placing sphere markers for root definition...');
    
    // Click sphere tool first
    const sphereTool = await page.$('button:has-text("Sphere")');
    if (sphereTool) {
      await sphereTool.click();
      console.log('✅ Activated sphere tool');
    }

    // Place 3 markers in the axial viewport
    const axialViewport = await page.$('[class*="grid"] > div:first-child div[style*="min-height"]');
    if (axialViewport) {
      // Place first sphere
      await axialViewport.click({ clickCount: 1, button: 'left' });
      await page.waitForTimeout(500);
      
      // Place second sphere
      await axialViewport.click({ clickCount: 1, button: 'left', offset: { x: 50, y: 50 } });
      await page.waitForTimeout(500);
      
      // Place third sphere
      await axialViewport.click({ clickCount: 1, button: 'left', offset: { x: -50, y: -50 } });
      await page.waitForTimeout(500);
      
      console.log('✅ Placed 3 sphere markers');
    }

    // Click on CPR Analysis stage
    console.log('🎯 Advancing to CPR Analysis stage...');
    const cprStage = await page.$('div[class*="grid"]:has-text("Step 3")');
    if (cprStage) {
      await cprStage.click();
      console.log('✅ Clicked CPR Analysis stage');
    }

    // Wait for CPR to initialize
    console.log('⏳ Waiting for CPR viewport to initialize...');
    await page.waitForTimeout(8000);

    // Check if CPR viewport is visible and working
    const cprViewport = await page.$('div:has-text("CPR Demo Mode")');
    if (cprViewport) {
      console.log('✅ CPR viewport is visible');
      
      // Check for errors
      const errorElement = await page.$('div:has-text("CPR Error")');
      if (errorElement) {
        const errorText = await page.evaluate(el => el.textContent, errorElement);
        console.log('❌ CPR Error found:', errorText);
      } else {
        console.log('✅ No CPR errors detected');
      }
      
      // Check for WebGL warnings
      const webglWarnings = await page.evaluate(() => {
        const logs = [];
        const originalWarn = console.warn;
        console.warn = function(...args) {
          if (args.some(arg => typeof arg === 'string' && arg.includes('WebGL'))) {
            logs.push(args.join(' '));
          }
          return originalWarn.apply(console, args);
        };
        return logs;
      });
      
      if (webglWarnings.length > 0) {
        console.log('⚠️ WebGL warnings:', webglWarnings);
      } else {
        console.log('✅ No WebGL warnings detected');
      }
    } else {
      console.log('❌ CPR viewport not found');
    }

    console.log('🔧 Optimized CPR test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }

  await page.waitForTimeout(5000); // Keep browser open to inspect
  // await browser.close();
}

testCPROptimized().catch(console.error);