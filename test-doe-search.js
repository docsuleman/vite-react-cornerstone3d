import puppeteer from 'puppeteer';

async function testDoeSearch() {
  console.log('🔍 Testing Patient Search for "doe"...');
  
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Monitor console for DICOM/search messages
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Error searching patients') || text.includes('Found patients') || text.includes('search')) {
      console.log('📋 Search Log:', text);
    }
  });

  try {
    console.log('📱 Navigating to TAVI app...');
    await page.goto('http://localhost:5173', { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });

    // Open patient search
    console.log('🔍 Opening patient search modal...');
    const searchButtons = await page.$$('button');
    
    for (const button of searchButtons) {
      const text = await button.evaluate(el => el.textContent);
      if (text && text.includes('Search Patients')) {
        await button.click();
        
        // Wait for modal
        await page.waitForSelector('.fixed.inset-0', { timeout: 5000 });
        break;
      }
    }

    // Test search for "doe"
    console.log('🔍 Searching for "doe"...');
    const searchInput = await page.$('input[placeholder*="Patient Name"]');
    if (searchInput) {
      await searchInput.click();
      await page.keyboard.type('doe');
      
      // Click search button
      const searchButton = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(btn => btn.textContent?.includes('Search'));
      });
      
      if (searchButton) {
        await searchButton.click();
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for search
        
        // Check what patients are shown
        const searchResults = await page.evaluate(() => {
          // Look for patient entries in the patients list
          const patientElements = document.querySelectorAll('.w-1\\/3:first-child .p-4');
          const patients = [];
          
          patientElements.forEach(el => {
            const nameEl = el.querySelector('.font-medium');
            const idEl = el.querySelector('.text-sm');
            if (nameEl && nameEl.textContent) {
              patients.push({
                name: nameEl.textContent.trim(),
                id: idEl ? idEl.textContent.trim() : 'N/A'
              });
            }
          });
          
          return patients;
        });
        
        console.log('\n📋 Search Results for "doe":');
        if (searchResults.length > 0) {
          searchResults.forEach((patient, i) => {
            console.log(`${i + 1}. ${patient.name} - ${patient.id}`);
          });
          
          // Check if results contain "doe"
          const doeResults = searchResults.filter(p => 
            p.name.toLowerCase().includes('doe')
          );
          
          if (doeResults.length > 0) {
            console.log(`✅ Found ${doeResults.length} patients with "doe" in name`);
            
            // Try selecting a patient
            if (searchResults.length > 0) {
              console.log('🔍 Attempting to select first patient...');
              const firstPatient = await page.$('.w-1\\/3:first-child .p-4');
              if (firstPatient) {
                await firstPatient.click();
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Check if studies loaded
                const studyCount = await page.evaluate(() => {
                  const studyElements = document.querySelectorAll('.w-1\\/3:nth-child(2) .p-4');
                  return studyElements.length;
                });
                
                console.log(`📋 Studies loaded: ${studyCount}`);
                
                if (studyCount > 0) {
                  // Try selecting a study
                  const firstStudy = await page.$('.w-1\\/3:nth-child(2) .p-4');
                  if (firstStudy) {
                    await firstStudy.click();
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Check if series loaded
                    const seriesCount = await page.evaluate(() => {
                      const seriesElements = document.querySelectorAll('.w-1\\/3:nth-child(3) .p-4');
                      return seriesElements.length;
                    });
                    
                    console.log(`📋 Series loaded: ${seriesCount}`);
                    
                    if (seriesCount > 0) {
                      console.log('🎯 Attempting to select a series...');
                      const firstSeries = await page.$('.w-1\\/3:nth-child(3) .p-4');
                      if (firstSeries) {
                        await firstSeries.click();
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                        console.log('✅ Series selected! Checking if DICOM viewport loads...');
                      }
                    }
                  }
                }
              }
            }
          } else {
            console.log('❌ No patients with "doe" found in results');
          }
        } else {
          console.log('❌ No search results found');
        }
        
        await page.screenshot({ 
          path: 'doe-search-results.png', 
          fullPage: true 
        });
        console.log('✅ Screenshot saved: doe-search-results.png');
      }
    }

    console.log('\n🔍 Browser kept open for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 15000));

  } catch (error) {
    console.error('❌ Test error:', error.message);
    
    await page.screenshot({ 
      path: 'doe-search-error.png', 
      fullPage: true 
    });
  } finally {
    await browser.close();
  }
}

testDoeSearch().catch(console.error);