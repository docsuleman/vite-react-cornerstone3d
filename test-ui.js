import puppeteer from 'puppeteer';

async function testTAVIUI() {
  console.log('Starting TAVI UI test...');
  
  const browser = await puppeteer.launch({
    headless: false, // Set to true for headless mode
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Enable console logging from the page
  page.on('console', msg => {
    const type = msg.type();
    const args = msg.args();
    console.log(`[${type.toUpperCase()}]:`, ...args.map(arg => arg.toString()));
  });

  // Listen for page errors
  page.on('pageerror', error => {
    console.error('Page error:', error.message);
  });

  // Listen for uncaught exceptions
  page.on('error', error => {
    console.error('Error:', error.message);
  });

  try {
    console.log('Navigating to TAVI app...');
    await page.goto('http://localhost:5173', { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });

    console.log('Page loaded, waiting for TAVI app to initialize...');
    
    // Wait for the main TAVI app to load
    await page.waitForSelector('[class*="bg-gradient-to-r"]', { timeout: 10000 });
    console.log('TAVI header found');

    // Take a screenshot of the initial state
    await page.screenshot({ 
      path: 'tavi-initial.png', 
      fullPage: true 
    });
    console.log('Initial screenshot saved as tavi-initial.png');

    // Check if we're in patient selection stage
    const patientSelectionVisible = await page.$('.text-center .text-6xl');
    if (patientSelectionVisible) {
      console.log('Patient selection stage detected');
      
      // Try to click the "Search Patients" button
      const searchButton = await page.$('button');
      const searchButtons = await page.$$('button');
      
      let patientSearchButton = null;
      for (const button of searchButtons) {
        const text = await button.evaluate(el => el.textContent);
        if (text && text.includes('Search Patients')) {
          patientSearchButton = button;
          break;
        }
      }
      
      if (patientSearchButton) {
        console.log('Clicking Search Patients button...');
        await patientSearchButton.click();
        
        // Wait for patient search modal
        await page.waitForSelector('.fixed.inset-0', { timeout: 5000 });
        console.log('Patient search modal opened');
        
        // Take a screenshot of the patient search
        await page.screenshot({ 
          path: 'tavi-patient-search.png', 
          fullPage: true 
        });
        console.log('Patient search screenshot saved');

        // Try to enter a search term
        const searchInput = await page.$('input[placeholder*="Patient"]');
        if (searchInput) {
          console.log('Entering test patient search...');
          await searchInput.type('Test Patient');
          
          // Click search button
          const modalSearchButtons = await page.$$('button');
          let modalSearchButton = null;
          for (const button of modalSearchButtons) {
            const text = await button.evaluate(el => el.textContent);
            if (text && text.includes('Search')) {
              modalSearchButton = button;
              break;
            }
          }
          
          if (modalSearchButton) {
            console.log('Clicking search button...');
            await modalSearchButton.click();
            
            // Wait a bit for any errors to appear
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Take a screenshot after search
            await page.screenshot({ 
              path: 'tavi-after-search.png', 
              fullPage: true 
            });
            console.log('After search screenshot saved');
          }
        }
      }
    }

    // Check for any React errors in the console
    const errors = await page.evaluate(() => {
      return window.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__ || null;
    });

    if (errors) {
      console.log('React errors detected:', errors);
    }

    console.log('Test completed successfully');

  } catch (error) {
    console.error('Test error:', error.message);
    
    // Take a screenshot of the error state
    await page.screenshot({ 
      path: 'tavi-error.png', 
      fullPage: true 
    });
    console.log('Error screenshot saved as tavi-error.png');
  } finally {
    console.log('Closing browser...');
    await browser.close();
  }
}

// Run the test
testTAVIUI().catch(console.error);