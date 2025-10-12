# 3D Volume Rendering - Documentation

## Overview

**3D Volume Rendering** creates volumetric visualizations of medical imaging data, allowing users to see anatomy in three dimensions with depth perception and spatial relationships.

**Source**: Official Cornerstone.js example - https://www.cornerstonejs.org/live-examples/volumeviewport3d

## What is 3D Volume Rendering?

Unlike 2D slice viewing (MPR), 3D volume rendering:
- **Displays** the entire volume as a 3D object
- **Applies** transfer functions to map tissue densities to colors/opacity
- **Enables** rotation and interactive 3D manipulation
- **Shows** spatial relationships between structures

### Visual Comparison

```
2D Slice (MPR)              3D Volume Rendering
┌─────────────┐            ┌─────────────┐
│   ═══       │            │   ╱╲╱╲      │
│  ═════      │            │  ╱    ╲     │
│   ═══       │            │ │  3D  │    │
│             │            │  ╲    ╱     │
└─────────────┘            │   ╲╱╲╱      │
Single slice               └─────────────┘
                           Entire volume
```

## Key Features

### 1. Viewport Type: VOLUME_3D
Special viewport type designed for volumetric rendering:
- Uses GPU-accelerated ray casting
- Supports interactive rotation/zoom/pan
- Different from ORTHOGRAPHIC (slice-based)

### 2. Rendering Presets
Pre-configured transfer functions for different tissue types:
- **CT-Bone**: Highlights skeletal structures
- **CT-Cardiac**: Optimized for heart and vessels
- **CT-Chest**: Lung and thoracic visualization
- **MIP**: Maximum Intensity Projection (vessels)
- **PET**: Nuclear medicine visualization

### 3. Quality Control (Sample Distance)
Balance between quality and performance:
- **Lower values**: Higher quality, slower rendering
- **Higher values**: Lower quality, faster rendering
- **Range**: 1 (best) to 16 (fastest)

### 4. Interactive Manipulation
- **Trackball rotation**: Rotate volume in 3D space
- **Zoom**: Scale visualization
- **Pan**: Translate view
- **Preset rotation**: Set specific angles

## Implementation

### Basic Setup

```typescript
import { setup3DVolumeViewport, Volume3DPresets } from '@/utils/volume3DExample';

// Setup 3D viewport
const viewport = await setup3DVolumeViewport({
  viewportId: 'volume3D',
  element: document.getElementById('viewport3D'),
  volumeId: 'myVolumeId',
  renderingEngineId: 'myEngine',
  preset: Volume3DPresets.CT_BONE,
  sampleDistanceMultiplier: 2
});
```

### Change Rendering Preset

```typescript
import { changeVolume3DPreset, Volume3DPresets } from '@/utils/volume3DExample';

// Switch to cardiac preset
changeVolume3DPreset(viewport, Volume3DPresets.CT_CARDIAC);

// Switch to MIP for vascular visualization
changeVolume3DPreset(viewport, Volume3DPresets.MIP);
```

### Adjust Quality

```typescript
import { setSampleDistance, SampleDistanceMultipliers } from '@/utils/volume3DExample';

// High quality for static viewing
setSampleDistance(viewport, SampleDistanceMultipliers.HIGHEST_QUALITY); // 1

// Balanced for interaction
setSampleDistance(viewport, SampleDistanceMultipliers.BALANCED); // 4

// Draft mode for fast preview
setSampleDistance(viewport, SampleDistanceMultipliers.DRAFT); // 16
```

### Rotation Control

```typescript
import { setRotation, applyRandomRotation } from '@/utils/volume3DExample';

// Set specific rotation
setRotation(viewport, 45); // 45 degrees

// Random rotation (testing)
applyRandomRotation(viewport);

// Reset to default
viewport.resetCamera();
```

## React Integration Example

```typescript
import { useEffect, useRef, useState } from 'react';
import { setup3DVolumeViewport, changeVolume3DPreset, setSampleDistance } from '@/utils/volume3DExample';
import type { Types } from '@cornerstonejs/core';

const Volume3DViewer = ({ volumeId, renderingEngineId }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportInstanceRef = useRef<Types.IVolumeViewport>(null);
  const [preset, setPreset] = useState('CT-Bone');
  const [quality, setQuality] = useState(2);

  useEffect(() => {
    if (!viewportRef.current) return;

    const initViewport = async () => {
      const viewport = await setup3DVolumeViewport({
        viewportId: 'volume3D',
        element: viewportRef.current!,
        volumeId,
        renderingEngineId,
        preset: 'CT-Bone',
        sampleDistanceMultiplier: 2
      });

      viewportInstanceRef.current = viewport;
    };

    initViewport();
  }, [volumeId, renderingEngineId]);

  const handlePresetChange = (newPreset: string) => {
    setPreset(newPreset);
    if (viewportInstanceRef.current) {
      changeVolume3DPreset(viewportInstanceRef.current, newPreset);
    }
  };

  const handleQualityChange = (newQuality: number) => {
    setQuality(newQuality);
    if (viewportInstanceRef.current) {
      setSampleDistance(viewportInstanceRef.current, newQuality);
    }
  };

  return (
    <div>
      <div className="controls">
        <label>
          Preset:
          <select value={preset} onChange={(e) => handlePresetChange(e.target.value)}>
            <option value="CT-Bone">CT-Bone</option>
            <option value="CT-Cardiac">CT-Cardiac</option>
            <option value="CT-Chest">CT-Chest</option>
            <option value="MIP">MIP</option>
          </select>
        </label>

        <label>
          Quality: {quality}
          <input
            type="range"
            min="1"
            max="16"
            value={quality}
            onChange={(e) => handleQualityChange(Number(e.target.value))}
          />
          <span>{quality === 1 ? 'Best' : quality >= 8 ? 'Fast' : 'Balanced'}</span>
        </label>
      </div>

      <div
        ref={viewportRef}
        className="viewport-3d"
        style={{ width: '500px', height: '500px', background: '#000' }}
      />
    </div>
  );
};
```

## Integration with ProperMPRViewport

For our TAVI workflow, we use 3D viewport in ROOT_DEFINITION stage:

```typescript
// In ProperMPRViewport.tsx

import { setup3DVolumeViewport, Volume3DPresets } from '@/utils/volume3DExample';

useEffect(() => {
  if (currentStage !== WorkflowStage.ROOT_DEFINITION) return;
  if (!elementRefs.volume3D?.current) return;

  const init3DViewport = async () => {
    try {
      const viewport = await setup3DVolumeViewport({
        viewportId: 'volume3D',
        element: elementRefs.volume3D.current!,
        volumeId: volumeId,
        renderingEngineId: 'mprEngine',
        preset: Volume3DPresets.CT_CARDIAC, // TAVI uses cardiac preset
        sampleDistanceMultiplier: 4 // Balanced for interaction
      });

      console.log('✅ 3D viewport initialized for ROOT_DEFINITION');
    } catch (error) {
      console.error('Failed to initialize 3D viewport:', error);
    }
  };

  init3DViewport();
}, [currentStage, volumeId]);
```

## Rendering Presets

### Available Presets

| Preset | Best For | Typical Use |
|--------|----------|-------------|
| **CT-Bone** | Skeletal structures | Orthopedic surgery, fracture analysis |
| **CT-Cardiac** | Heart and vessels | TAVI planning, cardiac assessment |
| **CT-Chest** | Lungs and thorax | Pulmonary imaging, chest CT |
| **CT-Abdomen** | Abdominal organs | Abdominal surgery planning |
| **CT-Lungs** | Lung parenchyma | Detailed lung imaging |
| **MIP** | Vascular structures | Angiography, vessel visualization |
| **PET** | Nuclear medicine | PET scan visualization |

### Choosing the Right Preset

```typescript
// TAVI Planning: Use CT-Cardiac
changeVolume3DPreset(viewport, 'CT-Cardiac');

// Bone surgery: Use CT-Bone
changeVolume3DPreset(viewport, 'CT-Bone');

// Vascular assessment: Use MIP
changeVolume3DPreset(viewport, 'MIP');
```

## Quality vs Performance

### Sample Distance Guidelines

```typescript
// Highest Quality (1-2): Use when viewing is static
setSampleDistance(viewport, 1);
// - Best image quality
// - Slowest rendering
// - Use for: Final review, screenshots, presentations

// Balanced (3-5): Default for interactive viewing
setSampleDistance(viewport, 4);
// - Good quality
// - Smooth interaction
// - Use for: General viewing, measurements

// Performance (6-10): Fast interaction
setSampleDistance(viewport, 8);
// - Lower quality
// - Very responsive
// - Use for: Quick orientation, rapid navigation

// Draft (11-16): Preview mode
setSampleDistance(viewport, 16);
// - Lowest quality
// - Maximum speed
// - Use for: Initial loading, testing
```

### Dynamic Quality Adjustment

```typescript
// Reduce quality during interaction, increase when static
let interactionTimeout: NodeJS.Timeout;

viewport.element.addEventListener('mousedown', () => {
  // Lower quality during manipulation
  setSampleDistance(viewport, 8);

  // Clear existing timeout
  clearTimeout(interactionTimeout);
});

viewport.element.addEventListener('mouseup', () => {
  // Restore quality after interaction stops
  interactionTimeout = setTimeout(() => {
    setSampleDistance(viewport, 2);
  }, 500); // Wait 500ms after interaction stops
});
```

## Camera Control

### Rotation

```typescript
// Set specific rotation angle
setRotation(viewport, 90); // 90 degrees

// Apply view presentation with rotation
viewport.setViewPresentation({ rotation: 45 });
```

### Reset Camera

```typescript
// Reset to default view
viewport.resetCamera();
viewport.render();
```

### Custom Camera Position

```typescript
// Advanced: Set custom camera
const camera = viewport.getCamera();
viewport.setCamera({
  ...camera,
  position: [100, 100, 100],
  focalPoint: [0, 0, 0],
  viewUp: [0, 0, 1]
});
```

## Use Cases

### 1. TAVI Planning (Our Application)

```typescript
// 4-viewport layout: 3 MPR + 1 3D
// Root definition stage shows 3D cardiac anatomy
setup3DVolumeViewport({
  viewportId: 'volume3D',
  element: volume3DElement,
  volumeId: volumeId,
  renderingEngineId: 'taviEngine',
  preset: 'CT-Cardiac',
  sampleDistanceMultiplier: 4
});
```

### 2. Surgical Planning

```typescript
// High-quality bone visualization
setup3DVolumeViewport({
  preset: 'CT-Bone',
  sampleDistanceMultiplier: 1 // Highest quality
});
```

### 3. Vascular Assessment

```typescript
// MIP for vessel visualization
setup3DVolumeViewport({
  preset: 'MIP',
  sampleDistanceMultiplier: 2
});
```

### 4. Quick Preview

```typescript
// Fast preview mode
setup3DVolumeViewport({
  preset: 'CT-Bone',
  sampleDistanceMultiplier: 16 // Fastest
});
```

## Troubleshooting

### Issue: Black screen / No rendering

**Solutions:**
1. **Check viewport type**: Must be `ViewportType.VOLUME_3D`
   ```typescript
   type: ViewportType.VOLUME_3D  // Correct
   type: ViewportType.ORTHOGRAPHIC  // Wrong for 3D
   ```

2. **Ensure volume is loaded**:
   ```typescript
   await volume.load();
   await setVolumesForViewports(engine, [{ volumeId }], [viewportId]);
   ```

3. **Check GPU support**: 3D rendering requires WebGL2

### Issue: Poor performance / Laggy rotation

**Solutions:**
1. **Increase sample distance**:
   ```typescript
   setSampleDistance(viewport, 8); // Faster rendering
   ```

2. **Use dynamic quality**: Lower quality during interaction

3. **Check GPU**: Ensure hardware acceleration enabled

### Issue: Wrong colors / Unexpected appearance

**Solutions:**
1. **Try different presets**:
   ```typescript
   // If CT-Bone looks wrong, try CT-Cardiac
   changeVolume3DPreset(viewport, 'CT-Cardiac');
   ```

2. **Check modality**: Ensure using CT preset for CT data

3. **Verify volume data**: Ensure image data is loaded correctly

### Issue: Cannot rotate viewport

**Solutions:**
1. **Add manipulation tools**:
   ```typescript
   import { TrackballRotateTool } from '@cornerstonejs/tools';

   toolGroup.addTool(TrackballRotateTool.toolName);
   toolGroup.setToolActive(TrackballRotateTool.toolName, {
     bindings: [{ mouseButton: MouseBindings.Primary }]
   });
   ```

2. **Check tool group**: Ensure viewport is added to tool group

## Performance Optimization

### Best Practices

1. **Use appropriate quality settings**:
   - Static viewing: Sample distance 1-2
   - Interactive: Sample distance 4-6
   - Preview: Sample distance 8-16

2. **Dispose when not needed**:
   ```typescript
   // When switching away from 3D viewport
   renderingEngine.disableElement(viewportId);
   ```

3. **Monitor memory usage**: 3D viewports use significant GPU memory

4. **Limit concurrent 3D viewports**: Typically 1-2 per page

### Performance Metrics

| Quality | Sample Distance | FPS (typical) | Use Case |
|---------|----------------|---------------|----------|
| Highest | 1 | 10-20 | Static review |
| High | 2 | 20-30 | Quality viewing |
| Balanced | 4 | 30-50 | General use |
| Performance | 8 | 50-60 | Fast interaction |
| Draft | 16 | 60+ | Preview |

## API Reference

### Helper Functions (from `src/utils/volume3DExample.ts`)

#### `setup3DVolumeViewport(config)`
Creates and configures a 3D volume viewport.

**Parameters:**
- `config.viewportId`: Viewport identifier
- `config.element`: HTML element for rendering
- `config.volumeId`: Volume data identifier
- `config.renderingEngineId`: Rendering engine ID
- `config.preset`: Rendering preset (optional)
- `config.sampleDistanceMultiplier`: Quality setting (optional)

#### `changeVolume3DPreset(viewport, presetName)`
Changes the rendering preset.

#### `setSampleDistance(viewport, multiplier)`
Adjusts rendering quality (1-16).

#### `setRotation(viewport, angle)`
Sets rotation angle in degrees.

#### `applyRandomRotation(viewport)`
Applies random rotation (testing).

#### `resetCamera(viewport)`
Resets camera to default position.

## See Also

- **Source Code**: `src/utils/volume3DExample.ts`
- **Official Example**: https://www.cornerstonejs.org/live-examples/volumeviewport3d
- **ProperMPRViewport**: Integration in our TAVI application
- **Volume Loading**: Required before 3D rendering
- **GPU Requirements**: WebGL2 support needed
