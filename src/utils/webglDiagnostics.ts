/**
 * WebGL Diagnostics Utility
 * 
 * Provides comprehensive WebGL environment validation and diagnostics
 * for medical imaging applications requiring hardware acceleration.
 */

export interface WebGLDiagnostics {
  supported: boolean;
  version: string;
  vendor: string;
  renderer: string;
  maxTextureSize: number;
  maxViewportDims: number[];
  extensions: string[];
  issues: string[];
  recommendations: string[];
}

export const performWebGLDiagnostics = (): WebGLDiagnostics => {
  const diagnostics: WebGLDiagnostics = {
    supported: false,
    version: '',
    vendor: '',
    renderer: '',
    maxTextureSize: 0,
    maxViewportDims: [0, 0],
    extensions: [],
    issues: [],
    recommendations: []
  };

  try {
    // Check basic WebGL support
    if (!window.WebGLRenderingContext) {
      diagnostics.issues.push('WebGL is not supported in this browser');
      diagnostics.recommendations.push('Use a modern browser (Chrome, Firefox, Safari, Edge)');
      return diagnostics;
    }

    // Create test canvas
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;

    // Try to get WebGL2 context first, then fallback to WebGL1
    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
    
    try {
      gl = canvas.getContext('webgl2', {
        preserveDrawingBuffer: true,
        premultipliedAlpha: false,
        antialias: true,
        alpha: false,
        depth: true,
        stencil: false,
        powerPreference: 'high-performance'
      });
      
      if (!gl) {
        gl = canvas.getContext('webgl', {
          preserveDrawingBuffer: true,
          premultipliedAlpha: false,
          antialias: true,
          alpha: false,
          depth: true,
          stencil: false,
          powerPreference: 'high-performance'
        });
      }
    } catch (contextError) {
      diagnostics.issues.push(`WebGL context creation failed: ${contextError}`);
    }

    if (!gl) {
      diagnostics.issues.push('Unable to create WebGL context');
      diagnostics.recommendations.push('Check if WebGL is enabled in browser settings');
      diagnostics.recommendations.push('Update graphics drivers');
      diagnostics.recommendations.push('Try closing other tabs using 3D graphics');
      return diagnostics;
    }

    // Check for context loss
    if (gl.isContextLost()) {
      diagnostics.issues.push('WebGL context is lost');
      diagnostics.recommendations.push('Refresh the page');
      diagnostics.recommendations.push('Check for GPU driver issues');
    }

    // Gather basic information
    diagnostics.supported = true;
    diagnostics.version = gl.getParameter(gl.VERSION) || 'Unknown';
    diagnostics.vendor = gl.getParameter(gl.VENDOR) || 'Unknown';
    diagnostics.renderer = gl.getParameter(gl.RENDERER) || 'Unknown';
    diagnostics.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
    diagnostics.maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [0, 0];

    // Get supported extensions
    const supportedExtensions = gl.getSupportedExtensions();
    if (supportedExtensions) {
      diagnostics.extensions = supportedExtensions;
    }

    // Check for specific issues and provide recommendations
    
    // Check texture size
    if (diagnostics.maxTextureSize < 2048) {
      diagnostics.issues.push('Maximum texture size is very small');
      diagnostics.recommendations.push('GPU may be too old for medical imaging');
    }

    // Check for software rendering
    if (diagnostics.renderer.toLowerCase().includes('software') || 
        diagnostics.renderer.toLowerCase().includes('swiftshader') ||
        diagnostics.renderer.toLowerCase().includes('mesa')) {
      diagnostics.issues.push('Software rendering detected');
      diagnostics.recommendations.push('Enable hardware acceleration in browser settings');
      diagnostics.recommendations.push('Update graphics drivers');
    }

    // Check for integrated graphics limitations
    if (diagnostics.renderer.toLowerCase().includes('intel') && 
        diagnostics.maxTextureSize < 4096) {
      diagnostics.issues.push('Integrated graphics may have performance limitations');
      diagnostics.recommendations.push('Consider using a dedicated graphics card for better performance');
    }

    // Check critical extensions for medical imaging
    const criticalExtensions = [
      'OES_texture_float',
      'OES_texture_half_float',
      'WEBGL_depth_texture'
    ];

    criticalExtensions.forEach(ext => {
      if (!diagnostics.extensions.includes(ext)) {
        diagnostics.issues.push(`Missing critical extension: ${ext}`);
      }
    });

    // Clean up test context
    try {
      const loseContext = gl.getExtension('WEBGL_lose_context');
      if (loseContext) {
        loseContext.loseContext();
      }
    } catch (cleanupError) {
    }

    canvas.remove();

  } catch (error) {
    diagnostics.issues.push(`WebGL diagnostics failed: ${error}`);
    diagnostics.recommendations.push('Check browser console for detailed error information');
  }

  return diagnostics;
};

export const logWebGLDiagnostics = (diagnostics: WebGLDiagnostics): void => {
  console.group('🔍 WebGL Diagnostics Report');
  
  if (diagnostics.supported) {
  }

  if (diagnostics.issues.length > 0) {
    console.group('⚠️ Issues Detected');
    diagnostics.issues.forEach(issue => console.warn(`- ${issue}`));
    console.groupEnd();
  }

  if (diagnostics.recommendations.length > 0) {
    console.group('💡 Recommendations');
    diagnostics.recommendations.forEach(rec => console.info(`- ${rec}`));
    console.groupEnd();
  }

  console.groupEnd();
};

export const isWebGLSuitableForMedicalImaging = (diagnostics: WebGLDiagnostics): boolean => {
  if (!diagnostics.supported) return false;
  if (diagnostics.maxTextureSize < 2048) return false;
  if (diagnostics.issues.some(issue => 
    issue.includes('Software rendering') || 
    issue.includes('context is lost')
  )) return false;
  
  return true;
};