# Reference Lines Tool - Documentation

## Overview

The **ReferenceLinesTool** displays intersection lines between viewports, helping users understand the spatial relationship between different slice orientations in medical imaging.

**Source**: Official Cornerstone.js example - https://www.cornerstonejs.org/live-examples/referencelines

## What are Reference Lines?

Reference lines are visual indicators that show:
- **Where** a viewport's imaging plane intersects with other viewports
- **How** different slice orientations relate spatially
- **Which** slice position you're viewing across all viewports

### Visual Example

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   AXIAL     │  │  SAGITTAL   │  │  CORONAL    │
│             │  │      │      │  │             │
│  ────────   │  │      │      │  │  ────────   │
│  │SOURCE│   │  │      ▼      │  │             │
│  ────────   │  │             │  │      │      │
└─────────────┘  └─────────────┘  └─────────────┘
     (source)      (shows line)     (shows line)

When AXIAL is source:
- Sagittal shows VERTICAL line (where axial plane intersects)
- Coronal shows HORIZONTAL line (where axial plane intersects)
```

## Key Features

### 1. Dynamic Source Selection
- Select any viewport as the "source"
- Other viewports show where source plane intersects
- Source viewport itself doesn't show lines

### 2. Full Dimension Mode
- **Normal mode**: Shows only visible portion of line
- **Full dimension**: Extends line across entire viewport

### 3. Multi-Viewport Support
- Works with Stack viewports
- Works with Orthographic volume viewports
- Handles oblique orientations

### 4. Automatic Updates
- Lines update when source viewport scrolls
- Lines update when source viewport orientation changes
- Real-time synchronization

## Implementation

### Basic Setup

```typescript
import { ReferenceLinesTool, ToolGroupManager } from '@cornerstonejs/tools';
import { setupReferenceLinesTool } from '@/utils/referenceLinesExample';

// 1. Create tool group
const toolGroup = ToolGroupManager.createToolGroup('myToolGroup');

// 2. Setup reference lines
setupReferenceLinesTool(toolGroup, {
  sourceViewportId: 'axial',  // Which viewport is the source
  showFullDimension: false     // Show only visible portion
});

// 3. Add viewports to tool group
toolGroup.addViewport('axial', renderingEngineId);
toolGroup.addViewport('sagittal', renderingEngineId);
toolGroup.addViewport('coronal', renderingEngineId);
```

### Change Source Viewport

```typescript
import { updateReferenceLineSource } from '@/utils/referenceLinesExample';

// When user clicks a different viewport
const handleViewportClick = (viewportId: string) => {
  updateReferenceLineSource(toolGroup, viewportId);

  // Optional: Update UI to show which viewport is selected
  highlightViewport(viewportId);
};
```

### Toggle Full Dimension

```typescript
import { toggleFullDimensionLines } from '@/utils/referenceLinesExample';

const handleFullDimensionToggle = (enabled: boolean) => {
  toggleFullDimensionLines(toolGroup, enabled);
};
```

## React Integration Example

```typescript
import { useEffect, useRef, useState } from 'react';
import { ToolGroupManager } from '@cornerstonejs/tools';
import {
  setupReferenceLinesTool,
  updateReferenceLineSource
} from '@/utils/referenceLinesExample';

const MPRViewport = () => {
  const [sourceViewportId, setSourceViewportId] = useState('axial');
  const [showFullDimension, setShowFullDimension] = useState(false);
  const toolGroupRef = useRef(null);

  useEffect(() => {
    const toolGroup = ToolGroupManager.createToolGroup('mprToolGroup');
    toolGroupRef.current = toolGroup;

    // Setup reference lines
    setupReferenceLinesTool(toolGroup, {
      sourceViewportId: 'axial',
      showFullDimension: false
    });

    // Add viewports
    ['axial', 'sagittal', 'coronal'].forEach(id => {
      toolGroup.addViewport(id, 'myRenderingEngine');
    });

    return () => {
      ToolGroupManager.destroyToolGroup('mprToolGroup');
    };
  }, []);

  const handleViewportClick = (viewportId: string) => {
    setSourceViewportId(viewportId);
    if (toolGroupRef.current) {
      updateReferenceLineSource(toolGroupRef.current, viewportId);
    }
  };

  return (
    <div>
      <div className="controls">
        <label>
          <input
            type="checkbox"
            checked={showFullDimension}
            onChange={(e) => {
              setShowFullDimension(e.target.checked);
              toggleFullDimensionLines(toolGroupRef.current, e.target.checked);
            }}
          />
          Show Full Dimension Lines
        </label>
      </div>

      <div className="viewports">
        <div
          onClick={() => handleViewportClick('axial')}
          className={sourceViewportId === 'axial' ? 'selected' : ''}
        >
          <div ref={axialRef} />
        </div>
        {/* ... other viewports */}
      </div>
    </div>
  );
};
```

## Configuration Options

### ReferenceLinesTool Configuration

```typescript
interface ReferenceLinesConfig {
  sourceViewportId: string;      // Which viewport to use as source
  showFullDimension?: boolean;    // Show full lines (default: false)
}
```

### Tool Setup

```typescript
// Method 1: Using helper function
setupReferenceLinesTool(toolGroup, {
  sourceViewportId: 'axial',
  showFullDimension: false
});

// Method 2: Manual setup
cornerstoneTools.addTool(ReferenceLinesTool);
toolGroup.addTool(ReferenceLinesTool.toolName, {
  sourceViewportId: 'axial',
  showFullDimension: false
});
toolGroup.setToolEnabled(ReferenceLinesTool.toolName);
```

### Dynamic Updates

```typescript
// Change source viewport
toolGroup.setToolConfiguration(ReferenceLinesTool.toolName, {
  sourceViewportId: 'sagittal'
});

// Toggle full dimension
toolGroup.setToolConfiguration(ReferenceLinesTool.toolName, {
  showFullDimension: true
});

// Re-enable to apply changes
toolGroup.setToolEnabled(ReferenceLinesTool.toolName);
```

## Use Cases

### 1. MPR (Multi-Planar Reconstruction) Viewers
Show how axial, sagittal, and coronal views intersect:
```typescript
// 3-viewport MPR with axial as source
setupReferenceLinesTool(toolGroup, {
  sourceViewportId: 'axial',
  showFullDimension: false
});
```

### 2. Surgical Planning
Help surgeons understand spatial relationships:
```typescript
// Show reference lines from oblique view
setupReferenceLinesTool(toolGroup, {
  sourceViewportId: 'oblique',
  showFullDimension: true  // Show full extent
});
```

### 3. Radiological Review
Navigate between different sequences:
```typescript
// 5 viewports: T2 Sag, T2 Axial, T2 Cor, ADC, Oblique
// User can click any viewport to make it the source
viewportIds.forEach(id => {
  viewportElement.addEventListener('click', () => {
    updateReferenceLineSource(toolGroup, id);
  });
});
```

### 4. TAVI Planning (Our Use Case)
Show annular plane intersection on MPR views:
```typescript
// During annulus definition, show where annular plane intersects
setupReferenceLinesTool(toolGroup, {
  sourceViewportId: 'axial',  // Axial shows annular plane
  showFullDimension: false
});
```

## Advanced Examples

### Example 1: 5-Viewport Setup (from Cornerstone.js)

```typescript
const viewportIds = [
  'T2 - Sagittal',
  'T2 - Acquisition Plane',
  'T2 - Coronal',
  'ADC - Acquisition Plane',
  'T2 - Oblique'
];

// Setup with first viewport as source
let selectedViewportId = viewportIds[0];

// Create tool group
const toolGroup = ToolGroupManager.createToolGroup('prostate-mri');

// Add tools
toolGroup.addTool(ReferenceLinesTool.toolName, {
  sourceViewportId: selectedViewportId
});

// Add viewports
viewportIds.forEach(id => {
  toolGroup.addViewport(id, renderingEngineId);
});

// Enable tool
toolGroup.setToolEnabled(ReferenceLinesTool.toolName);
```

### Example 2: Interactive Source Selection with Visual Feedback

```typescript
const handleViewportSelection = (selectedId: string) => {
  // Update all viewport borders
  viewportElements.forEach((element, index) => {
    const viewportId = viewportIds[index];
    if (viewportId === selectedId) {
      element.style.border = '5px solid yellow';  // Highlight selected
    } else {
      element.style.border = '5px solid transparent';
    }
  });

  // Update reference line source
  toolGroup.setToolConfiguration(ReferenceLinesTool.toolName, {
    sourceViewportId: selectedId
  });
  toolGroup.setToolEnabled(ReferenceLinesTool.toolName);
};
```

### Example 3: Oblique Orientation Support

```typescript
// Reference lines work with oblique orientations
const obliqueViewport = {
  viewportId: 'oblique',
  type: ViewportType.ORTHOGRAPHIC,
  element: obliqueElement,
  defaultOptions: {
    orientation: {
      viewUp: [-0.596, 0.545, -0.589],
      viewPlaneNormal: [-0.596, 0.545, -0.589]
    }
  }
};

// Reference lines will correctly calculate intersection
setupReferenceLinesTool(toolGroup, {
  sourceViewportId: 'oblique'
});
```

## Troubleshooting

### Issue: Reference lines not showing

**Causes & Solutions:**
1. **Tool not enabled**:
   ```typescript
   toolGroup.setToolEnabled(ReferenceLinesTool.toolName);
   ```

2. **Viewports not added to tool group**:
   ```typescript
   viewportIds.forEach(id => {
     toolGroup.addViewport(id, renderingEngineId);
   });
   ```

3. **Source viewport same as target**: Reference lines don't show on source viewport itself

### Issue: Lines don't update when scrolling

**Solution**: Ensure tool is properly enabled and viewports are rendering:
```typescript
// Re-enable tool after configuration changes
toolGroup.setToolEnabled(ReferenceLinesTool.toolName);

// Force viewport render
renderingEngine.renderViewports(viewportIds);
```

### Issue: Lines appear in wrong position

**Causes & Solutions:**
1. **Viewport orientation not set**: Ensure each viewport has correct orientation
2. **Image metadata missing**: Ensure DICOM metadata is properly cached
3. **Camera position issues**: Reset camera and re-render

## Performance Considerations

### Optimal Setup
- **Viewport count**: Works well with 5-6 viewports
- **Update frequency**: Lines update on every render (60fps)
- **Memory**: Minimal overhead (~KB per viewport)

### Performance Tips
1. **Disable when not needed**:
   ```typescript
   toolGroup.setToolDisabled(ReferenceLinesTool.toolName);
   ```

2. **Limit viewport count**: More viewports = more line calculations

3. **Use debouncing for rapid updates**: If scrolling is very fast

## API Reference

### Helper Functions (from `src/utils/referenceLinesExample.ts`)

#### `setupReferenceLinesTool(toolGroup, config)`
Sets up reference lines tool with configuration.

**Parameters:**
- `toolGroup`: Cornerstone tool group instance
- `config.sourceViewportId`: ID of source viewport
- `config.showFullDimension`: Show full dimension lines (optional)

#### `updateReferenceLineSource(toolGroup, sourceViewportId)`
Changes the source viewport dynamically.

**Parameters:**
- `toolGroup`: Cornerstone tool group instance
- `sourceViewportId`: New source viewport ID

#### `toggleFullDimensionLines(toolGroup, showFullDimension)`
Toggles full dimension line display.

**Parameters:**
- `toolGroup`: Cornerstone tool group instance
- `showFullDimension`: Boolean flag

## See Also

- **Source Code**: `src/utils/referenceLinesExample.ts`
- **Official Example**: https://www.cornerstonejs.org/live-examples/referencelines
- **CrosshairsTool**: Alternative tool for viewport synchronization
- **ViewportSync**: For camera/zoom synchronization
