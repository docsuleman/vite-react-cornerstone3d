import puppeteer from 'puppeteer';

async function testMedicalImages() {
  console.log('🏥 Testing Medical Image Loading...');
  
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Monitor console for VTK loading messages and errors
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      console.log('🔴 Console Error:', text);
    } else if (msg.type() === 'warning') {
      console.log('🟡 Console Warning:', text);
    } else if (text.includes('Image data loaded') || text.includes('VTK') || text.includes('loaded')) {
      console.log('📋 VTK Log:', text);
    }
  });

  try {
    console.log('📱 Navigating to TAVI app...');
    await page.goto('http://localhost:5173', { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });

    // Take initial screenshot
    await page.screenshot({ 
      path: 'medical-images-initial.png', 
      fullPage: true 
    });
    console.log('✅ Initial screenshot: medical-images-initial.png');

    // Try to select a patient to trigger image loading
    console.log('🔍 Testing patient selection workflow...');
    const searchButtons = await page.$$('button');
    
    for (const button of searchButtons) {
      const text = await button.evaluate(el => el.textContent);
      if (text && text.includes('Search Patients')) {
        await button.click();
        
        // Wait for modal
        await page.waitForSelector('.fixed.inset-0', { timeout: 5000 });
        
        // Try a mock patient selection by closing modal and advancing workflow
        await page.keyboard.press('Escape');
        break;
      }
    }

    // Try to advance to root definition stage to trigger MPR viewport
    console.log('🔄 Advancing to Root Definition stage...');
    const workflowStages = await page.$$('.cursor-pointer');
    
    if (workflowStages.length >= 2) {
      // Click Root Definition stage
      await workflowStages[1].click();
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for image loading
      
      await page.screenshot({ 
        path: 'medical-images-root-stage.png', 
        fullPage: true 
      });
      console.log('✅ Root stage screenshot: medical-images-root-stage.png');
    }

    // Check if any VTK canvas elements are present
    const vtkCanvasInfo = await page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll('canvas'));
      return canvases.map(canvas => ({
        width: canvas.width,
        height: canvas.height,
        style: canvas.style.cssText,
        parentClass: canvas.parentElement ? canvas.parentElement.className : 'none'
      }));
    });

    console.log('\n🖼️ VTK Canvas Elements Found:');
    if (vtkCanvasInfo.length > 0) {
      vtkCanvasInfo.forEach((canvas, i) => {
        console.log(`${i + 1}. Size: ${canvas.width}x${canvas.height}`);
        console.log(`   Parent: ${canvas.parentClass}`);
      });
    } else {
      console.log('❌ No canvas elements found - VTK may not be initializing');
    }

    // Check for VTK-related errors in the page
    const vtkErrors = await page.evaluate(() => {
      const errors = [];
      
      // Check if there are any error divs visible
      const errorDivs = document.querySelectorAll('[class*="error"], [class*="Error"]');
      errorDivs.forEach(div => {
        if (div.textContent) {
          errors.push(`Error div: ${div.textContent}`);
        }
      });
      
      return errors;
    });

    if (vtkErrors.length > 0) {
      console.log('\n❌ VTK Errors Found:');
      vtkErrors.forEach(error => console.log(error));
    }

    console.log('\n🎯 Medical Image Loading Test Results:');
    console.log('📸 Screenshots captured for analysis');
    console.log('🔍 Console logs monitored for VTK messages');
    console.log('🖼️ Canvas elements checked for VTK rendering');
    
    // Keep browser open for manual inspection
    console.log('\n🔍 Browser kept open for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 15000));

  } catch (error) {
    console.error('❌ Test error:', error.message);
    
    await page.screenshot({ 
      path: 'medical-images-error.png', 
      fullPage: true 
    });
  } finally {
    await browser.close();
  }
}

testMedicalImages().catch(console.error);