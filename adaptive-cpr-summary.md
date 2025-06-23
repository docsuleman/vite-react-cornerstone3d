# Adaptive CPR Viewport - Ultra-Conservative GPU Optimization

## Problem Solved
The CPR viewport was failing with WebGL texture size errors even with 32³ volume dimensions. The solution implements **adaptive GPU-based optimization** that adjusts volume parameters based on actual hardware capabilities.

## Key Innovations

### 1. GPU Capability Detection
```typescript
const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
const maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);

// Adaptive dimension selection
let safeDimension = 16;  // Default
if (maxTextureSize < 512) {
    useFallbackMode = true;  // Show error message
} else if (maxTextureSize < 1024) {
    safeDimension = 8;       // Ultra-conservative: 512 voxels
} else if (maxTextureSize < 2048) {
    safeDimension = 12;      // Conservative: 1,728 voxels
}
```

### 2. Adaptive Volume Scaling
- **8³ volume**: 512 voxels for very limited GPUs
- **12³ volume**: 1,728 voxels for modest GPUs  
- **16³ volume**: 4,096 voxels for capable GPUs
- **Graceful fallback**: Error message for GPUs < 512 texture size

### 3. Proportional Parameter Scaling
```typescript
// CPR width scales with volume size
const volumeSize = Math.max(...imageDimensions);
const adaptiveWidth = Math.max(volumeSize * 2, 10);

// Vessel geometry scales with volume
const curveFactor = Math.max(dimensions[0] / 16, 0.5);
const vesselRadius = Math.max(2 * curveFactor, 1);
```

### 4. Ultra-Conservative Projection Settings
- **Thickness**: 5 world units (reduced from 20)
- **Samples**: 3 (reduced from 10)
- **Width**: Adaptive 16-32 units (reduced from 80)

## Expected Compatibility

| GPU Capability | Max Texture | Volume Size | Status |
|---------------|-------------|-------------|---------|
| Very Limited  | < 512       | Fallback    | ❌ Shows error message |
| Limited       | 512-1024    | 8³ (512)    | ✅ Should work |
| Modest        | 1024-2048   | 12³ (1.7K)  | ✅ Should work well |
| Capable       | > 2048      | 16³ (4K)    | ✅ Full quality |

## Memory Usage Comparison

| Configuration | Voxels | Memory | Reduction |
|--------------|--------|--------|-----------|
| Original 64³ | 262K   | ~1MB   | Baseline |
| Conservative 32³ | 33K | ~128KB | 87% |
| Adaptive 16³ | 4K     | ~16KB  | 98.5% |
| Ultra 8³     | 512    | ~2KB   | 99.8% |

## Technical Implementation

### GPU Detection
```typescript
// Check WebGL context before VTK initialization
const canvas = document.createElement('canvas');
const gl = canvas.getContext('webgl');
const capabilities = {
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    vendor: gl.getParameter(gl.VENDOR),
    renderer: gl.getParameter(gl.RENDERER)
};
```

### Adaptive Volume Generation
```typescript
const createSyntheticVolumeData = (customDimensions?: number[]) => {
    const dimensions = customDimensions || [16, 16, 16];
    // Vessel geometry scales proportionally
    const curveFactor = Math.max(dimensions[0] / 16, 0.5);
    // All parameters adapt to volume size
};
```

## Testing Strategy

1. **GPU Capability Test**: Run WebGL detection script
2. **Volume Scaling Test**: Verify dimensions adapt correctly
3. **Render Quality Test**: Ensure CPR still shows straightened vessel
4. **Error Recovery Test**: Verify graceful fallback for limited hardware

## Expected Results

✅ **Eliminates WebGL texture size errors**  
✅ **Works on low-end integrated graphics**  
✅ **Maintains CPR straightening functionality**  
✅ **Provides informative error messages for unsupported hardware**  
✅ **Automatically optimizes for available GPU capability**

The adaptive approach ensures the CPR viewport works across the widest range of hardware while maintaining the core straightened vessel visualization that demonstrates how the technique would work with real DICOM data.