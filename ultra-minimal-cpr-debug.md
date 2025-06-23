# Ultra-Minimal CPR Debug - Powerful GPU Texture Size Issue

## Problem Analysis
Even with a powerful NVIDIA GPU, the VTK.js ImageCPRMapper is creating internal textures larger than GPU limits. The errors occur on **interaction** (clicks), not initialization, indicating the CPR mapper creates massive framebuffers during user interaction.

## Root Cause
The ImageCPRMapper likely creates textures sized as:
- **Width**: CPR width parameter 
- **Height**: Centerline length × some multiplier
- **Internal buffers**: Projection parameters create additional large textures

Even with small input volumes, the CPR output texture can be huge.

## Ultra-Minimal Settings Applied

### Volume Data
```typescript
dimensions: [8, 8, 8]          // Only 512 voxels total
spacing: [8.0, 8.0, 8.0]      // Large spacing for same physical size
```

### Centerline
```typescript
numInterpolatedPoints: 20      // Reduced from 100
```

### CPR Mapper
```typescript
width: 8                       // Ultra-minimal width (was 80)
projectionSlabThickness: 1     // Minimal thickness (was 20)
projectionSlabNumberOfSamples: 1  // Single sample (was 10)
```

### Camera
```typescript
parallelScale: 10              // Minimal scale (was 50)
```

## Debug Points Added
1. ✅ GPU capability logging (max texture size, vendor, renderer)
2. ✅ Widget creation error handling
3. ✅ CPR manipulator setup error handling  
4. ✅ Widget positioning fallbacks
5. ✅ Render error handling

## Testing Strategy
1. **Test Current Settings**: See if ultra-minimal works
2. **Isolate Texture Creation**: Find exactly where WebGL error occurs
3. **Alternative Approach**: If VTK.js ImageCPRMapper is fundamentally broken, implement simpler CPR

## Expected WebGL Error Points
- `widget.setManipulator(cprManipulator)` - Might create textures
- `cprManipulator.distanceEvent()` - Might trigger CPR computation
- User click interaction - Definitely triggers texture creation

## Fallback Plan
If ultra-minimal settings still fail, implement a **Simple CPR Simulation**:
- Take 2D slices along the centerline 
- Concatenate them side-by-side
- Show as "straightened" view without full CPR mapper

This would demonstrate the CPR concept without VTK.js texture issues.

## Test Now
Run the app and check console for:
- GPU capabilities logged
- "Ultra-minimal CPR width: 8"
- Any errors during widget/manipulator setup
- WebGL errors on click interaction