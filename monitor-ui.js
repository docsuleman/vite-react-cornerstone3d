import puppeteer from 'puppeteer';

async function monitorTAVIErrors() {
  console.log('🔍 Starting TAVI Error Monitor...\n');
  
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    devtools: true // Open DevTools for debugging
  });

  const page = await browser.newPage();
  
  // Comprehensive error monitoring
  const errors = [];
  const warnings = [];
  const networkErrors = [];
  
  // Console monitoring
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    
    if (type === 'error') {
      errors.push({ type: 'console', message: text, timestamp: new Date() });
      console.log('🔴 Console Error:', text);
    } else if (type === 'warning') {
      warnings.push({ type: 'console', message: text, timestamp: new Date() });
      console.log('🟡 Console Warning:', text);
    } else if (type === 'info' || type === 'log') {
      console.log(`📝 Console ${type}:`, text);
    }
  });

  // Page error monitoring
  page.on('pageerror', error => {
    errors.push({ type: 'page', message: error.message, stack: error.stack, timestamp: new Date() });
    console.log('💥 Page Error:', error.message);
  });

  // Request failure monitoring
  page.on('requestfailed', request => {
    networkErrors.push({ 
      type: 'request', 
      url: request.url(), 
      error: request.failure().errorText, 
      timestamp: new Date() 
    });
    console.log('🌐 Network Error:', request.url(), request.failure().errorText);
  });

  // Response monitoring for HTTP errors
  page.on('response', response => {
    if (response.status() >= 400) {
      networkErrors.push({
        type: 'response',
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        timestamp: new Date()
      });
      console.log(`🔴 HTTP ${response.status()}:`, response.url());
    }
  });

  try {
    console.log('🚀 Navigating to TAVI application...');
    await page.goto('http://localhost:5173', { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });

    console.log('⏱️  Monitoring for 60 seconds...');
    console.log('🎯 Try to interact with the application to test different scenarios\n');
    
    // Monitor for 60 seconds
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    // Final summary
    console.log('\n📊 MONITORING SUMMARY:');
    console.log(`Errors: ${errors.length}`);
    console.log(`Warnings: ${warnings.length}`);
    console.log(`Network Issues: ${networkErrors.length}`);
    
    if (errors.length > 0) {
      console.log('\n🔴 ERRORS DETECTED:');
      errors.forEach((error, index) => {
        console.log(`${index + 1}. [${error.type}] ${error.message}`);
      });
    }
    
    if (warnings.length > 0) {
      console.log('\n🟡 WARNINGS:');
      warnings.forEach((warning, index) => {
        console.log(`${index + 1}. [${warning.type}] ${warning.message}`);
      });
    }
    
    if (networkErrors.length > 0) {
      console.log('\n🌐 NETWORK ISSUES:');
      networkErrors.forEach((netError, index) => {
        console.log(`${index + 1}. ${netError.url} - ${netError.error || netError.status}`);
      });
    }
    
    if (errors.length === 0 && warnings.length === 0 && networkErrors.length === 0) {
      console.log('\n✅ No errors detected! TAVI application is running smoothly.');
    }

  } catch (error) {
    console.error('💥 Monitor error:', error.message);
  } finally {
    console.log('\n🏁 Monitoring complete. Browser will remain open for manual inspection.');
    // Don't close browser - leave it open for manual inspection
    // await browser.close();
  }
}

// Run the monitor
monitorTAVIErrors().catch(console.error);