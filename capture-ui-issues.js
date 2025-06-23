import puppeteer from 'puppeteer';

async function captureUIIssues() {
  console.log('📸 Capturing current UI issues...');
  
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Monitor console for errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('🔴 Console Error:', msg.text());
    }
  });

  try {
    console.log('📱 Navigating to TAVI app...');
    await page.goto('http://localhost:5174', { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });

    // Take initial screenshot
    await page.screenshot({ 
      path: 'ui-issues-initial.png', 
      fullPage: true 
    });
    console.log('✅ Initial screenshot saved: ui-issues-initial.png');

    // Try to open patient search
    console.log('🔍 Testing patient search modal...');
    const searchButtons = await page.$$('button');
    
    for (const button of searchButtons) {
      const text = await button.evaluate(el => el.textContent);
      if (text && text.includes('Search Patients')) {
        await button.click();
        
        // Wait a moment for modal to appear
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await page.screenshot({ 
          path: 'ui-issues-patient-search.png', 
          fullPage: true 
        });
        console.log('✅ Patient search modal screenshot saved: ui-issues-patient-search.png');
        break;
      }
    }

    console.log('\n🔍 Screenshots captured for analysis:');
    console.log('1. ui-issues-initial.png - Shows main interface');
    console.log('2. ui-issues-patient-search.png - Shows patient search modal issues');
    
    console.log('\n🐛 Reported Issues to Fix:');
    console.log('• No CT visible after selecting patient');
    console.log('• Black and white text (poor contrast)');
    console.log('• Patient selection window transparent and overlapping');
    
    // Keep browser open for manual inspection
    console.log('\n🔍 Browser kept open for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 60000));

  } catch (error) {
    console.error('❌ Capture error:', error.message);
  } finally {
    await browser.close();
  }
}

captureUIIssues().catch(console.error);