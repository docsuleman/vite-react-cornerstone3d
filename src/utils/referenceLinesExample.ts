/**
 * Reference Lines Tool - Example Implementation
 *
 * Source: Cornerstone.js official example
 * https://www.cornerstonejs.org/live-examples/referencelines
 *
 * This example demonstrates how to use the ReferenceLinesTool to show
 * intersection lines between different viewports, helping users understand
 * the spatial relationship between different slice orientations.
 *
 * Key Features:
 * - Show reference lines from a source viewport on other viewports
 * - Support for both Stack and Volume viewports
 * - Dynamic source viewport selection
 * - Show full dimension lines option
 * - Works with oblique orientations
 *
 * Use Cases:
 * - MPR (Multi-Planar Reconstruction) viewers
 * - Understanding slice positions across orientations
 * - Surgical planning applications
 * - Radiological review workflows
 */

import type { Types } from '@cornerstonejs/core';
import {
  RenderingEngine,
  Enums,
  setVolumesForViewports,
  volumeLoader,
} from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';

const {
  ReferenceLinesTool,
  ToolGroupManager,
  StackScrollTool,
  ZoomTool,
  PanTool,
  Enums: csToolsEnums,
} = cornerstoneTools;

const { ViewportType } = Enums;
const { MouseBindings } = csToolsEnums;

/**
 * Example: 5-viewport setup with reference lines
 *
 * Setup:
 * - 4 Stack viewports (Sagittal, Axial, Coronal, ADC)
 * - 1 Volume viewport (Oblique orientation)
 * - Reference lines showing intersection from selected viewport
 */

export interface ReferenceLinesConfig {
  sourceViewportId: string;
  showFullDimension?: boolean;
}

/**
 * Setup reference lines tool with configuration
 *
 * @param toolGroup - Cornerstone tool group
 * @param config - Reference lines configuration
 *
 * @example
 * const toolGroup = ToolGroupManager.createToolGroup('myToolGroup');
 * setupReferenceLinesTool(toolGroup, {
 *   sourceViewportId: 'axial',
 *   showFullDimension: false
 * });
 */
export function setupReferenceLinesTool(
  toolGroup: any,
  config: ReferenceLinesConfig
) {
  // Add the reference lines tool
  cornerstoneTools.addTool(ReferenceLinesTool);

  // Add tool to the group with configuration
  toolGroup.addTool(ReferenceLinesTool.toolName, {
    sourceViewportId: config.sourceViewportId,
    showFullDimension: config.showFullDimension ?? false,
  });

  // Enable the tool (it will be visible on all viewports)
  toolGroup.setToolEnabled(ReferenceLinesTool.toolName);

}

/**
 * Update reference lines source viewport dynamically
 *
 * @param toolGroup - Cornerstone tool group
 * @param sourceViewportId - ID of the viewport to use as reference source
 *
 * @example
 * // Change source viewport when user clicks a different viewport
 * updateReferenceLineSource(toolGroup, 'sagittal');
 */
export function updateReferenceLineSource(
  toolGroup: any,
  sourceViewportId: string
) {
  toolGroup.setToolConfiguration(ReferenceLinesTool.toolName, {
    sourceViewportId,
  });

  // Re-enable to apply changes
  toolGroup.setToolEnabled(ReferenceLinesTool.toolName);

}

/**
 * Toggle full dimension lines display
 *
 * @param toolGroup - Cornerstone tool group
 * @param showFullDimension - Whether to show full dimension lines
 *
 * @example
 * // Show full dimension lines instead of just visible portion
 * toggleFullDimensionLines(toolGroup, true);
 */
export function toggleFullDimensionLines(
  toolGroup: any,
  showFullDimension: boolean
) {
  toolGroup.setToolConfiguration(ReferenceLinesTool.toolName, {
    showFullDimension,
  });

}

/**
 * Complete example setup with 5 viewports and reference lines
 *
 * This is the full implementation from the Cornerstone.js example
 */
export async function exampleReferenceLinesSetup(
  renderingEngineId: string,
  elements: HTMLDivElement[],
  viewportIds: string[]
) {
  const toolGroupId = 'REFERENCE_LINES_TOOL_GROUP';
  let selectedViewportId = viewportIds[0];

  // Add tools to Cornerstone3D
  cornerstoneTools.addTool(ReferenceLinesTool);
  cornerstoneTools.addTool(ZoomTool);
  cornerstoneTools.addTool(StackScrollTool);
  cornerstoneTools.addTool(PanTool);

  // Create tool group
  const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);

  // Add tools to the tool group
  toolGroup.addTool(ReferenceLinesTool.toolName, {
    sourceViewportId: selectedViewportId,
  });
  toolGroup.addTool(ZoomTool.toolName);
  toolGroup.addTool(StackScrollTool.toolName);
  toolGroup.addTool(PanTool.toolName);

  // Set tool states
  toolGroup.setToolEnabled(ReferenceLinesTool.toolName);

  toolGroup.setToolActive(ZoomTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Secondary }], // Right click
  });

  toolGroup.setToolActive(PanTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Auxiliary }], // Middle click
  });

  toolGroup.setToolActive(StackScrollTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Wheel }], // Mouse wheel
  });

  // Create rendering engine
  const renderingEngine = new RenderingEngine(renderingEngineId);

  // Setup viewports (example: 4 stack + 1 volume)
  const viewportInputArray = [
    {
      viewportId: viewportIds[0],
      type: ViewportType.STACK,
      element: elements[0],
      defaultOptions: {
        background: [0.2, 0, 0.2] as Types.Point3,
      },
    },
    {
      viewportId: viewportIds[1],
      type: ViewportType.STACK,
      element: elements[1],
      defaultOptions: {
        background: [0.2, 0, 0.2] as Types.Point3,
      },
    },
    {
      viewportId: viewportIds[2],
      type: ViewportType.STACK,
      element: elements[2],
      defaultOptions: {
        background: [0.2, 0, 0.2] as Types.Point3,
      },
    },
    {
      viewportId: viewportIds[3],
      type: ViewportType.STACK,
      element: elements[3],
      defaultOptions: {
        background: [0.2, 0, 0.2] as Types.Point3,
      },
    },
    {
      viewportId: viewportIds[4],
      type: ViewportType.ORTHOGRAPHIC,
      element: elements[4],
      defaultOptions: {
        background: [0.5, 0, 0.2] as Types.Point3,
        orientation: {
          // Oblique orientation example
          viewUp: [
            -0.5962687530844388, 0.5453181550345819, -0.5891448751239446,
          ] as Types.Point3,
          viewPlaneNormal: [
            -0.5962687530844388, 0.5453181550345819, -0.5891448751239446,
          ] as Types.Point3,
        },
      },
    },
  ];

  renderingEngine.setViewports(viewportInputArray);

  // Add viewports to tool group
  viewportIds.forEach((viewportId) =>
    toolGroup.addViewport(viewportId, renderingEngineId)
  );

  return { renderingEngine, toolGroup };
}

/**
 * Integration example for React component
 *
 * @example
 * const MyMPRComponent = () => {
 *   const [selectedViewport, setSelectedViewport] = useState('axial');
 *   const toolGroupRef = useRef(null);
 *
 *   useEffect(() => {
 *     // Setup tool group
 *     const toolGroup = ToolGroupManager.createToolGroup('myGroup');
 *     toolGroupRef.current = toolGroup;
 *
 *     setupReferenceLinesTool(toolGroup, {
 *       sourceViewportId: 'axial',
 *       showFullDimension: false
 *     });
 *
 *     // Add other tools...
 *   }, []);
 *
 *   const handleViewportClick = (viewportId: string) => {
 *     setSelectedViewport(viewportId);
 *     if (toolGroupRef.current) {
 *       updateReferenceLineSource(toolGroupRef.current, viewportId);
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <div onClick={() => handleViewportClick('axial')}>Axial</div>
 *       <div onClick={() => handleViewportClick('sagittal')}>Sagittal</div>
 *       {// ... viewports}
 *     </div>
 *   );
 * };
 */

/**
 * Key Configuration Options
 *
 * ReferenceLinesTool.toolName options:
 * {
 *   sourceViewportId: string;        // Which viewport to use as source
 *   showFullDimension?: boolean;      // Show full lines or just visible portion
 * }
 *
 * Visual behavior:
 * - Lines are drawn on all OTHER viewports showing where the source viewport intersects
 * - Color/style can be customized via tool configuration
 * - Lines update automatically when source viewport scrolls/moves
 * - Works with oblique orientations
 */

/**
 * Important Notes:
 *
 * 1. Source Viewport Selection:
 *    - Only ONE viewport can be the source at a time
 *    - Use setToolConfiguration to change source dynamically
 *    - Source viewport itself doesn't show reference lines
 *
 * 2. Viewport Types:
 *    - Works with Stack viewports
 *    - Works with Orthographic volume viewports
 *    - Handles oblique orientations correctly
 *
 * 3. Performance:
 *    - Lines update on every render of source viewport
 *    - Minimal performance impact for 5-6 viewports
 *    - Consider disabling for very large viewport grids
 *
 * 4. Visual Customization:
 *    - Line color, width, style can be configured
 *    - Full dimension vs visible portion option
 *    - Can be toggled on/off per viewport
 */

// Export constants for reference
export const REFERENCE_LINES_CONSTANTS = {
  TOOL_NAME: ReferenceLinesTool.toolName,
  DEFAULT_CONFIG: {
    showFullDimension: false,
  },
  MOUSE_BINDINGS: {
    ZOOM: MouseBindings.Secondary, // Right click
    PAN: MouseBindings.Auxiliary, // Middle click
    SCROLL: MouseBindings.Wheel, // Mouse wheel
  },
};
