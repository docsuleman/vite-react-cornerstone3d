import puppeteer from 'puppeteer';

async function testTailwindCSS() {
  console.log('🎨 Testing Tailwind CSS Configuration...');
  
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

    // Test if basic Tailwind classes are working
    const bgColorTest = await page.evaluate(() => {
      const element = document.querySelector('.bg-slate-900');
      if (element) {
        const styles = window.getComputedStyle(element);
        return {
          backgroundColor: styles.backgroundColor,
          color: styles.color,
          found: true
        };
      }
      return { found: false };
    });

    console.log('🔍 Tailwind CSS Test Results:');
    console.log('Background element found:', bgColorTest.found);
    if (bgColorTest.found) {
      console.log('Background color:', bgColorTest.backgroundColor);
      console.log('Text color:', bgColorTest.color);
    }

    // Check if any Tailwind classes are being applied
    const tailwindTest = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      const tailwindClasses = [];
      const computedStyles = [];
      
      for (let element of allElements) {
        const classList = Array.from(element.classList);
        const tailwindFound = classList.filter(cls => 
          cls.startsWith('bg-') || 
          cls.startsWith('text-') || 
          cls.startsWith('p-') || 
          cls.startsWith('m-') ||
          cls.startsWith('flex') ||
          cls.startsWith('border')
        );
        
        if (tailwindFound.length > 0) {
          const styles = window.getComputedStyle(element);
          tailwindClasses.push(...tailwindFound);
          computedStyles.push({
            classes: tailwindFound,
            backgroundColor: styles.backgroundColor,
            color: styles.color,
            padding: styles.padding,
            display: styles.display
          });
        }
      }
      
      return {
        foundClasses: [...new Set(tailwindClasses)].slice(0, 10), // First 10 unique classes
        sampleStyles: computedStyles.slice(0, 3) // First 3 styled elements
      };
    });

    console.log('\n🎯 Tailwind Classes Found:', tailwindTest.foundClasses);
    console.log('\n🎨 Sample Computed Styles:');
    tailwindTest.sampleStyles.forEach((style, i) => {
      console.log(`${i + 1}. Classes: ${style.classes.join(', ')}`);
      console.log(`   Background: ${style.backgroundColor}`);
      console.log(`   Color: ${style.color}`);
      console.log(`   Display: ${style.display}`);
      console.log('');
    });

    // Take screenshot
    await page.screenshot({ 
      path: 'tailwind-test.png', 
      fullPage: true 
    });
    console.log('✅ Screenshot saved: tailwind-test.png');

    // Check CSS loading
    const cssInfo = await page.evaluate(() => {
      const stylesheets = Array.from(document.styleSheets);
      return stylesheets.map(sheet => ({
        href: sheet.href,
        rulesCount: sheet.cssRules ? sheet.cssRules.length : 0,
        disabled: sheet.disabled
      }));
    });

    console.log('\n📋 CSS Files Loaded:');
    cssInfo.forEach((css, i) => {
      console.log(`${i + 1}. ${css.href || 'Inline styles'}`);
      console.log(`   Rules: ${css.rulesCount}, Disabled: ${css.disabled}`);
    });

    // Test specific Tailwind utilities
    const utilityTest = await page.evaluate(() => {
      // Create a test element to check if Tailwind utilities work
      const testDiv = document.createElement('div');
      testDiv.className = 'bg-red-500 text-white p-4 rounded-lg';
      document.body.appendChild(testDiv);
      
      const styles = window.getComputedStyle(testDiv);
      const result = {
        backgroundColor: styles.backgroundColor,
        color: styles.color,
        padding: styles.padding,
        borderRadius: styles.borderRadius
      };
      
      document.body.removeChild(testDiv);
      return result;
    });

    console.log('\n🧪 Utility Test (bg-red-500 text-white p-4 rounded-lg):');
    console.log('Background:', utilityTest.backgroundColor);
    console.log('Color:', utilityTest.color);
    console.log('Padding:', utilityTest.padding);
    console.log('Border Radius:', utilityTest.borderRadius);

    if (utilityTest.backgroundColor === 'rgb(239, 68, 68)') {
      console.log('✅ Tailwind CSS is working correctly!');
    } else {
      console.log('❌ Tailwind CSS may not be working properly');
      console.log('Expected bg-red-500 to be rgb(239, 68, 68)');
    }

    console.log('\n🔍 Browser kept open for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 10000));

  } catch (error) {
    console.error('❌ Test error:', error.message);
  } finally {
    await browser.close();
  }
}

testTailwindCSS().catch(console.error);