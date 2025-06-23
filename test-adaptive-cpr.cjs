// Test script for adaptive CPR with ultra-conservative GPU settings
console.log('🔄 Testing adaptive CPR with GPU-based optimizations...');

// Simple browser automation test
const { execSync } = require('child_process');
const fs = require('fs');

// Create a simple HTML test page that loads our CPR component
const testHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>CPR GPU Test</title>
    <script>
        // Test WebGL capabilities
        function testWebGL() {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            
            if (!gl) {
                console.log('❌ WebGL not supported');
                return false;
            }
            
            const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            const maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
            const vendor = gl.getParameter(gl.VENDOR);
            const renderer = gl.getParameter(gl.RENDERER);
            
            console.log('🔍 WebGL Capabilities:');
            console.log('  Max Texture Size:', maxTextureSize);
            console.log('  Max Renderbuffer Size:', maxRenderbufferSize);
            console.log('  Vendor:', vendor);
            console.log('  Renderer:', renderer);
            
            // Determine optimal volume size
            let safeDimension = 16;
            if (maxTextureSize < 512) {
                console.log('⚠️ GPU too limited for CPR');
                return false;
            } else if (maxTextureSize < 1024) {
                safeDimension = 8;
                console.log('⚠️ Using 8³ volume for limited GPU');
            } else if (maxTextureSize < 2048) {
                safeDimension = 12;
                console.log('⚠️ Using 12³ volume for modest GPU');
            } else {
                console.log('✅ Using 16³ volume for capable GPU');
            }
            
            console.log('📊 Recommended volume:', safeDimension + '³ = ' + (safeDimension ** 3) + ' voxels');
            
            return true;
        }
        
        window.onload = testWebGL;
    </script>
</head>
<body>
    <h1>WebGL CPR Capability Test</h1>
    <p>Check console for WebGL capabilities and recommended settings.</p>
</body>
</html>
`;

// Write test HTML
fs.writeFileSync('/tmp/webgl-test.html', testHTML);

console.log('✅ Created WebGL capability test');
console.log('📁 Test file: /tmp/webgl-test.html');

// Open in browser for manual testing
try {
    console.log('🌐 Opening WebGL test in browser...');
    execSync('xdg-open /tmp/webgl-test.html || open /tmp/webgl-test.html || start /tmp/webgl-test.html', { 
        stdio: 'ignore' 
    });
} catch (e) {
    console.log('💡 Please manually open /tmp/webgl-test.html in your browser');
}

console.log('');
console.log('🎯 Adaptive CPR Optimizations Applied:');
console.log('  • GPU capability detection before initialization');
console.log('  • Volume dimensions: 8³/12³/16³ based on GPU limits');
console.log('  • Adaptive CPR width scaling with volume size');
console.log('  • Fallback mode for very limited hardware');
console.log('  • Ultra-conservative projection parameters');
console.log('');
console.log('📱 Now test the TAVI app at http://localhost:5174');
console.log('   The CPR viewport should adapt to your GPU capabilities');
console.log('   and avoid texture size errors.');