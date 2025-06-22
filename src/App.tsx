import { useEffect, useRef, useState } from "react"; // Added useState
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
import { api } from 'dicomweb-client'; // Import DICOMwebClient api
import { FaCrosshairs, FaSearchPlus, FaArrowsAlt, FaAdjust, FaScroll, FaRuler, FaAngleRight, FaRegCircle, FaRegSquare, FaRegDotCircle, FaHandPointer, FaMapMarkerAlt, FaBezierCurve } from "react-icons/fa";
import SphereMarkerTool from './customTools/Spheremarker';
import VTKComponent from './VTKComponent.js';
import OrthancSearchModal from './OrthancSearchModal';
import OrthancSeriesSelectorModal from './OrthancSeriesSelectorModal'; // Import Series Modal


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
  const currentVolumeIdRef = useRef<string | null>(null); // To keep track of the current volume
  const [isOrthancModalOpen, setIsOrthancModalOpen] = useState(false);
  const [orthancSearchResults, setOrthancSearchResults] = useState<any[]>([]); // Consider using the OrthancStudy type here too
  const [orthancSearchLoading, setOrthancSearchLoading] = useState(false);
  const [orthancSearchError, setOrthancSearchError] = useState<string | null>(null);
  const [selectedStudyInstanceUID, setSelectedStudyInstanceUID] = useState<string | null>(null);
  const [seriesList, setSeriesList] = useState<any[]>([]); // Type with OrthancSeries later
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [selectedSeriesInstanceUID, setSelectedSeriesInstanceUID] = useState<string | null>(null);


  const toolGroupId = "MY_TOOLGROUP_ID";
  const renderingEngineId = "myRenderingEngine";
  const renderingEnginethreeDId = "myRenderingEnginethreeD";
  const synchronizerId = "SLAB_THICKNESS_SYNCHRONIZER_ID";

  const setupViewportsAndLoadVolume = async (imageIdsToLoad: string[]) => {
    const renderingEngine = getRenderingEngine(renderingEngineId);
    if (!renderingEngine) {
      console.error('Rendering engine not initialized');
      // This error will be caught by handleSelectSeries, or should set a global error state
      // For now, relying on the catch in handleSelectSeries
      throw new Error("Rendering engine not initialized. Cannot load images.");
    }

    // If a previous volume exists, destroy it from the cache
    if (currentVolumeIdRef.current) {
      try {
        console.log(`Destroying previous volume: ${currentVolumeIdRef.current}`);
        // Ensure viewports are not using the volume before destroying
        const viewports = renderingEngine.getViewports();
        for (const viewport of viewports) {
            // Check if viewport is IVolumeViewport and has this volume
            if ((viewport as Types.IVolumeViewport).getVolumes && (viewport as Types.IVolumeViewport).getVolumes().some(v => v.volumeId === currentVolumeIdRef.current)) {
                (viewport as Types.IVolumeViewport).setVolumes([]); // Clear volume from viewport
            }
        }
        await volumeLoader.destroyVolume(currentVolumeIdRef.current);
        console.log(`Volume ${currentVolumeIdRef.current} destroyed.`);
      } catch (e) {
        console.warn(`Could not destroy previous volume ${currentVolumeIdRef.current}:`, e);
      }
      currentVolumeIdRef.current = null;
    }

    // Create a unique volume ID for the new volume
    const newVolumeId = `orthancVolume-${Date.now()}`;
    console.log(`Creating new volume: ${newVolumeId}`);
    const volume = await volumeLoader.createAndCacheVolume(newVolumeId, {
      imageIds: imageIdsToLoad,
    });
    volume.load();
    currentVolumeIdRef.current = newVolumeId; // Store the new volume ID

    const viewportsInfo = [
      { id: "axial", ref: elementRefs.axial, orientation: Enums.OrientationAxis.AXIAL },
      { id: "sagittal", ref: elementRefs.sagittal, orientation: Enums.OrientationAxis.SAGITTAL },
      { id: "coronal", ref: elementRefs.coronal, orientation: Enums.OrientationAxis.CORONAL },
    ];

    viewportsInfo.forEach(({ id }) => {
      const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
      if (viewport) {
        console.log(`Setting volume for viewport ${id}: ${newVolumeId}`);
        viewport.setVolumes([{ volumeId: newVolumeId }]);
        viewport.render();
      } else {
        console.error(`Viewport ${id} not found.`);
        // This error will be caught by handleSelectSeries
        throw new Error(`Viewport ${id} not found. Cannot display images.`);
      }
    });
    // Resetting camera or other viewport properties might be needed here for a "fresh" view
    // e.g., viewports.forEach(vp => vp.resetCamera());
    // For now, this is not implemented to keep current zoom/pan if desired.
  };


  useEffect(() => {
    const setup = async () => {
      if (running.current) {
        return;
      }
      running.current = true;

      await csRenderInit();
      await csToolsInit();
      dicomImageLoaderInit({ maxWebWorkers: 1 });

      // Initialize the rendering engine but don't load default data
      const renderingEngine = new RenderingEngine(renderingEngineId);
      // const renderingEnginethreeD = new RenderingEngine(renderingEnginethreeDId); // If needed for 3D view

      // Original viewport setup, enabling elements
      const viewportsInfo = [
        { id: "axial", ref: elementRefs.axial, orientation: Enums.OrientationAxis.AXIAL, type: Enums.ViewportType.ORTHOGRAPHIC },
        { id: "sagittal", ref: elementRefs.sagittal, orientation: Enums.OrientationAxis.SAGITTAL, type: Enums.ViewportType.ORTHOGRAPHIC },
        { id: "coronal", ref: elementRefs.coronal, orientation: Enums.OrientationAxis.CORONAL, type: Enums.ViewportType.ORTHOGRAPHIC },
      ];

      viewportsInfo.forEach(({ id, ref, orientation, type }) => {
        if (ref.current) {
          renderingEngine.enableElement({
            viewportId: id,
            type: type,
            element: ref.current,
            defaultOptions: { orientation },
          });
        } else {
          console.error(`Viewport element for ${id} not found during initial setup.`);
        }
      });

      // Do not load default study here:
      // const imageIds = await createImageIdsAndCacheMetaData({
      //   StudyInstanceUID:
      //     "1.3.6.1.4.1.14519.5.2.1.7009.2403.334240657131972136850343327463",
      //   SeriesInstanceUID:
      //     "1.3.6.1.4.1.14519.5.2.1.7009.2403.226151125820845824875394858561",
      //   wadoRsRoot: "https://d3t6nz73ql33tx.cloudfront.net/dicomweb",
      // });
      // const volumeId = "streamingImageVolume";
      // const volume = await volumeLoader.createAndCacheVolume(volumeId, {
      //   imageIds,
      // });
      // volume.load();
      // viewports.forEach(...) to setVolumes and render will be handled by setupViewportsAndLoadVolume


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
        console.log('Updated sphere positions:', spherePositions);
        
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
    console.log(toolGroup);
    if (!toolGroup) {
      console.error("Tool group not found!");
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
  
    console.log(`${toolName} is now active.`);
  };

  const GridDisplay = ({ elementRefs }) => {
    return (
      <div className="grid grid-cols-2 grid-rows-2 gap-4 flex-grow p-4">
        <div ref={elementRefs.axial} className="w-64 h-64 bg-black"></div>
        <div ref={elementRefs.sagittal} className="w-64 h-64 bg-black"></div>
        <div ref={elementRefs.coronal} className="w-64 h-64 bg-black"></div>
        <div ref={elementRefs.cpr} className="w-64 h-64 bg-black"></div>

      </div>
    );
  };
  
  

  
  const handleOrthancSearch = async (searchCriteria: { patientName: string; patientId: string; studyDate: string }) => {
    console.log("Orthanc Search Criteria:", searchCriteria);
    setOrthancSearchLoading(true);
    setOrthancSearchResults([]);
    setOrthancSearchError(null);

    const client = new api.DICOMwebClient({
      url: 'http://localhost:8042/dicom-web',
      // Orthanc by default might use singlepart for QIDO, but it's good to be explicit if needed
      // singlepart: true,
    });

    const params = {};
    if (searchCriteria.patientName) {
      params.PatientName = `*${searchCriteria.patientName}*`; // Wildcard search
    }
    if (searchCriteria.patientId) {
      params.PatientID = `*${searchCriteria.patientId}*`; // Wildcard search
    }
    if (searchCriteria.studyDate) {
      params.StudyDate = searchCriteria.studyDate; // Format YYYYMMDD or YYYYMMDD-YYYYMMDD
    }
    // Add other common fields if desired, e.g., AccessionNumber, ModalitiesInStudy
    params.fuzzymatching = true; // Orthanc supports fuzzy matching
    params.limit = 100; // Limit results for now

    try {
      const results = await client.searchForStudies({ queryParams: params });
      console.log("Orthanc Search Results:", results);
      setOrthancSearchResults(results);
      // Keep modal open to display results
      // setIsOrthancModalOpen(false);
    } catch (error) {
      console.error("Error searching Orthanc:", error);
      setOrthancSearchError(error.message || 'An unknown error occurred during search.');
    } finally {
      setOrthancSearchLoading(false);
    }
  };

  const handleSelectStudy = (studyInstanceUID: string) => {
    console.log("Selected StudyInstanceUID:", studyInstanceUID);
    setSelectedStudyInstanceUID(studyInstanceUID);
    // For now, close the main search modal.
    // We'll implement series listing in the next step, which might involve
    // keeping the modal open or transitioning its view.
    // setIsOrthancModalOpen(false); // Keep study search modal open or closed based on UX decision later

    // Fetch series for this study
    const fetchSeries = async () => {
      if (!studyInstanceUID) return;
      setSeriesLoading(true);
      setSeriesList([]);
      setSeriesError(null);
      setSelectedSeriesInstanceUID(null); // Reset selected series

      const client = new api.DICOMwebClient({ url: 'http://localhost:8042/dicom-web' });
      try {
        // Retrieve all series metadata for the given study
        // Note: dicomweb-client's retrieveStudyMetadata actually returns an array of instances,
        // so we might need to process this to get unique series.
        // A more direct way if Orthanc supports it is /studies/{StudyInstanceUID}/series
        const seriesData = await client.retrieveStudyMetadata({ studyInstanceUID });

        // Process seriesData to create a unique list of series
        // Each item in seriesData is an instance, so we group by SeriesInstanceUID
        const uniqueSeriesMap = new Map();
        seriesData.forEach(instance => {
          const seriesUID = instance['0020000E']?.Value?.[0];
          if (seriesUID && !uniqueSeriesMap.has(seriesUID)) {
            // Store the first instance encountered for that series, assuming it has relevant series-level tags
            uniqueSeriesMap.set(seriesUID, instance);
          }
        });
        const uniqueSeriesList = Array.from(uniqueSeriesMap.values());

        console.log("Fetched Series List:", uniqueSeriesList);
        setSeriesList(uniqueSeriesList);
      } catch (error) {
        console.error("Error fetching series for study:", error);
        setSeriesError(error.message || 'An unknown error occurred while fetching series.');
      } finally {
        setSeriesLoading(false);
      }
    };

    fetchSeries();
  };

  const handleSelectSeries = async (seriesInstanceUID: string) => {
    console.log("Selected SeriesInstanceUID:", seriesInstanceUID);
    setSelectedSeriesInstanceUID(seriesInstanceUID);

    if (!selectedStudyInstanceUID) {
      console.error("No study selected, cannot load series.");
      setSeriesError("No study selected. Please select a study first.");
      return;
    }

    // Close the series selector modal
    // setSelectedStudyInstanceUID(null); // This would close the series modal due to its isOpen condition
    // A more direct way to close series modal while keeping study context if needed for "change series":
    // For now, setting selectedSeriesInstanceUID will make isOpen={!!selectedStudyInstanceUID && !selectedSeriesInstanceUID} false.

    setSeriesLoading(true); // Indicate loading of the selected series
    setSeriesError(null);

    try {
      const imageIds = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: selectedStudyInstanceUID,
        SeriesInstanceUID: seriesInstanceUID,
        wadoRsRoot: 'http://localhost:8042/dicom-web', // Or just http://localhost:8042
      });

      if (imageIds && imageIds.length > 0) {
        await setupViewportsAndLoadVolume(imageIds);
      } else {
        console.error("No imageIds returned for the selected series.");
        setSeriesError("Could not retrieve image IDs for the selected series.");
      }
    } catch (error) {
      console.error("Error loading selected series:", error);
      setSeriesError(error.message || "An unknown error occurred while loading the series.");
    } finally {
      setSeriesLoading(false);
      // After a series is loaded (or fails to load), we want to allow the user to select another series
      // from the same study, or go back.
      // By setting selectedSeriesInstanceUID back to null, the SeriesSelectorModal will become visible again
      // (due to its isOpen condition: !!selectedStudyInstanceUID && !selectedSeriesInstanceUID),
      // provided selectedStudyInstanceUID is still set (which it should be at this point).
      setSelectedSeriesInstanceUID(null);
      // Do NOT clear selectedStudyInstanceUID here, as that's our context for the current study.
      // Do NOT clear seriesList here, as we want to show it again.
    }
  };

  return (
    <div className="flex h-screen flex-col">
      {/* Slick Top Banner */}
      <div className="bg-gradient-to-r from-gray-800 to-gray-900 text-white text-3xl font-semibold py-4 px-6 text-center shadow-md text-[50px] flex justify-between items-center">
        <span>MPR Viewer</span>
        <button
          onClick={() => {
            setSelectedStudyInstanceUID(null); // Reset selected study when opening search
            setOrthancSearchResults([]);
            setOrthancSearchError(null);
            setIsOrthancModalOpen(true);
          }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded text-sm"
        >
          Search Orthanc
        </button>
      </div>
      
      <div className="flex flex-row flex-grow">
        <ToolMenu activateTool={activateTool} />
        <GridDisplay elementRefs={elementRefs} />
      </div>

      <OrthancSearchModal
        isOpen={isOrthancModalOpen && !selectedStudyInstanceUID} // Only show if no study is selected yet for series view
        onClose={() => {
          setIsOrthancModalOpen(false);
          setOrthancSearchResults([]);
          setOrthancSearchError(null);
        }}
        onSearch={handleOrthancSearch}
        results={orthancSearchResults}
        loading={orthancSearchLoading}
        error={orthancSearchError}
        onSelectStudy={handleSelectStudy}
      />

      {selectedStudyInstanceUID && (
        <OrthancSeriesSelectorModal
          isOpen={!!selectedStudyInstanceUID && !selectedSeriesInstanceUID} // Show if a study is selected but no series yet
          onClose={() => {
            setSelectedStudyInstanceUID(null); // Go back to study search or close everything
            setSeriesList([]);
            setSeriesError(null);
            // Optionally, bring back the study search modal if that's the desired UX:
            // setIsOrthancModalOpen(true);
          }}
          seriesList={seriesList}
          studyInstanceUID={selectedStudyInstanceUID}
          onSelectSeries={handleSelectSeries}
          loading={seriesLoading}
          error={seriesError}
        />
      )}
      {/* TODO: If selectedSeriesInstanceUID is set, trigger image loading */}
    </div>
  );
  
  };


export default App;