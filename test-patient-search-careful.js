import puppeteer from 'puppeteer';

async function testPatientSearchCareful() {
  console.log('🔍 Testing Patient Search Carefully...');
  
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  try {
    console.log('📱 Navigating to TAVI app...');
    await page.goto('http://localhost:5173', { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });
    
    // Wait a bit more for everything to settle
    console.log('⏳ Waiting for page to fully load...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Open patient search modal
    console.log('🔍 Opening patient search modal...');
    const searchButtons = await page.$$('button');
    
    for (const button of searchButtons) {
      const text = await button.evaluate(el => el.textContent);
      if (text && text.includes('Search Patients')) {
        await button.click();
        break;
      }
    }

    // Wait for modal to fully open
    console.log('⏳ Waiting for modal to open completely...');
    await page.waitForSelector('.fixed.inset-0', { timeout: 5000 });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Find and click the search input
    console.log('🔍 Finding search input...');
    const searchInput = await page.$('input[placeholder*="Patient Name"]');
    
    if (searchInput) {
      // Click and wait
      await searchInput.click();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Type slowly
      console.log('⌨️ Typing "doe" slowly...');
      await page.keyboard.type('doe', { delay: 100 });
      
      // Press Enter after typing the name
      console.log('⏎ Pressing Enter to trigger search...');
      await page.keyboard.press('Enter');
      
      // Wait after pressing Enter
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Search should be triggered by Enter key press above
      console.log('⏳ Waiting for search results after Enter...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Take screenshot of search results
      await page.screenshot({ 
        path: 'doe-search-careful.png', 
        fullPage: true 
      });
      console.log('✅ Screenshot saved: doe-search-careful.png');
      
      // Check what patients are shown
      const searchResults = await page.evaluate(() => {
          // Look for patient entries in the first column
          const patientList = document.querySelector('.w-1\\/3:first-child');
          if (!patientList) return [];
          
          const patientElements = patientList.querySelectorAll('.p-4');
          const patients = [];
          
          patientElements.forEach(el => {
            const nameEl = el.querySelector('.font-medium');
            if (nameEl && nameEl.textContent) {
              patients.push(nameEl.textContent.trim());
            }
          });
          
          return patients;
      });
      
      console.log('\n📋 Search Results for "doe":');
      if (searchResults.length > 0) {
        searchResults.forEach((name, i) => {
          console.log(`${i + 1}. ${name}`);
        });
        
        // Check if any contain "doe"
        const doeMatches = searchResults.filter(name => 
          name.toLowerCase().includes('doe')
        );
        
        if (doeMatches.length > 0) {
          console.log(`\n✅ Found ${doeMatches.length} patients with "doe" in name!`);
          console.log('✅ Patient search filtering is working correctly');
        } else {
          console.log('\n❌ No patients with "doe" found');
          console.log('ℹ️ This might mean the search is working but no "doe" patients exist');
        }
      } else {
        console.log('❌ No search results found');
        console.log('ℹ️ Check if Orthanc server is running and has patient data');
      }
    } else {
      console.log('❌ Could not find search input');
    }

    console.log('\n🔍 Keeping browser open for manual inspection...');
    console.log('You can now manually test the search functionality');
    await new Promise(resolve => setTimeout(resolve, 30000));

  } catch (error) {
    console.error('❌ Test error:', error.message);
    
    await page.screenshot({ 
      path: 'search-test-error.png', 
      fullPage: true 
    });
  } finally {
    await browser.close();
  }
}

testPatientSearchCareful().catch(console.error);