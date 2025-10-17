import { useEffect, useRef } from "react";
import createImageIdsAndCacheMetaData from "./lib/createImageIdsAndCacheMetaData";
import {
  CONSTANTS,
  RenderingEngine,
  Enums,
  Types,
  volumeLoader,
  cornerstoneStreamingImageVolumeLoader,
  setVolumesForViewports,
  getRenderingEngine,
} from "@cornerstonejs/core";
import { init as csRenderInit } from "@cornerstonejs/core";
import { init as csToolsInit } from "@cornerstonejs/tools";
import { init as dicomImageLoaderInit } from "@cornerstonejs/dicom-image-loader";
import * as cornerstoneTools from "@cornerstonejs/tools";
import { FaCrosshairs, FaSearchPlus, FaArrowsAlt, FaAdjust, FaScroll, FaRuler, FaAngleRight, FaRegCircle, FaRegSquare, FaRegDotCircle, FaHandPointer, FaMapMarkerAlt, FaBezierCurve } from "react-icons/fa";
import SphereMarkerTool from './customTools/Spheremarker';
import VTKComponent from './VTKComponent.js';


const {
  ToolGroupManager,
  Enums: csToolsEnums,
  CrosshairsTool,
  ZoomTool,
  PanTool,
  WindowLevelTool,
  StackScrollTool,
  LengthTool,
  AngleTool,
  EllipticalROITool,
  RectangleROITool,
  CircleROITool,
  DragProbeTool,
  OrientationMarkerTool,
  SplineROITool,
  synchronizers,
} = cornerstoneTools;

const { createSlabThicknessSynchronizer } = synchronizers;
const { MouseBindings } = csToolsEnums;

volumeLoader.registerUnknownVolumeLoader(cornerstoneStreamingImageVolumeLoader);

function App() {
  const elementRefs = {
    axial: useRef(null),
    sagittal: useRef(null),
    coronal: useRef(null),
    threeD: useRef(null),
    cpr: useRef(null),
  };
  const running = useRef(false);

  const toolGroupId = "MY_TOOLGROUP_ID";
  const renderingEngineId = "myRenderingEngine";
  const renderingEnginethreeDId = "myRenderingEnginethreeD";
  const synchronizerId = "SLAB_THICKNESS_SYNCHRONIZER_ID";

  useEffect(() => {
    const setup = async () => {
      if (running.current) {
        return;
      }
      running.current = true;

      await csRenderInit();
      await csToolsInit();
      dicomImageLoaderInit({ maxWebWorkers: 1 });

    const imageIds = await createImageIdsAndCacheMetaData({
      StudyInstanceUID: "1.2.826.0.1.3802357.101.341000267482",
      SeriesInstanceUID: "1.2.156.14702.1.1005.128.1.20230328073634983276920731",
      wadoRsRoot: "http://127.0.0.1/orthanc/dicom-web",
    });
      const renderingEngine = new RenderingEngine(renderingEngineId);
      const renderingEnginethreeD = new RenderingEngine(renderingEnginethreeDId);
      const volumeId = "streamingImageVolume";
      const volume = await volumeLoader.createAndCacheVolume(volumeId, {
        imageIds,
      });
      volume.load();

      const viewports = [
        { id: "axial", orientation: Enums.OrientationAxis.AXIAL, type: Enums.ViewportType.ORTHOGRAPHIC },
        { id: "sagittal", orientation: Enums.OrientationAxis.SAGITTAL, type: Enums.ViewportType.ORTHOGRAPHIC },
        { id: "coronal", orientation: Enums.OrientationAxis.CORONAL, type: Enums.ViewportType.ORTHOGRAPHIC },
      ];

      viewports.forEach(({ id, orientation }) => {
        renderingEngine.enableElement({
          viewportId: id,
          type: Enums.ViewportType.ORTHOGRAPHIC,
          element: elementRefs[id].current,
          defaultOptions: { 
            orientation,
            background: [0, 0, 0] // Set black background
          },
        });

        const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
        viewport.setVolumes([{ volumeId }]);
        viewport.render();
      });

      // Add a small delay and then reset the camera for each viewport with proper fitting
      setTimeout(() => {
        viewports.forEach(({ id }) => {
          const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
          
          try {
            // Reset camera first
            viewport.resetCamera();
            
            // Get the viewport's current bounds and image data
            const bounds = viewport.getBounds();
            const canvas = viewport.getCanvas();
            
            if (bounds && canvas) {
              const { width: canvasWidth, height: canvasHeight } = canvas;
              
              // Calculate the bounding box of the image
              const [xMin, xMax, yMin, yMax, zMin, zMax] = bounds;
              const imageWidth = Math.abs(xMax - xMin);
              const imageHeight = Math.abs(yMax - yMin);
              
              // Calculate scale factors for both dimensions
              const scaleX = canvasWidth / imageWidth;
              const scaleY = canvasHeight / imageHeight;
              
              // Use the smaller scale to ensure the entire image fits
              const scale = Math.min(scaleX, scaleY) * 0.9; // 0.9 for some padding
              
              // Set the parallel scale (controls zoom level)
              viewport.setCamera({
                parallelScale: Math.max(imageWidth, imageHeight) / (2 * scale),
              });
            }
            
         
            
            viewport.render();
          } catch (error) {
            // Fallback: just reset and render
            viewport.resetCamera();
            viewport.render();
          }
        });
      }, 2000);

      // Add tools to Cornerstone3D
      cornerstoneTools.addTool(CrosshairsTool);
      cornerstoneTools.addTool(ZoomTool);
      cornerstoneTools.addTool(PanTool);
      cornerstoneTools.addTool(WindowLevelTool);
      cornerstoneTools.addTool(StackScrollTool);
      cornerstoneTools.addTool(LengthTool);
      cornerstoneTools.addTool(AngleTool);
      cornerstoneTools.addTool(EllipticalROITool);
      cornerstoneTools.addTool(RectangleROITool);
      cornerstoneTools.addTool(CircleROITool);
      cornerstoneTools.addTool(DragProbeTool);
      cornerstoneTools.addTool(OrientationMarkerTool);
      cornerstoneTools.addTool(SplineROITool);
      cornerstoneTools.addTool(SphereMarkerTool);

      // Define tool groups to add the segmentation display tool to
      const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);

      // Add Crosshairs tool and configure it to link the three viewports
      toolGroup.addTool(CrosshairsTool.toolName, {
        getReferenceLineColor: (viewportId) => {
          const colors = {
            axial: "rgb(200, 0, 0)",
            sagittal: "rgb(200, 200, 0)",
            coronal: "rgb(0, 200, 0)",
          };
          return colors[viewportId];
        },
        getReferenceLineControllable: () => true,
        getReferenceLineDraggableRotatable: () => true,
        getReferenceLineSlabThicknessControlsOn: () => true,
      });
      toolGroup.setToolActive(CrosshairsTool.toolName, {
        bindings: [
         {
            mouseButton: MouseBindings.Primary, // Left Click
          },
        ],
      })

      toolGroup.addTool(ZoomTool.toolName, {
        invert: false,
        preventZoomOutsideImage: true,
      });

      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [
         {
            mouseButton: MouseBindings.Secondary, // Left Click
          },
        ],
      })

      toolGroup.addTool(PanTool.toolName);

      toolGroup.addTool(CrosshairsTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      toolGroup.addTool(WindowLevelTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      toolGroup.addTool(StackScrollTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });
      toolGroup.setToolActive(StackScrollTool.toolName, {
        bindings: [
          {
            mouseButton: MouseBindings.Wheel,
          }
        ]
      })

      toolGroup.addTool(LengthTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      toolGroup.addTool(AngleTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      toolGroup.addTool(EllipticalROITool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      toolGroup.addTool(RectangleROITool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      toolGroup.addTool(CircleROITool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      toolGroup.addTool(DragProbeTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      toolGroup.addTool(OrientationMarkerTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      toolGroup.addTool(SplineROITool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      toolGroup.addTool(SphereMarkerTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      const sphereTool = toolGroup.getToolInstance(SphereMarkerTool.toolName);

      // Set up the callback
      sphereTool.setPositionUpdateCallback((spherePositions) => {
        
        // Example of how you might use the positions
        if (spherePositions.length === 3) {
          // Do something with all three positions
          const [sphere1, sphere2, sphere3] = spherePositions;
          
          // Example: calculate distance between points
          // const distance = calculateDistance(sphere1.pos, sphere2.pos);
          
          // Example: update UI with positions
          // updatePositionDisplay(spherePositions);
        }
      });

      // Add viewports to the tool group
      viewports.forEach(({ id }) => {
        toolGroup.addViewport(id, renderingEngineId);
      });

      // Set up synchronizers
      const synchronizer = createSlabThicknessSynchronizer(synchronizerId);
      viewports.forEach(({ id }) => {
        synchronizer.add({
          renderingEngineId,
          viewportId: id,
        });
      });
      synchronizer.setEnabled(true);

    };

    setup();
  }, []);
  
  const ToolMenu = ({ activateTool }) => {
    const tools = [
      { name: "Crosshairs", icon: <FaCrosshairs /> },
      { name: "Zoom", icon: <FaSearchPlus /> },
      { name: "Pan", icon: <FaArrowsAlt /> },
      { name: "WindowLevel", icon: <FaAdjust /> },
      { name: "StackScroll", icon: <FaScroll /> },
      { name: "Length", icon: <FaRuler /> },
      { name: "Angle", icon: <FaAngleRight /> },
      { name: "EllipticalROI", icon: <FaRegCircle /> },
      { name: "RectangleROI", icon: <FaRegSquare /> },
      { name: "CircleROI", icon: <FaRegDotCircle /> },
      { name: "DragProbe", icon: <FaHandPointer /> },
      { name: "OrientationMarker", icon: <FaMapMarkerAlt /> },
      { name: "SplineROI", icon: <FaBezierCurve /> },
      { name: "SphereMarker", icon: <FaRegDotCircle /> }
    ];
  
    return (
      <div className="flex flex-col gap-5 p-2 w-16 bg-gray-800 text-white h-full">
        {tools.map((tool) => (
          <button
            key={tool.name}
            onClick={() => activateTool(tool.name)}
            className="flex  flex-row gap-2 p-5 bg-gray-700 hover:bg-gray-600 rounded-md  items-center justify-between"
          >
           <div>{tool.name}</div>  <div>{tool.icon}</div>
          </button>
        ))}
      </div>
    );
  };

  const activateTool = (toolName) => {
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    if (!toolGroup) {
      return;
    }
  
    // Get the currently active tool
    const currentActiveTool = toolGroup.getActivePrimaryMouseButtonTool();
  
    // If the selected tool is already active, do nothing
    if (currentActiveTool === toolName) return;
  
    // Deactivate the currently active tool
    if (currentActiveTool) {
      toolGroup.setToolPassive(currentActiveTool);
    }
  
    // Activate the selected tool
    toolGroup.setToolActive(toolName, {
      bindings: [{ mouseButton: MouseBindings.Primary }],
    });
    toolGroup.setToolActive(ZoomTool.toolName, {
      bindings: [
       {
          mouseButton: MouseBindings.Secondary, // Left Click
        },
      ],
    })
 toolGroup.setToolActive(StackScrollTool.toolName, {
      bindings: [
        {
          mouseButton: MouseBindings.Wheel,
        }
      ]
    })
  
  };

  const GridDisplay = ({ elementRefs }) => {
    return (
      <div className="grid grid-cols-2 grid-rows-2 gap-4 flex-grow p-4">
        {/* Use flex-grow and min-h-0 to allow proper sizing */}
        <div ref={elementRefs.axial} className="bg-black flex-grow min-h-0"></div>
        <div ref={elementRefs.sagittal} className="bg-black flex-grow min-h-0"></div>
        <div ref={elementRefs.coronal} className="bg-black flex-grow min-h-0"></div>
        <div ref={elementRefs.cpr} className="bg-black flex-grow min-h-0"></div>
      </div>
    );
  };
  
  return (
    <div className="flex h-screen flex-col">
      {/* Slick Top Banner */}
      <div className="bg-gradient-to-r from-gray-800 to-gray-900 text-white text-3xl font-semibold py-4 text-center shadow-md text-[50px]">
        MPR Viewer
      </div>
      
      <div className="flex flex-row flex-grow">
        <ToolMenu activateTool={activateTool} />
        <GridDisplay elementRefs={elementRefs} />
      </div>
    </div>
  );
};

export default App;