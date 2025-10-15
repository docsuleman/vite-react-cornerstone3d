import React, { useEffect, useRef, useState, useCallback } from 'react';
import createImageIdsAndCacheMetaData from '../lib/createImageIdsAndCacheMetaData';
import {
  RenderingEngine,
  Enums,
  Types,
  volumeLoader,
  cornerstoneStreamingImageVolumeLoader,
  eventTarget,
  getRenderingEngine,
  cache,
  setVolumesForViewports,
  getEnabledElement,
} from "@cornerstonejs/core";
import { init as csRenderInit } from "@cornerstonejs/core";
import { init as csToolsInit } from "@cornerstonejs/tools";
import { init as dicomImageLoaderInit } from "@cornerstonejs/dicom-image-loader";
import * as cornerstoneTools from "@cornerstonejs/tools";
import { initializeCornerstone, isCornerStoneInitialized } from '../utils/cornerstoneInit';
import { FaCrosshairs, FaSearchPlus, FaArrowsAlt, FaAdjust, FaCircle, FaMousePointer, FaScroll, FaTrash, FaDotCircle, FaPlay, FaPause, FaDrawPolygon, FaRuler, FaTag, FaPen, FaCheck, FaChevronDown, FaInfo, FaCamera, FaTools, FaListUl, FaDraftingCompass, FaBullseye, FaVectorSquare, FaMapMarkerAlt, FaRegSquare } from "react-icons/fa";
import SphereMarkerTool from '../customTools/Spheremarker';
import CuspNadirTool from '../customTools/CuspNadirTool';
import FixedCrosshairTool from '../customTools/FixedCrosshairTool';
import VerticalDistanceTool from '../customTools/VerticalDistanceTool';
import VerticalLineTool from '../customTools/VerticalLineTool';
import CurvedLeafletTool from '../customTools/CurvedLeafletTool';
import ContextMenu, { ContextMenuItem } from './ContextMenu';
import { WorkflowStage, RootPointType } from '../types/WorkflowTypes';
import { CenterlineGenerator } from '../utils/CenterlineGenerator';
import { MeasurementStep } from '../types/MeasurementWorkflowTypes';
import { getWorkflowManager } from '../utils/MeasurementWorkflowManager';
import { calculateSplineAxes, formatAxisMeasurement } from '../utils/SplineStatistics';
import { manualResize } from '../utils/viewportResize';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkImageCPRMapper from '@kitware/vtk.js/Rendering/Core/ImageCPRMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkXMLPolyDataReader from '@kitware/vtk.js/IO/XML/XMLPolyDataReader';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkOrientationMarkerWidget from '@kitware/vtk.js/Interaction/Widgets/OrientationMarkerWidget';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import html2canvas from 'html2canvas';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import { mat3, vec3 } from 'gl-matrix';
import HumanVTP from '../assets/Human.vtp?url';

const {
  ToolGroupManager,
  Enums: csToolsEnums,
  CrosshairsTool,
  ZoomTool,
  PanTool,
  WindowLevelTool,
  StackScrollTool,
  SplineROITool,
  LengthTool,
  AngleTool,
  LabelTool,
  ProbeTool,
  RectangleROITool,
  CircleROITool,
  TrackballRotateTool,
  VolumeCroppingTool,
  VolumeCroppingControlTool,
  OrientationMarkerTool,
  synchronizers,
} = cornerstoneTools;
const { createSlabThicknessSynchronizer, createCameraPositionSynchronizer, createZoomPanSynchronizer } = synchronizers;
const toolUtilities = cornerstoneTools.utilities || {};
const { MouseBindings } = csToolsEnums;

// Register volume loader
volumeLoader.registerUnknownVolumeLoader(cornerstoneStreamingImageVolumeLoader);

interface ProperMPRViewportProps {
  patientInfo?: {
    patientID?: string;
    patientName?: string;
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
  };
  onImageLoaded?: (imageData: any) => void;
  onSpherePositionsUpdate?: (spheres: { id: string; pos: [number, number, number]; color: string }[]) => void;
  onCuspDotsUpdate?: (dots: { id: string; pos: [number, number, number]; color: string; cuspType: string }[]) => void;
  currentStage?: WorkflowStage;
  existingSpheres?: { id: string; pos: [number, number, number]; color: string }[];
  renderMode?: 'mpr' | 'cpr'; // Toggle between standard MPR and straightened CPR
  onRenderModeChange?: (mode: 'mpr' | 'cpr') => void; // Callback when user changes render mode
  // Workflow-related props
  currentWorkflowStep?: MeasurementStep | null;
  workflowControlled?: boolean;
  onMeasurementComplete?: (stepId: string, annotationUID: string, measuredValue: any) => void;
  onConfirmMeasurement?: () => void; // Callback when user clicks tick button to confirm
  // Annulus data for automatic scrolling
  annularPlane?: {
    center: [number, number, number];
    normal: [number, number, number];
  };
  annulusArea?: number; // For dynamic offset calculations
  // Centerline data from workflow state (modified to be perpendicular to annular plane)
  centerlineData?: {
    position: Float32Array;
    orientation: Float32Array;
    length: number;
  };
  // Toolbar communication
  onActiveToolChange?: (tool: string) => void; // Notify parent of active tool
  requestedTool?: string; // Tool requested from parent
  windowLevelPreset?: string; // W/L preset from parent toolbar
  initializeCropBox?: boolean; // Initialize default crop box for volume cropping
  onAddScreenshotToReport?: (payload: {
    viewportId: string;
    imageDataUrl: string;
    capturedAt: string;
    workflowStepId?: string;
    workflowStepName?: string;
    annotationUID?: string;
    details?: Array<{
      title: string;
      lines: string[];
      color?: string;
    }>;
  }) => void;
  onWorkflowStepSelect?: (stepId: string) => void;
  autoAdvanceWorkflow?: boolean;
}

const ProperMPRViewport: React.FC<ProperMPRViewportProps> = ({
  patientInfo,
  onImageLoaded,
  onSpherePositionsUpdate,
  onCuspDotsUpdate,
  currentStage,
  existingSpheres,
  renderMode = 'mpr', // Default to standard MPR
  onRenderModeChange,
  currentWorkflowStep = null,
  workflowControlled = false,
  onMeasurementComplete,
  onConfirmMeasurement,
  annularPlane,
  annulusArea = 400,
  centerlineData: centerlineDataProp,
  onActiveToolChange,
  requestedTool,
  windowLevelPreset = 'cardiac',
  initializeCropBox = false,
  onAddScreenshotToReport,
  onWorkflowStepSelect,
  autoAdvanceWorkflow = false
}

  return (
    <div className="w-20 bg-slate-900 border-r border-slate-700 flex flex-col items-center py-4 gap-4">
      {stages.map(({ stage, icon: Icon, label }) => {
        const status = getStageStatus(stage);
        const colors = getStageColors(status);
        const isClickable = status !== 'locked';

        return (
          <div
            key={stage}
            className={`relative w-14 h-14 rounded-lg border-2 flex items-center justify-center transition-all duration-200 ${colors}`}
            onClick={() => isClickable && onStageClick(stage)}
            title={stage.replace(/_/g, ' ').replace(/\w/g, l => l.toUpperCase())}
          >
            <div className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-slate-900 border-2 border-current flex items-center justify-center text-xs font-bold">
              {label}
            </div>

            {status === 'completed' ? (
              <FaCheck className="text-xl" />
            ) : status === 'locked' ? (
              <FaLock className="text-sm" />
            ) : (
              <Icon className="text-xl" />
            )}

            {status === 'current' && (
              <div className="absolute -right-1 top-1/2 transform translate-x-full -translate-y-1/2 w-0 h-0 border-t-4 border-t-transparent border-b-4 border-b-transparent border-l-4 border-l-blue-600"></div>
            )}
          </div>
        );
      })}
    </div>
  );
) => {
  const elementRefs = {
    axial: useRef(null),
    sagittal: useRef(null),
    coronal: useRef(null),
    volume3D: useRef(null), // 4th viewport for ROOT_DEFINITION stage
    measurement1: useRef(null), // 3D viewport for MEASUREMENTS stage (top row)
    measurement2: useRef(null), // Reserved spot for MEASUREMENTS stage (top row)
  };
  const orientationMarkerRef = useRef<HTMLDivElement>(null); // Container for human orientation marker

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string>(
    currentStage === WorkflowStage.ROOT_DEFINITION ? 'SphereMarker' :
    currentStage === WorkflowStage.ANNULUS_DEFINITION ? 'CuspNadir' :
    'Zoom'
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    annotationUID: string;
    viewportId: string | null;
    cprLineData?: {
      arcLength: number;
      totalLength: number;
      positionRatio: number;
      distanceFromAnnulus: number;
      viewportId: string;
      annulusYPixel: number;
      clickedYPixel: number;
    }
  } | null>(null);
  const [viewportContextMenu, setViewportContextMenu] = useState<{
    x: number;
    y: number;
    viewportId: string | null;
  } | null>(null);
  const [annotationLabels, setAnnotationLabels] = useState<{
    [annotationUID: string]: { text: string; color: string }
  }>({});
  const [annotationOverlays, setAnnotationOverlays] = useState<Array<{
    uid: string;
    x: number;
    y: number;
    lines: string[];
    viewportId: string;
    annotationUID: string; // Store reference to the actual annotation
  }>>([]);
  const [draggingOverlay, setDraggingOverlay] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [axisLinesKey, setAxisLinesKey] = useState(0); // Force re-render of axis lines
  const [cprHeightIndicators, setCprHeightIndicators] = useState<Array<{
    id: string;
    viewportId: string;
    y1: number; // annulus Y position
    y2: number; // clicked position Y
    height: number; // distance in mm
  }>>([]);

  const getViewportElementById = (viewportId: string): HTMLElement | null => {
    switch (viewportId) {
      case 'axial':
        return elementRefs.axial.current?.parentElement || null;
      case 'sagittal':
        return elementRefs.sagittal.current?.parentElement || null;
      case 'coronal':
        return elementRefs.coronal.current?.parentElement || null;
      case 'measurement1':
        return elementRefs.measurement1.current?.parentElement || null;
      case 'measurement2':
        return elementRefs.measurement2.current?.parentElement || null;
      default:
        return null;
    }
  };

  const canvasToDisplayPoint = (
    viewport: Types.IVolumeViewport | undefined,
    viewportElement: HTMLElement | null,
    canvasPoint: Types.Point2
  ): Types.Point2 => {
    if (!viewport) {
      return canvasPoint;
    }
    const canvas = viewport.getCanvas?.() as HTMLCanvasElement | undefined;
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      return canvasPoint;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const parentRect = viewportElement?.getBoundingClientRect();
    const scaleX = canvasRect.width / canvas.width;
    const scaleY = canvasRect.height / canvas.height;

    let offsetX = 0;
    let offsetY = 0;
    if (parentRect) {
      offsetX = canvasRect.left - parentRect.left;
      offsetY = canvasRect.top - parentRect.top;
    }

    const displayX = canvasPoint[0] * scaleX + offsetX;
    const displayY = canvasPoint[1] * scaleY + offsetY;
    return [displayX, displayY] as Types.Point2;
  };

  const getAnnotationAnchorPoint = (annotation: any): Types.Point3 | null => {
    if (Array.isArray(annotation?.data?.handles?.points) && annotation.data.handles.points.length > 0) {
      return [...annotation.data.handles.points[0]] as Types.Point3;
    }
    if (Array.isArray(annotation?.data?.handles?.textBox?.worldPosition)) {
      return [...annotation.data.handles.textBox.worldPosition] as Types.Point3;
    }
    const polyline = annotation?.data?.contour?.polyline;
    if (Array.isArray(polyline) && polyline.length >= 3) {
      return [polyline[0], polyline[1], polyline[2]] as Types.Point3;
    }
    return null;
  };

  const captureViewportScreenshot = useCallback(async (viewportId: string, annotationUID?: string) => {
    console.log('📸 captureViewportScreenshot called for:', viewportId);

    if (!onAddScreenshotToReport) {
      console.warn('Screenshot handler not provided, skipping capture.');
      return;
    }

    const viewport = renderingEngineRef.current?.getViewport(viewportId);
    if (!viewport) {
      console.warn(`Unable to find viewport "${viewportId}" for screenshot capture.`);
      return;
    }

    const canvas = viewport.getCanvas?.() as HTMLCanvasElement | undefined;
    if (!canvas) {
      console.warn(`Viewport "${viewportId}" does not expose a canvas for screenshot capture.`);
      return;
    }

    console.log('📸 Canvas found, capturing with html2canvas...');

    try {
      // Temporarily hide crosshair tool
      const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(toolGroupId);
      const crosshairWasEnabled = toolGroup?.getToolOptions('FixedCrosshair')?.mode !== undefined;

      if (crosshairWasEnabled && toolGroup) {
        toolGroup.setToolDisabled('FixedCrosshair');
      }

      // Trigger a render to ensure annotations are up to date and crosshair is hidden
      viewport.render();

      // Small delay to ensure render completes
      await new Promise(resolve => setTimeout(resolve, 50));

      // Find the viewport element (parent of canvas)
      const viewportElement = canvas.parentElement;
      if (!viewportElement) {
        console.warn('Unable to find viewport element');
        // Re-enable crosshair before returning
        if (crosshairWasEnabled && toolGroup) {
          toolGroup.setToolEnabled('FixedCrosshair');
          viewport.render();
        }
        return;
      }

      // Use html2canvas to capture the entire viewport including SVG overlays
      const capturedCanvas = await html2canvas(viewportElement, {
        backgroundColor: '#000000',
        logging: false,
        scale: 1,
        useCORS: true,
      });

      console.log('📸 html2canvas capture complete');

      // Re-enable crosshair tool
      if (crosshairWasEnabled && toolGroup) {
        toolGroup.setToolEnabled('FixedCrosshair');
        viewport.render();
      }

      // Collect annotation details for the report
      const details: Array<{ title: string; lines: string[]; color?: string }> = [];

      if (currentStage === WorkflowStage.MEASUREMENTS) {
        const overlays = annotationOverlays.filter((overlay) => overlay.viewportId === viewportId);
        const allAnnotations = cornerstoneTools.annotation.state.getAllAnnotations();

        const annotationsForViewport = allAnnotations.filter((ann: any) => {
          const toolName = ann.metadata?.toolName;
          const metaViewportId = ann.metadata?.viewportId;
          if (metaViewportId) {
            return metaViewportId === viewportId;
          }
          if (toolName === 'SmoothPolygon' || toolName === 'AxialLine') {
            return viewportId === 'axial';
          }
          if (toolName === 'MPRLongAxisLine') {
            return viewportId === 'sagittal' || viewportId === 'coronal';
          }
          return false;
        });

        overlays.forEach((overlay) => {
          const labelInfo = annotationLabels[overlay.annotationUID];
          const title = labelInfo?.text || overlay.lines[0] || 'Annotation';
          const lines = overlay.lines.filter((line) => line !== title);
          details.push({
            title,
            lines: lines.length > 0 ? lines : overlay.lines,
            color: labelInfo?.color,
          });
        });

        annotationsForViewport.forEach((ann: any) => {
          const labelInfo = annotationLabels[ann.annotationUID];
          if (labelInfo) {
            const stats = ann.data?.cachedStats;
            let lengthValue: number | undefined;
            if (typeof stats?.length === 'number') {
              lengthValue = stats.length;
            } else if (stats && typeof stats === 'object') {
              const keys = Object.keys(stats);
              for (const key of keys) {
                const entry = (stats as any)[key];
                if (entry && typeof entry.length === 'number') {
                  lengthValue = entry.length;
                  break;
                }
                if (entry && typeof entry.textLines === 'object' && Array.isArray(entry.textLines)) {
                  const lengthLine = entry.textLines.find((line: string) => line.toLowerCase().includes('length'));
                  if (lengthLine) {
                    details.push({
                      title: labelInfo.text,
                      lines: [lengthLine],
                      color: labelInfo.color,
                    });
                    lengthValue = undefined;
                    break;
                  }
                }
              }
            }

            if (typeof lengthValue === 'number' && isFinite(lengthValue)) {
              details.push({
                title: labelInfo.text,
                lines: [`Length: ${lengthValue.toFixed(2)} mm`],
                color: labelInfo.color,
              });
            }
          }
        });
      }

      // Convert captured canvas to data URL
      const imageDataUrl = capturedCanvas.toDataURL('image/png');
      onAddScreenshotToReport({
        viewportId,
        imageDataUrl,
        capturedAt: new Date().toISOString(),
        workflowStepId: currentWorkflowStep?.id,
        workflowStepName: currentWorkflowStep?.name,
        annotationUID,
        details: details.filter((detail) => detail.lines.length > 0),
      });
      console.log(`📸 Added ${viewportId} viewport screenshot to report.`);
    } catch (error) {
      console.error('Failed to capture viewport screenshot for report:', error);
    }
  }, [
    annotationOverlays,
    annotationLabels,
    currentStage,
    currentWorkflowStep?.id,
    currentWorkflowStep?.name,
    onAddScreenshotToReport,
  ]);

  const getViewportMenuItems = (viewportId: string | null): ContextMenuItem[] => {
    if (currentStage !== WorkflowStage.MEASUREMENTS) {
      return [];
    }

    const measurementToolItems: ContextMenuItem[] = [
      {
        label: `Line${activeTool === 'AxialLine' ? ' (Active)' : ''}`,
        icon: <FaRuler />,
        onClick: () => handleToolChange('AxialLine'),
      },
      {
        label: `Polygon${activeTool === 'SmoothPolygon' ? ' (Active)' : ''}`,
        icon: <FaDrawPolygon />,
        onClick: () => handleToolChange('SmoothPolygon'),
      },
      {
        label: `Angle${activeTool === 'Angle' ? ' (Active)' : ''}`,
        icon: <FaDraftingCompass />,
        onClick: () => handleToolChange('Angle'),
      },
      {
        label: `Probe${activeTool === 'Probe' ? ' (Active)' : ''}`,
        icon: <FaBullseye />,
        onClick: () => handleToolChange('Probe'),
      },
      {
        label: `ROI${activeTool === 'RectangleROI' ? ' (Active)' : ''}`,
        icon: <FaVectorSquare />,
        onClick: () => handleToolChange('RectangleROI'),
      },
      {
        label: `Marker${activeTool === 'Label' ? ' (Active)' : ''}`,
        icon: <FaMapMarkerAlt />,
        onClick: () => handleToolChange('Label'),
      },
      {
        label: `Circle${activeTool === 'CircleROI' ? ' (Active)' : ''}`,
        icon: <FaCircle />,
        onClick: () => handleToolChange('CircleROI'),
      },
      {
        label: `Rectangle${activeTool === 'RectangleROI' ? ' (Active)' : ''}`,
        icon: <FaRegSquare />,
        onClick: () => handleToolChange('RectangleROI'),
      },
    ];

    const workflowManagerInstance = getWorkflowManager();
    const workflowMenuItems: ContextMenuItem[] = workflowManagerInstance
      .getAllSteps()
      .map((step) => {
        const isCurrent = step.id === currentWorkflowStep?.id;
        const isComplete = !!step.completed;
        const labelSuffix = isCurrent ? ' (Current)' : isComplete ? ' (Done)' : '';
        return {
          label: `${step.name}${labelSuffix}`,
          icon: isComplete ? <FaCheck className="text-green-400" /> : isCurrent ? <FaPlay className="text-blue-400" /> : undefined,
          onClick: () => {
            if (onWorkflowStepSelect) {
              onWorkflowStepSelect(step.id);
            }
          },
          disabled: !onWorkflowStepSelect,
        };
      });

    const items: ContextMenuItem[] = [
      {
        label: 'Add Screenshot to Report',
        icon: <FaCamera />,
        disabled: !viewportId || !onAddScreenshotToReport,
        onClick: () => {
          if (viewportId) {
            captureViewportScreenshot(viewportId);
          }
        },
      },
      {
        label: 'Measurement Tools',
        icon: <FaTools />,
        disabled: measurementToolItems.length === 0,
        children: measurementToolItems,
      },
    ];

    if (workflowMenuItems.length > 0) {
      items.push({
        label: 'Workflow',
        icon: <FaListUl />,
        disabled: !onWorkflowStepSelect,
        children: workflowMenuItems,
      });
    }

    return items;
  };

  const renderAnnotationOverlayElements = (viewportId: string) => {
    return annotationOverlays
      .filter(overlay => overlay.viewportId === viewportId)
      .map(overlay => {
        const labelInfo = annotationLabels[overlay.annotationUID];
        const measurementLines = labelInfo
          ? overlay.lines.filter(line => line !== labelInfo.text)
          : overlay.lines;

        const viewport = renderingEngineRef.current?.getViewport(viewportId);
        const viewportElement = getViewportElementById(viewportId);
        const annotations = cornerstoneTools.annotation.state.getAllAnnotations();
        const annotation = annotations.find((ann: any) => ann.annotationUID === overlay.annotationUID);

        let anchorDisplay: Types.Point2 | null = null;
        if (annotation && viewport) {
          const anchorWorld = getAnnotationAnchorPoint(annotation);
          if (anchorWorld) {
            const canvasAnchor = viewport.worldToCanvas(anchorWorld);
            if (Array.isArray(canvasAnchor) && canvasAnchor.length === 2) {
              anchorDisplay = canvasToDisplayPoint(viewport, viewportElement, canvasAnchor as Types.Point2);
            }
          }
        }

        const allLabelLines = labelInfo ? [labelInfo.text, ...measurementLines] : measurementLines;
        const estimatedWidth = Math.max(
          80,
          ...allLabelLines.map(line => line.length * 7 + 16)
        );
        const estimatedHeight = Math.max(18, allLabelLines.length * 16 || 18);
        const labelAttachX = overlay.x + estimatedWidth / 2 - 10;
        const labelAttachY = overlay.y + estimatedHeight / 2 - 10;

        return (
          <React.Fragment key={overlay.uid}>
            {anchorDisplay && viewportElement && (
              <svg
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
                style={{ overflow: 'visible' }}
              >
                <line
                  x1={labelAttachX}
                  y1={labelAttachY}
                  x2={anchorDisplay[0]}
                  y2={anchorDisplay[1]}
                  stroke={labelInfo?.color || '#ffff00'}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
              </svg>
            )}
          <div
            className="absolute z-40 cursor-move"
            style={{
              left: `${overlay.x}px`,
              top: `${overlay.y}px`,
              padding: '2px',
              userSelect: 'none',
              pointerEvents: 'auto'
            }}
            ref={undefined}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setViewportContextMenu(null);
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                annotationUID: overlay.annotationUID,
                viewportId: overlay.viewportId
              });
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const rect = e.currentTarget.parentElement?.getBoundingClientRect();
              if (rect) {
                setDraggingOverlay(overlay.uid);
                setDragOffset({
                  x: (e.clientX - rect.left) - overlay.x,
                  y: (e.clientY - rect.top) - overlay.y
                });
              }
            }}
            onMouseMove={(e) => {
              if (draggingOverlay === overlay.uid) {
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.parentElement?.getBoundingClientRect();
                if (rect) {
                  const mouseX = e.clientX - rect.left;
                  const mouseY = e.clientY - rect.top;
                  const newX = mouseX - dragOffset.x;
                  const newY = mouseY - dragOffset.y;

                  const annotations = cornerstoneTools.annotation.state.getAllAnnotations();
                  const annotation = annotations.find((ann: any) => ann.annotationUID === overlay.uid);
                  if (annotation) {
                    if (!annotation.metadata) annotation.metadata = {};
                    annotation.metadata.customTextPosition = { x: newX, y: newY, userMoved: true };
                  }

                  setAnnotationOverlays(prev =>
                    prev.map(o =>
                      o.uid === overlay.uid ? { ...o, x: newX, y: newY, userMoved: true } : o
                    )
                  );
                }
              }
            }}
            onMouseUp={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDraggingOverlay(null);
            }}
            onMouseLeave={(e) => {
              if (draggingOverlay === overlay.uid) {
                e.preventDefault();
                e.stopPropagation();
                setDraggingOverlay(null);
              }
            }}
          >
            {labelInfo && (
              <div
                style={{
                  color: labelInfo.color,
                  fontSize: '15px',
                  fontFamily: 'Arial, sans-serif',
                  fontWeight: 'bold',
                  lineHeight: '1.3',
                  textShadow: '1px 1px 3px rgba(0, 0, 0, 1), -1px -1px 3px rgba(0, 0, 0, 1)',
                  whiteSpace: 'nowrap',
                  marginBottom: measurementLines.length > 0 ? 4 : 0,
                  borderBottom: measurementLines.length > 0 ? `2px solid ${labelInfo.color}` : undefined,
                  paddingBottom: measurementLines.length > 0 ? 2 : 0
                }}
              >
                {labelInfo.text}
              </div>
            )}
            {measurementLines.map((line, index) => (
              <div
                key={index}
                style={{
                  color: '#ffff00',
                  fontSize: '13px',
                  fontFamily: 'Arial, sans-serif',
                  fontWeight: 'bold',
                  lineHeight: '1.3',
                  textShadow: '1px 1px 2px rgba(0, 0, 0, 0.9), -1px -1px 2px rgba(0, 0, 0, 0.9)',
                  whiteSpace: 'nowrap'
                }}
              >
                {line}
              </div>
            ))}
          </div>
          </React.Fragment>
        );
      });
  };

  const [labelModal, setLabelModal] = useState<{
    visible: boolean;
    annotationUID: string;
    currentLabel: string;
    currentColor: string;
  } | null>(null);
  const [deleteWarningModal, setDeleteWarningModal] = useState<{
    visible: boolean;
    targetStage: WorkflowStage;
  } | null>(null);
  const [maximizedViewport, setMaximizedViewport] = useState<string | null>(null);
  const [projectionAngle, setProjectionAngle] = useState<number>(0); // LAO/RAO angle for 3D view
  const [cameraOrientation, setCameraOrientation] = useState<{
    viewAngle: number; // Rotation around Z-axis
    tiltAngle: number; // Tilt up/down
  }>({ viewAngle: 0, tiltAngle: 0 });
  const [volume3DRange, setVolume3DRange] = useState<{
    lower: number; // Lower HU threshold
    upper: number; // Upper HU threshold
  }>({ lower: 150, upper: 300 }); // Default: show contrast-enhanced vessels, hide bones
  const [cropRadius, setCropRadius] = useState<number>(50); // Crop radius in mm around centerline
  const [isCroppingEnabled, setIsCroppingEnabled] = useState<boolean>(true); // Volume cropping enabled by default

  // Use refs for imageInfo to avoid re-renders that break CrosshairsTool
  const imageInfoRef = useRef<any>(null);

  // Use refs for workflow props to avoid closure issues in event handlers
  const workflowControlledRef = useRef<boolean>(workflowControlled);
  const currentWorkflowStepRef = useRef<MeasurementStep | null>(currentWorkflowStep);
  const pendingToolRef = useRef<string | null>(null);
  const workflowLabelAnnotationsRef = useRef<Record<string, string>>({});
  const autoAdvanceWorkflowRef = useRef<boolean>(autoAdvanceWorkflow);
  const measurementAnnotationByStepRef = useRef<Record<string, string>>({});
  const onMeasurementCompleteRef = useRef(onMeasurementComplete);

  // Track if we should skip auto-scroll (when user is manually scrolling)
  const skipAutoScrollRef = useRef<boolean>(false);
  const autoScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastAutoScrolledStepRef = useRef<string | null>(null); // Track which step we last auto-scrolled to

  // Track if current measurement step has been completed but not confirmed
  const [measurementReadyForConfirm, setMeasurementReadyForConfirm] = useState(false);
  const [currentMeasurementData, setCurrentMeasurementData] = useState<{
    annotationUID: string;
    measuredValue: any;
  } | null>(null);

  const [windowLevel, setWindowLevel] = useState({ window: 900, level: 350 }); // Cardiac CTA default
  const [wlDropdownOpen, setWlDropdownOpen] = useState(false); // W/L dropdown state
  const [phaseInfo, setPhaseInfo] = useState<any>(null); // Cardiac phase information
  const [selectedPhase, setSelectedPhase] = useState<number | null>(null); // Currently selected phase
  const [isPlayingCine, setIsPlayingCine] = useState(false); // Cine playback state
  const [isPreloading, setIsPreloading] = useState(false); // Track if we're in preloading mode
  const [cprActorsReady, setCprActorsReady] = useState(false); // Track when CPR actors are set up
  const running = useRef(false);
  const cineIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const preloadedVolumesRef = useRef<{ [phaseIndex: number]: string }>({}); // Store preloaded volume IDs
  const orientationWidgetRef = useRef<any>(null); // VTK orientation marker widget
  const renderingEngineRef = useRef<RenderingEngine | null>(null);
  const allPhasesLoadedRef = useRef(false); // Track if all phases have been loaded once
  const isSwitchingPhaseRef = useRef(false); // Track if we're currently switching phases
  const savedCameraStatesRef = useRef<any>({}); // Store camera states to preserve crosshair position
  const savedCrosshairFocalPointRef = useRef<any>(null); // Store crosshair focal point during phase switching

  // Use static IDs like App.tsx
  const toolGroupId = "MPR_TOOLGROUP_ID";
  const renderingEngineId = "mprRenderingEngine";
  const synchronizerId = "MPR_SLAB_THICKNESS_SYNCHRONIZER_ID";
  const cameraPositionSynchronizerId = "MPR_CAMERA_POSITION_SYNCHRONIZER_ID";
  const zoomSynchronizerId = "MPR_ZOOM_SYNCHRONIZER_ID";

  // Store synchronizer refs for cleanup
  const slabSynchronizerRef = useRef<any>(null);
  const cameraSynchronizerRef = useRef<any>(null);
  const zoomSynchronizerRef = useRef<any>(null);
  const lockedFocalPointRef = useRef<Types.Point3 | null>(null);
  const centerlineDataRef = useRef<any>(null); // Store centerline for scrolling
  const spherePositionsRef = useRef<Types.Point3[]>([]); // Store the 3 sphere positions
  const currentSphereIndexRef = useRef<number>(1); // Current sphere (0=LV, 1=valve, 2=ascending)
  const currentCenterlineIndexRef = useRef<number>(0); // Current position along centerline - now supports fractional values for smooth scrolling
  const cprScrollStepSizeRef = useRef<number>(0.1); // Fractional step size for CPR scrolling (in index units, not mm)
  const cuspDotsRef = useRef<{ id: string; pos: [number, number, number]; color: string; cuspType: string }[]>([]); // Store cusp dots
  const savedCameraZoomRef = useRef<number>(60); // Store zoom level (parallelScale) for preservation between stages
  const annulusLineActorsRef = useRef<{ sagittal: any; coronal: any } | null>(null); // Store annulus reference line actors
  const cprPositionLineActorsRef = useRef<{ sagittal: any; coronal: any } | null>(null); // Store CPR position indicator line actors
  const cprPositionRatioRef = useRef<number>(0); // Store current position ratio for redrawing after render
  const cprAnnulusRatioRef = useRef<number | undefined>(undefined); // Store annulus position ratio for reference line
  const cprActorsRef = useRef<{ actor: any; mapper: any; viewportId: string; config: any }[]>([]); // Store CPR actors and mappers when in CPR mode
  const initialViewUpRef = useRef<Types.Point3 | null>(null); // Store initial viewUp from first centerline alignment (ANNULUS_DEFINITION)
  const firstAdjustmentDoneRef = useRef<boolean>(false); // Track whether first adjustment has been completed (prevent re-running on tool change)
  const lockedAxialCameraRef = useRef<{ position: Types.Point3; viewUp: Types.Point3; parallelScale: number } | null>(null); // Store locked camera orientation for annular plane
  const currentVolumeRef = useRef<any>(null); // Store current volume for CPR conversion
  const centerlinePolyDataRef = useRef<any>(null); // Store VTK centerline polydata for CPR rotation
  const cprRotationAngleRef = useRef<number>(0); // Store cumulative CPR rotation angle in radians
  const cprRotationCallbackRef = useRef<((deltaAngle: number) => void) | null>(null); // Store CPR rotation callback in stable ref
  const renderModeRef = useRef<string>(renderMode); // Store current render mode to avoid closure issues
  const originalCameraStatesRef = useRef<{ [viewportId: string]: any }>({}); // Store original camera states before CPR
  const isSettingUpCPRRef = useRef<boolean>(false); // Prevent concurrent setupCPRActors calls
  const axialReferenceFrameRef = useRef<{ viewUp: Types.Point3; viewRight: Types.Point3; viewPlaneNormal: Types.Point3 } | null>(null); // Store axial camera reference frame for rotation
  const overlayUpdateIntervalRef = useRef<number | null>(null); // Store overlay update interval ID

  // Keep workflow refs up to date to avoid closure issues in event handlers
  useEffect(() => {
    workflowControlledRef.current = workflowControlled;
    currentWorkflowStepRef.current = currentWorkflowStep;
    onMeasurementCompleteRef.current = onMeasurementComplete;
    autoAdvanceWorkflowRef.current = autoAdvanceWorkflow;
  }, [workflowControlled, currentWorkflowStep, onMeasurementComplete, autoAdvanceWorkflow]);

  // Reset confirmation state when workflow step changes
  useEffect(() => {
    setMeasurementReadyForConfirm(false);
    setCurrentMeasurementData(null);
  }, [currentWorkflowStep]);

  useEffect(() => {
    setContextMenu(null);
    setViewportContextMenu(null);
  }, [currentStage]);

  // Use centerline from props when available (during measurements stage)
  useEffect(() => {
    if (centerlineDataProp && currentStage === WorkflowStage.MEASUREMENTS) {
      centerlineDataRef.current = centerlineDataProp;
    }
  }, [centerlineDataProp, currentStage]);

  // Preload all phases sequentially when play is first hit
  useEffect(() => {
    if (!isPlayingCine || !phaseInfo || !phaseInfo.isMultiPhase || !patientInfo) {
      return;
    }

    const preloadSequentially = async () => {
      // Check if all phases are already loaded
      const allLoaded = Object.keys(preloadedVolumesRef.current).length === phaseInfo.totalPhases;

      if (allLoaded) {
        console.log('✅ All phases already loaded, starting cine immediately');
        allPhasesLoadedRef.current = true;
        setIsPreloading(false);
        return;
      }

      console.log('🔄 First time play - preloading all phases sequentially...');
      setIsPreloading(true);

      try {
        // Load each phase one by one and display it
        for (let phaseIndex = 0; phaseIndex < phaseInfo.totalPhases; phaseIndex++) {
          if (!preloadedVolumesRef.current[phaseIndex]) {
            console.log(`📥 Preloading phase ${phaseIndex + 1}/${phaseInfo.totalPhases}...`);

            // Set this as the current phase so it displays
            setSelectedPhase(phaseIndex);

            // Wait a bit for the phase to load and display
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        console.log('✅ All phases preloaded! Starting 1.5s loop...');
        allPhasesLoadedRef.current = true;
        setIsPreloading(false);
      } catch (error) {
        console.error('❌ Error during sequential preload:', error);
        setIsPreloading(false);
      }
    };

    preloadSequentially();
  }, [isPlayingCine, phaseInfo, patientInfo]);

  // Cine playback effect - play all phases in 1.5 seconds loop (only after preloading)
  useEffect(() => {
    if (isPlayingCine && phaseInfo && phaseInfo.isMultiPhase && !isPreloading && allPhasesLoadedRef.current) {
      // Calculate interval: 1500ms (1.5 seconds) divided by number of phases
      const totalDuration = 1500; // 1.5 seconds in milliseconds
      const interval = totalDuration / phaseInfo.totalPhases;

      console.log(`🎬 Starting 1.5s cine loop: ${phaseInfo.totalPhases} phases (${interval.toFixed(0)}ms per phase)`);

      cineIntervalRef.current = setInterval(() => {
        setSelectedPhase(prevPhase => {
          const currentPhase = prevPhase ?? 0;
          const nextPhase = (currentPhase + 1) % phaseInfo.totalPhases;
          return nextPhase;
        });
      }, interval);

      return () => {
        if (cineIntervalRef.current) {
          clearInterval(cineIntervalRef.current);
          cineIntervalRef.current = null;
        }
      };
    } else {
      if (cineIntervalRef.current) {
        clearInterval(cineIntervalRef.current);
        cineIntervalRef.current = null;
      }
    }
  }, [isPlayingCine, phaseInfo, isPreloading]);

  // Phase switching effect - load and display the selected phase
  useEffect(() => {
    if (!phaseInfo || !phaseInfo.isMultiPhase || selectedPhase === null || !patientInfo) {
      return;
    }

    const switchPhase = async () => {
      try {
        isSwitchingPhaseRef.current = true;
        console.log(`🔄 Switching to phase ${selectedPhase + 1}/${phaseInfo.totalPhases}`);

        // Get or create volume for this phase
        let phaseVolumeId = preloadedVolumesRef.current[selectedPhase];

        if (!phaseVolumeId) {
          // Load this phase's volume by calling createImageIdsAndCacheMetaData with the selected phase
          console.log(`📥 Loading volume for phase ${selectedPhase + 1}...`);

          const { imageIds: phaseImageIds } = await createImageIdsAndCacheMetaData({
            StudyInstanceUID: patientInfo.studyInstanceUID!,
            SeriesInstanceUID: patientInfo.seriesInstanceUID!,
            wadoRsRoot: "http://127.0.0.1/orthanc/dicom-web",
            selectedPhase: selectedPhase, // Pass the selected phase
          });

          phaseVolumeId = `streamingImageVolume_phase${selectedPhase}_${Date.now()}`;

          const phaseVolume = await volumeLoader.createAndCacheVolume(phaseVolumeId, {
            imageIds: phaseImageIds,
          });

          // WAIT for the volume to fully load before continuing
          await phaseVolume.load();

          // Cache the volume ID
          preloadedVolumesRef.current[selectedPhase] = phaseVolumeId;
          console.log(`✅ Loaded phase ${selectedPhase + 1} volume: ${phaseVolumeId}`);
        }

        // Apply the phase volume to all viewports
        const viewportIds = ["axial", "sagittal", "coronal"];
        const renderingEngine = renderingEngineRef.current || new RenderingEngine(renderingEngineId);

        // Calculate W/L once
        const lower = windowLevel.level - windowLevel.window / 2;
        const upper = windowLevel.level + windowLevel.window / 2;

        // Save current camera states for all viewports BEFORE any changes
        viewportIds.forEach(id => {
          const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
          if (viewport) {
            savedCameraStatesRef.current[id] = viewport.getCamera();
          }
        });

        // CRITICAL: Save crosshair focal point from axial viewport
        const axialViewport = renderingEngine.getViewport("axial") as Types.IVolumeViewport;
        if (axialViewport) {
          const camera = axialViewport.getCamera();
          savedCrosshairFocalPointRef.current = [...camera.focalPoint]; // Clone the array
          console.log(`💾 Saved crosshair focal point:`, savedCrosshairFocalPointRef.current);
        }

        // Update all viewports with new volume - do all at once to minimize time
        await Promise.all(viewportIds.map(async (id) => {
          const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
          if (viewport) {
            await viewport.setVolumes([{
              volumeId: phaseVolumeId,
              callback: ({ volumeActor }) => {
                volumeActor.getProperty().getRGBTransferFunction(0).setRange(lower, upper);
              }
            }], false);
          }
        }));

        // Restore cameras for all viewports after volumes are set
        viewportIds.forEach(id => {
          const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
          const savedCamera = savedCameraStatesRef.current[id];
          if (viewport && savedCamera) {
            viewport.setCamera(savedCamera);
          }
        });

        // CRITICAL: Force render ALL viewports synchronously to restore crosshair sync
        renderingEngine.renderViewports(viewportIds);
        console.log(`✅ Rendered all viewports with restored cameras`);

        // CRITICAL FIX: Restore crosshair focal point after phase switch
        // The CrosshairsTool maintains its own internal state that gets lost during volume changes
        // We need to force it to update its focal point to the saved position
        if (savedCrosshairFocalPointRef.current) {
          console.log(`🎯 Restoring crosshair focal point:`, savedCrosshairFocalPointRef.current);

          // Wait a small moment for renders to complete, then force focal point update
          setTimeout(() => {
            viewportIds.forEach(id => {
              const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
              if (viewport) {
                const camera = viewport.getCamera();
                // Force set the camera with the saved focal point to trigger crosshair update
                viewport.setCamera({
                  ...camera,
                  focalPoint: savedCrosshairFocalPointRef.current as Types.Point3
                });
              }
            });

            // Force render again to show updated crosshairs
            renderingEngine.renderViewports(viewportIds);
            console.log(`✅ Crosshair focal point restored and synced across all viewports`);
          }, 50); // Small delay to ensure volumes are fully set
        }

        console.log(`✅ Switched to phase ${selectedPhase + 1} with W/L: ${windowLevel.window}/${windowLevel.level}`);
        isSwitchingPhaseRef.current = false;
      } catch (error) {
        console.error(`❌ Failed to switch to phase ${selectedPhase}:`, error);
        isSwitchingPhaseRef.current = false;
      }
    };

    switchPhase();
  }, [selectedPhase, phaseInfo, patientInfo]);

  // Handle global mouse events for dragging overlays
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (draggingOverlay) {
        e.preventDefault();
        const viewportElement = document.getElementById('axial');
        if (viewportElement) {
          const rect = viewportElement.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          const newX = mouseX - dragOffset.x;
          const newY = mouseY - dragOffset.y;

          // Store the custom position in the annotation metadata so it persists
          const annotations = cornerstoneTools.annotation.state.getAllAnnotations();
          const annotation = annotations.find((ann: any) => ann.annotationUID === draggingOverlay);
          if (annotation) {
            if (!annotation.metadata) annotation.metadata = {};
            annotation.metadata.customTextPosition = { x: newX, y: newY, userMoved: true };
          }

          setAnnotationOverlays(prev =>
            prev.map(o =>
              o.uid === draggingOverlay ? { ...o, x: newX, y: newY, userMoved: true } : o
            )
          );
        }
      }
    };

    const handleGlobalMouseUp = () => {
      if (draggingOverlay) {
        setDraggingOverlay(null);
      }
    };

    if (draggingOverlay) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [draggingOverlay, dragOffset]);

  // Delete annotation function (accessible from JSX)
  const deleteAnnotation = useCallback((annotationUID: string) => {
    try {
      console.log(`🗑️ Deleting annotation ${annotationUID.substring(0, 8)}`);

      // Get the annotation
      const allAnnotations = cornerstoneTools.annotation.state.getAllAnnotations();
      const annotation = allAnnotations.find((ann: any) => ann.annotationUID === annotationUID);

      if (!annotation) {
        console.warn('  ⚠️ Annotation not found');
        return;
      }

      // Remove annotation using Cornerstone's API
      cornerstoneTools.annotation.state.removeAnnotation(annotationUID);

      const labelUid = workflowLabelAnnotationsRef.current[annotationUID];
      if (labelUid) {
        cornerstoneTools.annotation.state.removeAnnotation(labelUid);
        delete workflowLabelAnnotationsRef.current[annotationUID];
      }

      Object.keys(measurementAnnotationByStepRef.current).forEach((stepId) => {
        if (measurementAnnotationByStepRef.current[stepId] === annotationUID) {
          delete measurementAnnotationByStepRef.current[stepId];
        }
      });

      // Remove associated overlay from React state
      setAnnotationOverlays(prev => prev.filter(o => o.annotationUID !== annotationUID));

      // Re-render viewports
      if (renderingEngineRef.current) {
        const viewportIds = ['axial', 'sagittal', 'coronal'];
        renderingEngineRef.current.renderViewports(viewportIds);
        console.log('  ✅ Annotation deleted and viewports re-rendered');
      }
    } catch (error) {
      console.error('  ❌ Failed to delete annotation:', error);
    }
  }, []);

  // Keyboard shortcuts for annotations (Delete key)
  useEffect(() => {
    if (currentStage !== WorkflowStage.MEASUREMENTS) return;

    const handleKeyDown = (evt: KeyboardEvent) => {
      // Delete key to delete selected annotation
      if (evt.key === 'Delete' || evt.key === 'Backspace') {
        // Get all annotations and find the highlighted one
        const allAnnotations = cornerstoneTools.annotation.state.getAllAnnotations();
        const highlightedAnnotation = allAnnotations.find((ann: any) => ann.highlighted);

        if (highlightedAnnotation) {
          evt.preventDefault();
          deleteAnnotation(highlightedAnnotation.annotationUID);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentStage, deleteAnnotation]);

  // Notify parent when active tool changes
  useEffect(() => {
    if (onActiveToolChange) {
      onActiveToolChange(activeTool);
    }
  }, [activeTool, onActiveToolChange]);

  useEffect(() => {
    if (currentStage !== WorkflowStage.MEASUREMENTS) {
      measurementAnnotationByStepRef.current = {};
    }
  }, [currentStage]);

  // Respond to tool change requests from parent
  useEffect(() => {
    if (requestedTool && requestedTool !== activeTool) {
      handleToolChange(requestedTool);
    }
  }, [requestedTool]);

  // Auto-activate appropriate tool when stage changes
  useEffect(() => {
    // Wait a bit for toolGroup to be initialized
    const timeoutId = setTimeout(() => {
      const defaultTool =
        currentStage === WorkflowStage.ROOT_DEFINITION ? 'SphereMarker' :
        currentStage === WorkflowStage.ANNULUS_DEFINITION ? 'CuspNadir' :
        activeTool;

      if (defaultTool !== activeTool) {
        console.log(`🎯 Auto-activating ${defaultTool} for stage:`, currentStage);
        handleToolChange(defaultTool);
      }
    }, 500); // Give time for viewport initialization

    return () => clearTimeout(timeoutId);
  }, [currentStage]);

  // Apply window/level preset from parent
  useEffect(() => {
    const renderingEngine = renderingEngineRef.current;
    if (!renderingEngine) return;

    // Map preset names to window/level values
    const presets: { [key: string]: { window: number; level: number } } = {
      'cardiac': { window: 400, level: 20 },  // -180 to 220
      'soft-tissue': { window: 400, level: 40 },
      'lung': { window: 1500, level: -500 },
      'bone': { window: 1800, level: 400 },
      'angio': { window: 600, level: 300 },
    };

    const wl = presets[windowLevelPreset] || presets['cardiac'];

    // Apply to all viewports
    const viewportIds = ['axial', 'sagittal', 'coronal'];
    viewportIds.forEach((id) => {
      try {
        const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
        if (viewport) {
          viewport.setProperties({
            voiRange: {
              lower: wl.level - wl.window / 2,
              upper: wl.level + wl.window / 2,
            },
          });
          viewport.render();
        }
      } catch (error) {
        console.warn(`Failed to apply W/L to ${id}:`, error);
      }
    });

    console.log(`📊 Applied W/L preset "${windowLevelPreset}": W=${wl.window}, L=${wl.level}`);
  }, [windowLevelPreset]);

  useEffect(() => {
    if (!patientInfo?.seriesInstanceUID) return;

    console.log('🔄 Stage changed to:', currentStage, '- Initializing MPR Viewport');

    // Wait for DOM layout to be fully computed before initialization
    // Use requestAnimationFrame to ensure browser has completed layout calculations
    let rafId: number;
    const timer = setTimeout(() => {
      rafId = requestAnimationFrame(() => {
        console.log('🔍 Checking element refs before initialization:', {
          axial: !!elementRefs.axial?.current,
          sagittal: !!elementRefs.sagittal?.current,
          coronal: !!elementRefs.coronal?.current,
          volume3D: !!elementRefs.volume3D?.current,
          measurement1: !!elementRefs.measurement1?.current,
        });

        // Double-check element dimensions
        if (elementRefs.axial?.current) {
          const rect = elementRefs.axial.current.getBoundingClientRect();
          console.log('📐 Axial element dimensions:', rect.width, 'x', rect.height);
        }

        initializeMPRViewport();
      });
    }, 150);

    // Cleanup function
    return () => {
      clearTimeout(timer);
      if (rafId) cancelAnimationFrame(rafId);
      cleanup();
    };
  }, [patientInfo, currentStage]);

  // Setup centerline-aligned MPR views when entering ANNULUS_DEFINITION stage
  // FIRST ADJUSTMENT: Align axial viewport perpendicular to centerline tangent at valve (red dot)
  // This provides initial rough cross-sectional view with proper anterior-posterior orientation
  // SECOND ADJUSTMENT: After 3 cusp dots placed, adjustToAnnularPlane() refines to true annular plane
  useEffect(() => {
    console.log('🔍 Centerline alignment check:', {
      currentStage,
      isAnnulusStage: currentStage === WorkflowStage.ANNULUS_DEFINITION,
      sphereCount: existingSpheres?.length || 0,
      hasRenderingEngine: !!renderingEngineRef.current,
      firstAdjustmentDone: firstAdjustmentDoneRef.current,
      spheres: existingSpheres
    });

    if (currentStage !== WorkflowStage.ANNULUS_DEFINITION) {
      // Reset flag when leaving annulus definition stage
      firstAdjustmentDoneRef.current = false;
      return;
    }
    if (!existingSpheres || existingSpheres.length < 3) {
      console.warn('⚠️ Cannot setup centerline alignment - insufficient spheres');
      return;
    }
    if (!renderingEngineRef.current) {
      console.warn('⚠️ Cannot setup centerline alignment - no rendering engine');
      return;
    }

    // CRITICAL: Only run first adjustment once per annulus definition session
    // This prevents camera reset when switching tools or updating state
    if (firstAdjustmentDoneRef.current) {
      console.log('⏭️ First adjustment already done, skipping camera reset');
      return;
    }

    console.log('✅ ANNULUS_DEFINITION stage: Setting up initial centerline-aligned view at valve (FIRST ADJUSTMENT)...');
    firstAdjustmentDoneRef.current = true;

    const timer = setTimeout(() => {
      console.log('🎯 Setting up centerline-aligned axial view at valve position');

      // Generate centerline from root points
      // CRITICAL: existingSpheres already have proper types from state.rootPoints
      // Just need to convert to RootPoint format with proper type field
      const centerlineData = CenterlineGenerator.generateFromRootPoints(
        existingSpheres.map((sphere, index) => {
          // Determine type based on position in array
          let type: any;
          if (existingSpheres.length === 3) {
            type = index === 0 ? RootPointType.LV_OUTFLOW :
                  index === 1 ? RootPointType.AORTIC_VALVE :
                  RootPointType.ASCENDING_AORTA;
          } else {
            const middleIndex = Math.floor(existingSpheres.length / 2);
            type = index === 0 ? RootPointType.LV_OUTFLOW :
                  index === middleIndex ? RootPointType.AORTIC_VALVE :
                  index === existingSpheres.length - 1 ? RootPointType.ASCENDING_AORTA :
                  RootPointType.EXTENDED;
          }
          return {
            id: sphere.id,
            position: sphere.pos,
            type: type,
            timestamp: Date.now()
          };
        })
      );

      // Store centerline data for scrolling
      centerlineDataRef.current = centerlineData;

      // Calculate optimal scroll step size
      const numPoints = centerlineData.position.length / 3;
      let totalLength = 0;
      for (let i = 1; i < numPoints; i++) {
        const dx = centerlineData.position[i * 3] - centerlineData.position[(i - 1) * 3];
        const dy = centerlineData.position[i * 3 + 1] - centerlineData.position[(i - 1) * 3 + 1];
        const dz = centerlineData.position[i * 3 + 2] - centerlineData.position[(i - 1) * 3 + 2];
        totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      const avgSegmentLength = totalLength / (numPoints - 1);
      const targetStepMM = 0.1;
      cprScrollStepSizeRef.current = targetStepMM / avgSegmentLength;

      console.log(`📏 Centerline: ${numPoints} points, ${totalLength.toFixed(1)}mm total`);

      // Find the RED sphere (valve)
      const valveSphere = existingSpheres.find(sphere => sphere.color === 'red');
      if (!valveSphere) {
        console.error('❌ Could not find red (valve) sphere');
        return;
      }

      const valveCenterlinePos = valveSphere.pos;

      // Find closest centerline point to valve
      let closestIndex = 0;
      let minDist = Infinity;
      for (let i = 0; i < numPoints; i++) {
        const x = centerlineData.position[i * 3];
        const y = centerlineData.position[i * 3 + 1];
        const z = centerlineData.position[i * 3 + 2];
        const dist = Math.sqrt(
          Math.pow(x - valveCenterlinePos[0], 2) +
          Math.pow(y - valveCenterlinePos[1], 2) +
          Math.pow(z - valveCenterlinePos[2], 2)
        );
        if (dist < minDist) {
          minDist = dist;
          closestIndex = i;
        }
      }

      currentCenterlineIndexRef.current = closestIndex;

      // Get the actual closest centerline point (not the sphere position)
      const closestCenterlinePoint: Types.Point3 = [
        centerlineData.position[closestIndex * 3],
        centerlineData.position[closestIndex * 3 + 1],
        centerlineData.position[closestIndex * 3 + 2]
      ];

      console.log('📍 Valve sphere position:', valveCenterlinePos);
      console.log('📍 Closest centerline point:', closestCenterlinePoint);
      console.log('📏 Distance from sphere to centerline:', minDist.toFixed(2), 'mm');

      // Calculate centerline tangent at valve
      const prevIdx = Math.max(0, closestIndex - 1);
      const nextIdx = Math.min(numPoints - 1, closestIndex + 1);
      const prev = [
        centerlineData.position[prevIdx * 3],
        centerlineData.position[prevIdx * 3 + 1],
        centerlineData.position[prevIdx * 3 + 2]
      ];
      const next = [
        centerlineData.position[nextIdx * 3],
        centerlineData.position[nextIdx * 3 + 1],
        centerlineData.position[nextIdx * 3 + 2]
      ];

      const tangent = [
        next[0] - prev[0],
        next[1] - prev[1],
        next[2] - prev[2]
      ];
      const tangentLength = Math.sqrt(tangent[0] ** 2 + tangent[1] ** 2 + tangent[2] ** 2);
      tangent[0] /= tangentLength;
      tangent[1] /= tangentLength;
      tangent[2] /= tangentLength;

      console.log('📐 Centerline tangent at valve:', tangent);

      // Position viewports perpendicular to centerline
      const renderingEngine = renderingEngineRef.current;
      const axialViewport = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
      const sagittalViewport = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
      const coronalViewport = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;

      if (axialViewport && sagittalViewport && coronalViewport) {
        const cameraDistance = 300;

        // Axial: looks along centerline tangent
        const axialCamera = axialViewport.getCamera();
        // Preserve current zoom level
        const currentParallelScale = axialCamera.parallelScale || 150;

        // Calculate new camera properties using the CENTERLINE point as focal point
        const newCameraPos: Types.Point3 = [
          closestCenterlinePoint[0] + tangent[0] * cameraDistance,
          closestCenterlinePoint[1] + tangent[1] * cameraDistance,
          closestCenterlinePoint[2] + tangent[2] * cameraDistance
        ];

        // CRITICAL: Calculate viewUp using SAME method as scroll handler (lines 6086-6100)
        // This ensures correct orientation from the start (anterior at 12 o'clock)
        const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
        const cross = [
          tangent[1] * reference[2] - tangent[2] * reference[1],
          tangent[2] * reference[0] - tangent[0] * reference[2],
          tangent[0] * reference[1] - tangent[1] * reference[0]
        ];
        const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
        const initialViewUp: Types.Point3 = crossLen > 0
          ? [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3
          : [0, 0, 1] as Types.Point3;

        console.log('📐 Setting axial viewport camera perpendicular to centerline (FIRST ADJUSTMENT):');
        console.log('   Camera position:', newCameraPos);
        console.log('   Focal point (centerline):', closestCenterlinePoint);
        console.log('   ViewUp (calculated from tangent):', initialViewUp);
        console.log('   Tangent:', tangent);
        console.log('   Reference:', reference);
        console.log('   Preserved parallelScale:', currentParallelScale);

        // Set camera - spread existing camera to preserve clippingRange and other properties
        // This ensures crosshair synchronization is maintained
        axialViewport.setCamera({
          ...axialCamera,
          position: newCameraPos,
          focalPoint: closestCenterlinePoint,
          viewUp: initialViewUp,
          parallelScale: currentParallelScale // Preserve zoom level from ROOT_DEFINITION
        });

        // CRITICAL: Store initial viewUp for second adjustment (after cusp dots placed)
        // The second adjustment will preserve this anterior-posterior orientation
        initialViewUpRef.current = initialViewUp;
        console.log('💾 Stored initial viewUp for second adjustment:', initialViewUp);

        lockedFocalPointRef.current = closestCenterlinePoint;

        // CRITICAL: Programmatically trigger a tiny focal point change to force slice update
        // This mimics what happens when you scroll
        const triggerSliceUpdate = () => {
          const cam = axialViewport.getCamera();
          const epsilon = 0.001;

          // Move focal point by tiny amount
          axialViewport.setCamera({
            ...cam,
            focalPoint: [
              closestCenterlinePoint[0] + epsilon,
              closestCenterlinePoint[1] + epsilon,
              closestCenterlinePoint[2] + epsilon
            ] as Types.Point3
          });
          axialViewport.render();

          // Move back to correct position
          setTimeout(() => {
            axialViewport.setCamera({
              ...cam,
              focalPoint: closestCenterlinePoint,
            });
            axialViewport.render();
          }, 5);
        };

        // Initial render
        axialViewport.render();
        sagittalViewport.render();
        coronalViewport.render();

        // Trigger slice updates with delays
        setTimeout(triggerSliceUpdate, 10);

        setTimeout(() => {
          renderingEngine.renderViewports(['axial', 'sagittal', 'coronal']);
        }, 50);

        setTimeout(() => {
          renderingEngine.renderViewports(['axial', 'sagittal', 'coronal']);
        }, 150);
      }
    }, 100); // Reduced timeout from 500ms to 100ms for faster response

    return () => clearTimeout(timer);
  }, [currentStage, existingSpheres]);

  // Setup/cleanup CPR actors when render mode changes
  useEffect(() => {
    const renderingEngine = renderingEngineRef.current;
    if (!renderingEngine) return;

    if (renderMode === 'cpr' && centerlineDataRef.current && currentVolumeRef.current) {
      console.log('🔄 Render mode changed to CPR, setting up CPR actors...');

      // Save camera states NOW, before any modifications (only if not already saved)
      if (Object.keys(originalCameraStatesRef.current).length === 0) {
        const viewportsToSave = ['axial', 'sagittal', 'coronal']; // Save all three viewports
        viewportsToSave.forEach(viewportId => {
          const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
          if (viewport) {
            const camera = viewport.getCamera();
            originalCameraStatesRef.current[viewportId] = {
              position: [...camera.position] as Types.Point3,
              focalPoint: [...camera.focalPoint] as Types.Point3,
              viewUp: [...camera.viewUp] as Types.Point3,
              parallelScale: camera.parallelScale
            };
            console.log(`💾 [PRE-CPR] Saved original camera state for ${viewportId}:`, originalCameraStatesRef.current[viewportId]);
          }
        });
      }

      // Mark actors as not ready (rotation angle will be captured after CPR setup)
      setCprActorsReady(false);
      // Wait a bit for viewports to be ready, then setup actors
      // Callback will be set automatically by the useEffect once actors are ready
      setTimeout(async () => {
        // CRITICAL: Capture rotation angle BEFORE setupCPRActors
        // setupCPRActors uses cprRotationAngleRef.current to set initial rotation on mappers
        const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
        if (toolGroup) {
          const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as any;
          if (fixedCrosshairTool && typeof fixedCrosshairTool.getRotationAngle === 'function') {
            const currentRotation = fixedCrosshairTool.getRotationAngle();
            console.log(`📐 Capturing current crosshair rotation BEFORE CPR setup: ${(currentRotation * 180 / Math.PI).toFixed(1)}° (${currentRotation.toFixed(4)} rad)`);

            // Store rotation angle BEFORE setupCPRActors so it can use it
            cprRotationAngleRef.current = currentRotation;
          } else {
            console.warn('⚠️ Could not get crosshair rotation angle, using 0°');
            cprRotationAngleRef.current = 0;
          }
        } else {
          console.warn('⚠️ Tool group not found, using rotation 0°');
          cprRotationAngleRef.current = 0;
        }

        // Now setup CPR actors - they will use the rotation angle we just captured
        await setupCPRActors();
        console.log('✅ CPR actors setup complete with initial rotation');

        setCprActorsReady(true); // Mark actors as ready

        // Initialize CPR position indicator lines at current centerline index
        requestAnimationFrame(() => {
          updateCPRPositionLines(currentCenterlineIndexRef.current);
          console.log('✅ CPR position indicator lines initialized');
        });

        // Add event listeners to redraw CPR lines on zoom/pan (camera changes)
        const sagittalElement = elementRefs.sagittal.current;
        const coronalElement = elementRefs.coronal.current;

        const redrawCPRLines = () => {
          if (cprPositionRatioRef.current !== undefined && cprActorsReady) {
            requestAnimationFrame(() => {
              drawCPRPositionLineOnCanvas('sagittal', cprPositionRatioRef.current!, cprAnnulusRatioRef.current);
              drawCPRPositionLineOnCanvas('coronal', cprPositionRatioRef.current!, cprAnnulusRatioRef.current);
            });
          }
        };

        if (sagittalElement) {
          sagittalElement.addEventListener(Enums.Events.CAMERA_MODIFIED, redrawCPRLines);
          sagittalElement.addEventListener(Enums.Events.IMAGE_RENDERED, redrawCPRLines);
        }
        if (coronalElement) {
          coronalElement.addEventListener(Enums.Events.CAMERA_MODIFIED, redrawCPRLines);
          coronalElement.addEventListener(Enums.Events.IMAGE_RENDERED, redrawCPRLines);
        }

        console.log('✅ CPR line redraw listeners added for zoom/pan');
      }, 500);
    } else if (renderMode === 'mpr') {
      console.log('🔄 Render mode changed to MPR, removing CPR actors...');
      setCprActorsReady(false); // Mark actors as not ready
      // Remove CPR actors when switching back to MPR
      cprActorsRef.current.forEach(({ actor, viewportId }) => {
        const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
        if (viewport) {
          try {
            viewport.removeActors([`cprActor_${viewportId}`]);
          } catch (e) {
            console.warn('Failed to remove CPR actor:', e);
          }
        }
      });
      cprActorsRef.current = [];

      // Clear CPR position indicator lines reference (canvas drawings will be cleared on viewport render)
      cprPositionLineActorsRef.current = null;
      console.log('🧹 Cleared CPR position indicator lines');

      // Show volume actors again and restore camera states
      const viewportIds = ['axial', 'sagittal', 'coronal'];
      viewportIds.forEach(id => {
        const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
        if (viewport) {
          // Re-enable volume actors
          const allActors = viewport.getActors();
          allActors.forEach((actorEntry: any) => {
            if (actorEntry.actor && typeof actorEntry.actor.setVisibility === 'function') {
              actorEntry.actor.setVisibility(true);
              console.log(`  👁️ Restored volume actor visibility in ${id}`);
            }
          });

          // Restore original camera state if available, otherwise reset camera
          const savedCamera = originalCameraStatesRef.current[id];
          if (savedCamera) {
            console.log(`📷 Restoring original camera for ${id}:`, savedCamera);
            viewport.setCamera(savedCamera);
          } else {
            console.log(`🔄 Resetting camera for ${id} (no saved state)`);
            viewport.resetCamera();
          }

          viewport.render();
        }
      });

      // Force a full re-render of all viewports
      renderingEngine.renderViewports(viewportIds);

      // CRITICAL: Jump to valve/annulus point to trigger scroll synchronization
      // This ensures all viewports are correctly aligned when switching back to MPR
      if (centerlineDataRef.current) {
        const numCenterlinePoints = centerlineDataRef.current.position.length / 3;

        // Find the centerline point closest to the red sphere (aortic valve, index 1)
        let targetIndex = -1;

        if (spherePositionsRef.current.length >= 2) {
          // Get the red sphere position (middle sphere - aortic valve at index 1)
          const redSpherePos = spherePositionsRef.current[1]; // [x, y, z]

          // Find the closest centerline point to the red sphere
          let minDistance = Infinity;
          let closestIndex = -1;

          for (let i = 0; i < numCenterlinePoints; i++) {
            const x = centerlineDataRef.current.position[i * 3];
            const y = centerlineDataRef.current.position[i * 3 + 1];
            const z = centerlineDataRef.current.position[i * 3 + 2];

            const distance = Math.sqrt(
              Math.pow(x - redSpherePos[0], 2) +
              Math.pow(y - redSpherePos[1], 2) +
              Math.pow(z - redSpherePos[2], 2)
            );

            if (distance < minDistance) {
              minDistance = distance;
              closestIndex = i;
            }
          }

          if (closestIndex >= 0) {
            targetIndex = closestIndex;
            console.log(`🎯 Found centerline point closest to red sphere (valve) at index ${targetIndex}/${numCenterlinePoints} (distance: ${minDistance.toFixed(2)}mm)`);
          }
        }

        // Fallback: Try to find annulus plane marker in modified centerline
        if (targetIndex < 0) {
          const modifiedCenterline = centerlineDataRef.current.modifiedCenterline;
          if (modifiedCenterline && Array.isArray(modifiedCenterline)) {
            const annulusIndex = modifiedCenterline.findIndex((p: any) => p.isAnnulusPlane === true);
            if (annulusIndex >= 0) {
              const ratio = annulusIndex / modifiedCenterline.length;
              targetIndex = Math.round(ratio * (numCenterlinePoints - 1));
              console.log(`🎯 Found annulus plane marker at index ${targetIndex}/${numCenterlinePoints}`);
            }
          }
        }

        // Final fallback: Use 40% through centerline
        if (targetIndex < 0) {
          targetIndex = Math.round(numCenterlinePoints * 0.4);
          console.log(`🎯 Using calculated annulus position at ~40% of centerline: index ${targetIndex}/${numCenterlinePoints}`);
        }

        // Update current index and trigger scroll synchronization
        if (targetIndex >= 0 && targetIndex < numCenterlinePoints) {
          currentCenterlineIndexRef.current = targetIndex;

          // Manually update axial viewport camera at this centerline position
          const axialViewport = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
          if (axialViewport) {
            // Get position at target index
            const position = [
              centerlineDataRef.current.position[targetIndex * 3],
              centerlineDataRef.current.position[targetIndex * 3 + 1],
              centerlineDataRef.current.position[targetIndex * 3 + 2]
            ] as Types.Point3;

            // Calculate tangent at this position
            let tangent: Types.Point3;
            if (targetIndex > 0 && targetIndex < numCenterlinePoints - 1) {
              const prevPos = [
                centerlineDataRef.current.position[(targetIndex - 1) * 3],
                centerlineDataRef.current.position[(targetIndex - 1) * 3 + 1],
                centerlineDataRef.current.position[(targetIndex - 1) * 3 + 2]
              ];
              const nextPos = [
                centerlineDataRef.current.position[(targetIndex + 1) * 3],
                centerlineDataRef.current.position[(targetIndex + 1) * 3 + 1],
                centerlineDataRef.current.position[(targetIndex + 1) * 3 + 2]
              ];
              tangent = [
                (nextPos[0] - prevPos[0]) / 2,
                (nextPos[1] - prevPos[1]) / 2,
                (nextPos[2] - prevPos[2]) / 2
              ] as Types.Point3;
            } else {
              tangent = [0, 0, 1] as Types.Point3;
            }

            // Normalize tangent
            const tangentLength = Math.sqrt(tangent[0] ** 2 + tangent[1] ** 2 + tangent[2] ** 2);
            if (tangentLength > 0) {
              tangent = [tangent[0] / tangentLength, tangent[1] / tangentLength, tangent[2] / tangentLength] as Types.Point3;
            }

            // Update axial camera to look perpendicular to centerline at this position
            // Use saved parallelScale to maintain zoom level
            const savedAxialCamera = originalCameraStatesRef.current['axial'];
            const cameraDistance = 200;
            const newCameraPos = [
              position[0] + tangent[0] * cameraDistance,
              position[1] + tangent[1] * cameraDistance,
              position[2] + tangent[2] * cameraDistance
            ] as Types.Point3;

            // Calculate viewUp perpendicular to tangent
            let viewUp: Types.Point3;
            const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
            const cross = [
              tangent[1] * reference[2] - tangent[2] * reference[1],
              tangent[2] * reference[0] - tangent[0] * reference[2],
              tangent[0] * reference[1] - tangent[1] * reference[0]
            ];
            const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
            if (crossLen > 0) {
              viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
            } else {
              viewUp = [0, 0, 1] as Types.Point3;
            }

            axialViewport.setCamera({
              position: newCameraPos,
              focalPoint: position,
              viewUp: viewUp,
              parallelScale: savedAxialCamera?.parallelScale || 60, // Use saved zoom level or default to 60
            });
            axialViewport.render();

            console.log(`✅ Updated axial viewport to centerline index ${targetIndex}`);

            // Directly update sagittal and coronal viewports to be centered on the annulus point
            // Get the actual camera after setting (to get viewPlaneNormal)
            const updatedCamera = axialViewport.getCamera();
            const viewPlaneNormal = updatedCamera.viewPlaneNormal;
            const actualViewUp = updatedCamera.viewUp;

            // Calculate actualViewRight (perpendicular to viewUp and viewPlaneNormal)
            const actualViewRight = [
              actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
              actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
              actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
            ];

            const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
            if (rightLen > 0) {
              actualViewRight[0] /= rightLen;
              actualViewRight[1] /= rightLen;
              actualViewRight[2] /= rightLen;
            }

            // Apply rotation if any
            const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
            const fixedCrosshairTool = toolGroup?.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
            const rotationAngle = fixedCrosshairTool?.getRotationAngle() || 0;

            const cos = Math.cos(rotationAngle);
            const sin = Math.sin(rotationAngle);

            const rotatedViewRight = [
              actualViewRight[0] * cos - actualViewUp[0] * sin,
              actualViewRight[1] * cos - actualViewUp[1] * sin,
              actualViewRight[2] * cos - actualViewUp[2] * sin
            ];

            const rotatedViewUp = [
              actualViewRight[0] * sin + actualViewUp[0] * cos,
              actualViewRight[1] * sin + actualViewUp[1] * cos,
              actualViewRight[2] * sin + actualViewUp[2] * cos
            ];

            // Update sagittal viewport - centered on annulus point
            const sagittalVp = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
            if (sagittalVp) {
              const savedSagCamera = originalCameraStatesRef.current['sagittal'];
              const sagCameraPos = [
                position[0] + rotatedViewRight[0] * cameraDistance,
                position[1] + rotatedViewRight[1] * cameraDistance,
                position[2] + rotatedViewRight[2] * cameraDistance
              ] as Types.Point3;

              sagittalVp.setCamera({
                position: sagCameraPos,
                focalPoint: position, // Centered on annulus point
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: savedSagCamera?.parallelScale || sagittalVp.getCamera().parallelScale
              });
              sagittalVp.render();
              console.log(`✅ Updated sagittal viewport centered on annulus point`);
            }

            // Update coronal viewport - centered on annulus point
            const coronalVp = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
            if (coronalVp) {
              const savedCorCamera = originalCameraStatesRef.current['coronal'];
              const corCameraPos = [
                position[0] + rotatedViewUp[0] * cameraDistance,
                position[1] + rotatedViewUp[1] * cameraDistance,
                position[2] + rotatedViewUp[2] * cameraDistance
              ] as Types.Point3;

              coronalVp.setCamera({
                position: corCameraPos,
                focalPoint: position, // Centered on annulus point
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: savedCorCamera?.parallelScale || coronalVp.getCamera().parallelScale
              });
              coronalVp.render();
              console.log(`✅ Updated coronal viewport centered on annulus point`);
            }
          }
        }
      }

      // Clear saved camera states so they can be re-saved next time
      originalCameraStatesRef.current = {};

      console.log('✅ MPR mode restored with camera states and annulus plane navigation');
    }
  }, [renderMode]);

  // Sync window/level changes to CPR actors
  useEffect(() => {
    if (renderMode === 'cpr' && cprActorsRef.current.length > 0 && renderingEngineRef.current) {
      console.log('🎨 Syncing window/level to CPR actors:', windowLevel);
      cprActorsRef.current.forEach(({ actor }) => {
        const property = actor.getProperty();
        property.setColorWindow(windowLevel.window);
        property.setColorLevel(windowLevel.level);
      });
      renderingEngineRef.current.renderViewports(['axial', 'sagittal', 'coronal']);
    }
  }, [windowLevel, renderMode]);

  // Create the CPR rotation callback function and store it in ref
  // This function is created once and stored, not recreated on every render
  // Update renderMode ref whenever it changes
  useEffect(() => {
    renderModeRef.current = renderMode;
    console.log(`📝 Render mode updated to: ${renderMode}`);
  }, [renderMode]);

  const createCPRRotationCallback = useCallback(() => {
    const callback = (deltaAngle: number) => {
      console.log(`🔄 CPR Rotation callback called! renderMode=${renderModeRef.current}, deltaAngle=${deltaAngle.toFixed(4)}`);

      // NEGATE deltaAngle to fix rotation direction (clockwise crosshair = clockwise CPR)
      cprRotationAngleRef.current += -deltaAngle;
      const totalAngle = cprRotationAngleRef.current;

      // Update direction matrices for all CPR actors (no need to recreate!)
      console.log(`🔄 CPR Rotation - Total angle: ${(totalAngle * 180 / Math.PI).toFixed(1)}°, CPR actors count: ${cprActorsRef.current.length}`);

      // Update rotation using setDirectionMatrix (fast, no recreation needed)
      updateCPRRotations(totalAngle);
      console.log(`✅ CPR rotation complete at ${(totalAngle * 180 / Math.PI).toFixed(1)}°`);
    };

    cprRotationCallbackRef.current = callback;
    return callback;
  }, []); // Empty deps - create once and reuse

  // Function to ensure CPR rotation callback is set on the tool
  const ensureCPRRotationCallbackSet = useCallback(() => {
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    if (!toolGroup) return false;

    const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
    if (!fixedCrosshairTool || typeof fixedCrosshairTool.setCPRRotationCallback !== 'function') {
      return false;
    }

    // Create callback if not already created
    if (!cprRotationCallbackRef.current) {
      createCPRRotationCallback();
    }

    // Set the callback on the tool
    fixedCrosshairTool.setCPRRotationCallback(cprRotationCallbackRef.current);
    return true;
  }, [createCPRRotationCallback]);

  // Manage CPR rotation callback based on render mode
  useEffect(() => {
    if (renderMode === 'mpr') {
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (toolGroup) {
        const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
        if (fixedCrosshairTool && typeof fixedCrosshairTool.setCPRRotationCallback === 'function') {
          fixedCrosshairTool.setCPRRotationCallback(null);
          cprRotationAngleRef.current = 0;
          cprRotationCallbackRef.current = null;
        }
      }
    }
  }, [renderMode]);

  // Ensure CPR callback is set for CPR mode
  useEffect(() => {
    if (renderMode !== 'cpr' || !cprActorsReady) {
      return;
    }

    console.log('🔧 Setting up CPR rotation callback for non-measurements stage...');
    const success = ensureCPRRotationCallbackSet();
    if (success) {
      console.log('✅ CPR rotation callback successfully set on FixedCrosshairTool');
    } else {
      console.warn('⚠️ Failed to set CPR rotation callback');
    }

    // Re-check periodically to ensure callback stays set
    // Only re-set if callback is actually null/undefined (truly lost), not if reference changed
    const intervalId = setInterval(() => {
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (toolGroup) {
        const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as any;
        if (fixedCrosshairTool && typeof fixedCrosshairTool.getCPRRotationCallback === 'function') {
          const currentCallback = fixedCrosshairTool.getCPRRotationCallback();
          // Only re-set if callback is null/undefined (truly missing)
          // Don't care about reference equality - different reference is okay after mode switch
          if (!currentCallback) {
            console.log('🔄 Re-setting CPR rotation callback (was lost)');
            ensureCPRRotationCallbackSet();
          }
        }
      }
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [renderMode, cprActorsReady, currentStage, ensureCPRRotationCallbackSet]);

  const cleanup = () => {
    if (!running.current) {
      return;
    }

    try {
      console.log('🧹 Cleaning up MPR Viewport...');

      // Clean up overlay update interval
      if (overlayUpdateIntervalRef.current) {
        clearInterval(overlayUpdateIntervalRef.current);
        overlayUpdateIntervalRef.current = null;
      }

      // Clean up annular plane orientation listener
      if (renderingEngineRef.current) {
        try {
          const axialVp = renderingEngineRef.current.getViewport('axial');
          if (axialVp && axialVp.element) {
            const listener = (axialVp.element as any)._annulusPlaneOrientationListener;
            if (listener) {
              axialVp.element.removeEventListener(Enums.Events.CAMERA_MODIFIED, listener);
              delete (axialVp.element as any)._annulusPlaneOrientationListener;
              console.log('🧹 Removed annular plane orientation listener');
            }
          }
        } catch (error) {
          console.warn('Failed to remove orientation listener:', error);
        }
      }

      // Clear locked camera ref
      lockedAxialCameraRef.current = null;

      // DON'T destroy synchronizer - keep it alive for reuse (fixes sync issues)
      // slabSynchronizerRef.current = null;

      // Clean up tool group
      try {
        const existingToolGroup = ToolGroupManager.getToolGroup(toolGroupId);
        if (existingToolGroup) {
          ToolGroupManager.destroyToolGroup(toolGroupId);
        }
      } catch (error) {
        console.warn('Failed to destroy tool group:', error);
      }

      // CRITICAL: Reset running flag so re-initialization can happen
      running.current = false;

      console.log('✅ MPR Viewport cleanup complete');
    } catch (error) {
      console.warn('Cleanup error:', error);
    }
  };

  // Helper function to convert Cornerstone volume to VTK ImageData
  const convertCornerstoneVolumeToVTK = async (volume: any): Promise<any> => {
    try {
      // Get volume data using voxelManager (avoids timeout issues)
      const scalarData = volume.voxelManager.getCompleteScalarDataArray();

      if (!scalarData || scalarData.length === 0) {
        throw new Error('Volume scalar data is empty or not available');
      }

      const { dimensions, spacing, origin, direction } = volume;

      // Create VTK ImageData
      const imageData = vtkImageData.newInstance();
      imageData.setDimensions(dimensions);
      imageData.setSpacing(spacing);
      imageData.setOrigin(origin);
      imageData.setDirection(direction);

      // Create scalar array manually
      const scalarArray = vtkDataArray.newInstance({
        name: 'Pixels',
        numberOfComponents: 1,
        values: scalarData
      });

      // Set the scalars on the imageData
      imageData.getPointData().setScalars(scalarArray);

      console.log('✅ Converted Cornerstone volume to VTK ImageData');
      return imageData;
    } catch (error) {
      console.error('❌ Failed to convert volume to VTK:', error);
      throw error;
    }
  };

  // Helper to rotate a vector around an axis by an angle (Rodrigues' formula)
  const rotateVectorAroundAxis = (v: number[], axis: number[], angle: number): number[] => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dot = v[0]*axis[0] + v[1]*axis[1] + v[2]*axis[2];

    return [
      v[0]*cos + (axis[1]*v[2] - axis[2]*v[1])*sin + axis[0]*dot*(1-cos),
      v[1]*cos + (axis[2]*v[0] - axis[0]*v[2])*sin + axis[1]*dot*(1-cos),
      v[2]*cos + (axis[0]*v[1] - axis[1]*v[0])*sin + axis[2]*dot*(1-cos)
    ];
  };

  // Helper function to densely interpolate centerline points to reduce banding artifacts
  const interpolateCenterline = (originalPoints: Float32Array, targetNumPoints: number = 500): Float32Array => {
    const numOriginal = originalPoints.length / 3;

    // Calculate cumulative arc lengths
    const arcLengths = [0];
    for (let i = 1; i < numOriginal; i++) {
      const dx = originalPoints[i*3] - originalPoints[(i-1)*3];
      const dy = originalPoints[i*3+1] - originalPoints[(i-1)*3+1];
      const dz = originalPoints[i*3+2] - originalPoints[(i-1)*3+2];
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      arcLengths.push(arcLengths[i-1] + dist);
    }

    const totalLength = arcLengths[numOriginal - 1];
    const interpolated = new Float32Array(targetNumPoints * 3);

    // Interpolate points evenly along arc length
    for (let i = 0; i < targetNumPoints; i++) {
      const targetLength = (i / (targetNumPoints - 1)) * totalLength;

      // Find segment containing this arc length
      let segmentIdx = 0;
      for (let j = 1; j < arcLengths.length; j++) {
        if (arcLengths[j] >= targetLength) {
          segmentIdx = j - 1;
          break;
        }
      }

      // Interpolate within segment
      const segmentStart = arcLengths[segmentIdx];
      const segmentEnd = arcLengths[segmentIdx + 1];
      const t = segmentEnd > segmentStart ? (targetLength - segmentStart) / (segmentEnd - segmentStart) : 0;

      interpolated[i*3] = originalPoints[segmentIdx*3] + t * (originalPoints[(segmentIdx+1)*3] - originalPoints[segmentIdx*3]);
      interpolated[i*3+1] = originalPoints[segmentIdx*3+1] + t * (originalPoints[(segmentIdx+1)*3+1] - originalPoints[segmentIdx*3+1]);
      interpolated[i*3+2] = originalPoints[segmentIdx*3+2] + t * (originalPoints[(segmentIdx+1)*3+2] - originalPoints[segmentIdx*3+2]);
    }

    return interpolated;
  };

  // Helper function to convert centerline to VTK PolyData with orientation tensors for straightened mode
  const convertCenterlineToVTKPolyData = (centerlineData: any, rotationAngle: number = 0): any => {
    try {
      // CRITICAL: Densely interpolate centerline to avoid banding artifacts
      const originalPoints = new Float32Array(centerlineData.position);
      const pointsArray = interpolateCenterline(originalPoints, 500);
      const numPoints = pointsArray.length / 3;

      console.log(`📊 Interpolated centerline from ${originalPoints.length/3} to ${numPoints} points`);

      const polyData = vtkPolyData.newInstance();
      const points = vtkPoints.newInstance();
      const lines = vtkCellArray.newInstance();

      points.setData(pointsArray, 3);

      // Calculate orientation matrices using ROTATION-MINIMIZING FRAMES
      // VTK ImageCPRMapper expects 3x3 orientation matrices (9 components per point)
      const orientationMatrices = new Float32Array(numPoints * 9); // 3x3 matrix per point

      // Use a CONSTANT reference direction (world "up" = patient superior) for all points
      // This prevents wobble/twist as frame propagates along centerline
      const worldUp = [0, 0, 1]; // Z-axis = superior in patient coordinates

      for (let i = 0; i < numPoints; i++) {
        // Calculate tangent at this point
        let tangent: number[];

        if (i === 0) {
          // First point: use direction to next point
          if (numPoints > 1) {
            tangent = [
              pointsArray[3] - pointsArray[0],
              pointsArray[4] - pointsArray[1],
              pointsArray[5] - pointsArray[2]
            ];
          } else {
            tangent = [0, 0, 1];
          }
        } else if (i === numPoints - 1) {
          // Last point: use direction from previous
          tangent = [
            pointsArray[i * 3] - pointsArray[(i - 1) * 3],
            pointsArray[i * 3 + 1] - pointsArray[(i - 1) * 3 + 1],
            pointsArray[i * 3 + 2] - pointsArray[(i - 1) * 3 + 2]
          ];
        } else {
          // Middle points: average of directions
          tangent = [
            (pointsArray[(i + 1) * 3] - pointsArray[(i - 1) * 3]) / 2,
            (pointsArray[(i + 1) * 3 + 1] - pointsArray[(i - 1) * 3 + 1]) / 2,
            (pointsArray[(i + 1) * 3 + 2] - pointsArray[(i - 1) * 3 + 2]) / 2
          ];
        }

        // Normalize tangent
        const tangentLength = Math.sqrt(tangent[0] * tangent[0] + tangent[1] * tangent[1] + tangent[2] * tangent[2]);
        if (tangentLength > 0) {
          tangent[0] /= tangentLength;
          tangent[1] /= tangentLength;
          tangent[2] /= tangentLength;
        } else {
          tangent = [0, 0, 1];
        }

        // Calculate normal: project worldUp onto plane perpendicular to tangent
        // normal = worldUp - (worldUp · tangent) * tangent
        const dot = worldUp[0] * tangent[0] + worldUp[1] * tangent[1] + worldUp[2] * tangent[2];
        let normal = [
          worldUp[0] - dot * tangent[0],
          worldUp[1] - dot * tangent[1],
          worldUp[2] - dot * tangent[2]
        ];

        // Normalize normal
        const normalLength = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
        if (normalLength > 1e-6) {
          normal[0] /= normalLength;
          normal[1] /= normalLength;
          normal[2] /= normalLength;
        } else {
          // Tangent is parallel to worldUp - use a different reference
          const altRef = [1, 0, 0];
          const altDot = altRef[0] * tangent[0] + altRef[1] * tangent[1] + altRef[2] * tangent[2];
          normal = [
            altRef[0] - altDot * tangent[0],
            altRef[1] - altDot * tangent[1],
            altRef[2] - altDot * tangent[2]
          ];
          const altNormalLength = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
          if (altNormalLength > 0) {
            normal[0] /= altNormalLength;
            normal[1] /= altNormalLength;
            normal[2] /= altNormalLength;
          }
        }

        // Calculate binormal = tangent × normal (right-handed system)
        const binormal = [
          tangent[1] * normal[2] - tangent[2] * normal[1],
          tangent[2] * normal[0] - tangent[0] * normal[2],
          tangent[0] * normal[1] - tangent[1] * normal[0]
        ];

        // Store orientation matrix for this point (3x3, COLUMN-MAJOR: [normal, binormal, tangent])
        const offset = i * 9;
        orientationMatrices[offset + 0] = normal[0];
        orientationMatrices[offset + 1] = binormal[0];
        orientationMatrices[offset + 2] = tangent[0];
        orientationMatrices[offset + 3] = normal[1];
        orientationMatrices[offset + 4] = binormal[1];
        orientationMatrices[offset + 5] = tangent[1];
        orientationMatrices[offset + 6] = normal[2];
        orientationMatrices[offset + 7] = binormal[2];
        orientationMatrices[offset + 8] = tangent[2];
      }

      // Create line connectivity
      const lineArray = new Uint32Array(numPoints + 1);
      lineArray[0] = numPoints;
      for (let i = 0; i < numPoints; i++) {
        lineArray[i + 1] = i;
      }

      lines.setData(lineArray);

      // Set up polydata
      polyData.setPoints(points);
      polyData.setLines(lines);

      // Add orientation matrices as point data (9 components for 3x3 matrix)
      // CRITICAL: Must be named "Orientation" for vtkImageCPRMapper to recognize it
      const orientationData = vtkDataArray.newInstance({
        name: 'Orientation',
        numberOfComponents: 9,
        values: orientationMatrices,
      });
      polyData.getPointData().addArray(orientationData);

      console.log(`✅ Converted centerline to VTK PolyData with ${numPoints} points and orientation matrices (rotation: ${(rotationAngle * 180 / Math.PI).toFixed(1)}°)`);
      return polyData;
    } catch (error) {
      console.error('❌ Failed to convert centerline to VTK:', error);
      throw error;
    }
  };

  // Helper function to setup CPR actors on Cornerstone viewports
  const setupCPRActors = async () => {
    // Guard against concurrent calls
    if (isSettingUpCPRRef.current) {
      console.log('⏭️ Skipping CPR setup - already in progress');
      return;
    }

    try {
      isSettingUpCPRRef.current = true;
      console.log('🔄 Setting up CPR actors...');

      if (!currentVolumeRef.current || !centerlineDataRef.current) {
        console.warn('⚠️ Volume or centerline not available for CPR setup');
        isSettingUpCPRRef.current = false;
        return;
      }

      const renderingEngine = renderingEngineRef.current;
      if (!renderingEngine) {
        console.warn('⚠️ Rendering engine not available');
        isSettingUpCPRRef.current = false;
        return;
      }

      // Convert Cornerstone volume to VTK ImageData
      const vtkImageData = await convertCornerstoneVolumeToVTK(currentVolumeRef.current);

      // Get current rotation angle
      const rotationAngle = cprRotationAngleRef.current;

      // Clear any existing CPR actors
      cprActorsRef.current.forEach(({ actor, viewportId }) => {
        const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
        if (viewport) {
          try {
            viewport.removeActors([`cprActor_${viewportId}`]);
          } catch (e) {
            console.warn('Failed to remove existing CPR actor:', e);
          }
        }
      });
      cprActorsRef.current = [];

      // Create CPR actors ONLY for sagittal and coronal (axial stays as cross-section)
      // Use straightened mode with orientation tensors for rotation support
      // Swapped sagittal and coronal viewports
      const viewportConfigs = [
        { id: 'coronal', mode: 'straightened', cprWidth: 50, rotationOffset: 0 },  // 0° offset
        { id: 'sagittal', mode: 'straightened', cprWidth: 50, rotationOffset: Math.PI / 2 }  // 90° offset - orthogonal to coronal
      ];

      // First pass: Create all mappers and actors
      const setupData: Array<{ config: any; viewport: any; mapper: any; actor: any }> = [];

      for (const config of viewportConfigs) {
        const viewport = renderingEngine.getViewport(config.id) as Types.IVolumeViewport;
        if (!viewport) {
          console.warn(`⚠️ Viewport ${config.id} not found`);
          continue;
        }

        // Calculate rotation angle for this viewport (base rotation + offset for orthogonal views)
        const currentRotation = cprRotationAngleRef.current;
        const viewportRotation = currentRotation + config.rotationOffset;

        // CRITICAL: Create SEPARATE centerline WITHOUT rotation in orientation matrices
        // Orientation matrices provide smooth parallel transport only
        const viewportCenterline = convertCenterlineToVTKPolyData(centerlineDataRef.current, 0);

        // Create CPR mapper
        const mapper = vtkImageCPRMapper.newInstance();
        mapper.setBackgroundColor(0, 0, 0, 0); // Transparent background

        // Use straightened mode with orientation tensors
        mapper.useStraightenedMode();

        // Set image data and centerline (orientation matrices for smooth parallel transport)
        mapper.setImageData(vtkImageData);
        mapper.setCenterlineData(viewportCenterline);
        mapper.setWidth(config.cprWidth);

        // Apply rotation via direction matrix (like TrueCPRViewport)
        const cos = Math.cos(viewportRotation);
        const sin = Math.sin(viewportRotation);
        const directions = new Float32Array([
          cos, -sin, 0,
          sin, cos, 0,
          0, 0, 1
        ]);
        mapper.setDirectionMatrix(directions);

        // Force mapper to update
        mapper.modified();

        console.log(`✅ CPR mapper configured for ${config.id}:`, {
          mode: config.mode,
          width: config.cprWidth,
          rotation: `${(viewportRotation * 180 / Math.PI).toFixed(1)}°`,
          rotationOffset: `${(config.rotationOffset * 180 / Math.PI).toFixed(1)}°`,
          height: mapper.getHeight(),
          centerlinePoints: viewportCenterline.getPoints().getNumberOfPoints()
        });

        // Create actor
        const actor = vtkImageSlice.newInstance();
        actor.setMapper(mapper);

        // Set window/level on actor property
        const property = actor.getProperty();
        property.setColorWindow(windowLevel.window);
        property.setColorLevel(windowLevel.level);
        property.setInterpolationTypeToLinear();

        setupData.push({ config, viewport, mapper, actor });

        // Store mapper reference for later rotation updates
        cprActorsRef.current.push({ actor, mapper, viewportId: config.id, config });
      }

      // Second pass: Add actors to viewports
      for (const { config, viewport, actor } of setupData) {
        // CRITICAL: Hide all volume actors before adding CPR actor
        // Otherwise the volume will render on top of the CPR
        const allActors = viewport.getActors();
        allActors.forEach((actorEntry: any) => {
          if (actorEntry.actor && typeof actorEntry.actor.setVisibility === 'function') {
            actorEntry.actor.setVisibility(false);
            console.log(`  🙈 Hid volume actor in ${config.id}`);
          }
        });

        // Add actor to Cornerstone viewport
        const actorUID = `cprActor_${config.id}`;
        viewport.addActor({ uid: actorUID, actor });

        // Set up camera for CPR viewing
        const bounds = actor.getBounds();
        if (bounds && bounds.length === 6) {
          const center = [
            (bounds[0] + bounds[1]) / 2,
            (bounds[2] + bounds[3]) / 2,
            (bounds[4] + bounds[5]) / 2
          ];

          const maxDim = Math.max(
            bounds[1] - bounds[0],
            bounds[3] - bounds[2],
            bounds[5] - bounds[4]
          );

          // Position camera to look at the CPR reconstruction
          const cameraConfig = {
            position: [center[0], center[1], center[2] + maxDim] as Types.Point3,
            focalPoint: center as Types.Point3,
            viewUp: [0, 1, 0] as Types.Point3,
            parallelScale: maxDim / 2
          };

          viewport.setCamera(cameraConfig);
        }

        // Render this viewport
        viewport.render();

        console.log(`✅ Added CPR actor to ${config.id} viewport`);
      }

      // Capture axial camera reference frame for rotation alignment
      const axialViewport = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
      if (axialViewport) {
        const axialCamera = axialViewport.getCamera();
        const viewUp = axialCamera.viewUp;
        const viewPlaneNormal = axialCamera.viewPlaneNormal;

        // Calculate viewRight = viewUp × viewPlaneNormal
        const viewRight: Types.Point3 = [
          viewUp[1] * viewPlaneNormal[2] - viewUp[2] * viewPlaneNormal[1],
          viewUp[2] * viewPlaneNormal[0] - viewUp[0] * viewPlaneNormal[2],
          viewUp[0] * viewPlaneNormal[1] - viewUp[1] * viewPlaneNormal[0]
        ];

        axialReferenceFrameRef.current = {
          viewUp: viewUp as Types.Point3,
          viewRight,
          viewPlaneNormal: viewPlaneNormal as Types.Point3
        };

        console.log('📐 Captured axial reference frame for CPR rotation:', {
          viewUp,
          viewRight,
          viewPlaneNormal
        });
      }

      // Direction matrices already set during mapper creation above
      // Final render all viewports to show CPR
      renderingEngine.renderViewports(['axial', 'sagittal', 'coronal']);
      console.log('✅ CPR actors setup complete');

    } catch (error) {
      console.error('❌ Failed to setup CPR actors:', error);
    } finally {
      isSettingUpCPRRef.current = false;
    }
  };

  // Update CPR rotation dynamically (like TrueCPRViewport's updateCPROrientations)
  const updateCPRRotations = (rotationRadians: number) => {
    if (!cprActorsRef.current || cprActorsRef.current.length === 0) {
      console.warn('⚠️ No CPR actors available for rotation update');
      return;
    }

    console.log(`🔄 Updating CPR rotations to ${(rotationRadians * 180 / Math.PI).toFixed(1)}°`);

    cprActorsRef.current.forEach(({ mapper, viewportId, config }) => {
      if (!mapper || !config) return;

      // Calculate rotation for this view (base rotation + viewport-specific offset)
      const viewportRotation = rotationRadians + (config.rotationOffset || 0);

      // Update rotation via direction matrix (like TrueCPRViewport approach)
      const cos = Math.cos(viewportRotation);
      const sin = Math.sin(viewportRotation);
      const directions = new Float32Array([
        cos, -sin, 0,
        sin, cos, 0,
        0, 0, 1
      ]);
      mapper.setDirectionMatrix(directions);
      mapper.modified();

      console.log(`  🔄 Updated ${viewportId}: ${(viewportRotation * 180 / Math.PI).toFixed(1)}° (offset: ${((config.rotationOffset || 0) * 180 / Math.PI).toFixed(1)}°)`);

      // Trigger re-render
      const renderingEngine = renderingEngineRef.current;
      if (renderingEngine) {
        const viewport = renderingEngine.getViewport(viewportId);
        if (viewport) {
          viewport.render();
        }
      }
    });
  };

  // Draw CPR crosshair line on a viewport canvas (like MPR long axis view)
  const drawCPRPositionLineOnCanvas = (viewportId: string, positionRatio: number, annulusRatio?: number) => {
    if (!renderingEngineRef.current) {
      console.warn(`   ⚠️ No rendering engine for ${viewportId}`);
      return;
    }

    const renderingEngine = renderingEngineRef.current;
    const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
    if (!viewport) {
      console.warn(`   ⚠️ No viewport found for ${viewportId}`);
      return;
    }

    const canvas = viewport.getCanvas() as HTMLCanvasElement;
    if (!canvas) {
      console.warn(`   ⚠️ No canvas found for ${viewportId}`);
      return;
    }

    // Get canvas dimensions
    const { width, height } = canvas;

    // Simple ratio-based positioning (works correctly when zoom is disabled)
    // positionRatio 0 = top of canvas, positionRatio 1 = bottom of canvas
    const yPixel = positionRatio * height;
    const annulusYPixel = annulusRatio !== undefined ? annulusRatio * height : null;

    // Get 2D context for overlay
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    // Draw horizontal crosshair line with gap in the middle (like MPR long axis views)
    // Coronal view = red line, Sagittal view = green line
    const centerX = width / 2;
    const gapSize = 35; // Larger gap at center (like MPR long axis views)
    const lineMargin = 50; // Margin from edges
    const markerRadius = 5; // Circle marker radius
    const lineColor = viewportId === 'coronal' ? 'rgba(255, 50, 50, 0.7)' : 'rgba(50, 255, 50, 0.7)'; // Red for coronal, green for sagittal

    ctx.save();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);

    // Left segment (from margin to gap)
    const leftStart = lineMargin;
    const leftEnd = centerX - gapSize;
    ctx.beginPath();
    ctx.moveTo(leftStart, yPixel);
    ctx.lineTo(leftEnd, yPixel);
    ctx.stroke();

    // Right segment (from gap to margin)
    const rightStart = centerX + gapSize;
    const rightEnd = width - lineMargin;
    ctx.beginPath();
    ctx.moveTo(rightStart, yPixel);
    ctx.lineTo(rightEnd, yPixel);
    ctx.stroke();

    // Left end marker - filled circle
    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(leftStart, yPixel, markerRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Right end marker - hollow circle
    ctx.fillStyle = 'none';
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(rightEnd, yPixel, markerRadius, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.restore();

    // Draw fixed annulus reference line (if annulus position is provided)
    if (annulusYPixel !== null) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)'; // Yellow line for annulus
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]); // Dashed line

      ctx.beginPath();
      ctx.moveTo(0, annulusYPixel);
      ctx.lineTo(width, annulusYPixel);
      ctx.stroke();

      ctx.restore();

      // Calculate distance from annulus (in pixels, then convert to mm)
      const distancePixels = annulusYPixel - yPixel; // REVERSED: annulus - current (negative = below annulus)
      // Approximate: assume height represents total centerline length
      // Get total centerline length from centerlineDataRef
      if (centerlineDataRef.current) {
        const positions = centerlineDataRef.current.position;
        const numPoints = positions.length / 3;
        let totalLength = 0;
        for (let i = 1; i < numPoints; i++) {
          const dx = positions[i * 3] - positions[(i - 1) * 3];
          const dy = positions[i * 3 + 1] - positions[(i - 1) * 3 + 1];
          const dz = positions[i * 3 + 2] - positions[(i - 1) * 3 + 2];
          totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }

        // Convert pixel distance to mm
        const distanceMM = (distancePixels / height) * totalLength;

        // Draw distance label above the crosshair on the left
        ctx.save();
        ctx.fillStyle = 'yellow';
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        // Black outline for visibility
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 3;
        const distanceText = distanceMM >= 0 ? `+${distanceMM.toFixed(1)}mm` : `${distanceMM.toFixed(1)}mm`;
        ctx.strokeText(distanceText, leftStart, yPixel - 10);
        ctx.fillText(distanceText, leftStart, yPixel - 10);
        ctx.restore();
      }
    }
  };

  // Update CPR position indicator lines showing current scroll position
  const updateCPRPositionLines = (centerlineIndex: number) => {
    if (!renderingEngineRef.current || !centerlineDataRef.current || !cprActorsRef.current.length) {
      return;
    }

    // Calculate arc length DIRECTLY from the interpolated centerline positions
    // This is the exact same data the CPR mapper uses
    const positions = centerlineDataRef.current.position; // Float32Array of [x,y,z, x,y,z, ...]
    const numCenterlinePoints = positions.length / 3;

    // Calculate cumulative arc length up to current index (supports fractional indices)
    let cumulativeDistance = 0;
    const floorIndex = Math.floor(centerlineIndex);
    const fraction = centerlineIndex - floorIndex;

    // Add full segments up to floor index
    for (let i = 1; i <= floorIndex && i < numCenterlinePoints; i++) {
      const dx = positions[i * 3] - positions[(i - 1) * 3];
      const dy = positions[i * 3 + 1] - positions[(i - 1) * 3 + 1];
      const dz = positions[i * 3 + 2] - positions[(i - 1) * 3 + 2];
      const segmentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      cumulativeDistance += segmentLength;
    }

    // Add fractional part of the last segment
    if (fraction > 0 && floorIndex + 1 < numCenterlinePoints) {
      const dx = positions[(floorIndex + 1) * 3] - positions[floorIndex * 3];
      const dy = positions[(floorIndex + 1) * 3 + 1] - positions[floorIndex * 3 + 1];
      const dz = positions[(floorIndex + 1) * 3 + 2] - positions[floorIndex * 3 + 2];
      const segmentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      cumulativeDistance += segmentLength * fraction; // Add only the fractional part
    }

    // Calculate total arc length
    let totalDistance = 0;
    for (let i = 1; i < numCenterlinePoints; i++) {
      const dx = positions[i * 3] - positions[(i - 1) * 3];
      const dy = positions[i * 3 + 1] - positions[(i - 1) * 3 + 1];
      const dz = positions[i * 3 + 2] - positions[(i - 1) * 3 + 2];
      const segmentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      totalDistance += segmentLength;
    }

    // Calculate position ratio (same method as CPR mapper)
    const positionRatio = totalDistance > 0 ? cumulativeDistance / totalDistance : 0;

    console.log(`📍 CPR position sync: index ${centerlineIndex}/${numCenterlinePoints - 1}, arc ${cumulativeDistance.toFixed(2)}/${totalDistance.toFixed(2)}mm = ${positionRatio.toFixed(3)}`);

    // Store position ratio for redrawing after renders
    cprPositionRatioRef.current = positionRatio;

    // Calculate annulus position ratio (find closest point to red sphere = valve/annulus)
    // Only calculate once and store in ref
    if (cprAnnulusRatioRef.current === undefined && spherePositionsRef.current.length > 1) {
      // Red sphere (index 1) is at the valve/annulus position
      const annulusWorldPos = spherePositionsRef.current[1]; // Red sphere at valve

      // Find closest centerline point to annulus position
      let closestIndex = -1;
      let minDist = Infinity;

      for (let i = 0; i < numCenterlinePoints; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        const dx = x - annulusWorldPos[0];
        const dy = y - annulusWorldPos[1];
        const dz = z - annulusWorldPos[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < minDist) {
          minDist = dist;
          closestIndex = i;
        }
      }

      if (closestIndex >= 0) {
        // Calculate arc length to annulus
        let annulusCumulativeDistance = 0;
        for (let i = 1; i <= closestIndex; i++) {
          const dx = positions[i * 3] - positions[(i - 1) * 3];
          const dy = positions[i * 3 + 1] - positions[(i - 1) * 3 + 1];
          const dz = positions[i * 3 + 2] - positions[(i - 1) * 3 + 2];
          const segmentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
          annulusCumulativeDistance += segmentLength;
        }
        cprAnnulusRatioRef.current = totalDistance > 0 ? annulusCumulativeDistance / totalDistance : 0.4;
        console.log(`📍 Annulus (red sphere) at centerline index ${closestIndex}, arc ${annulusCumulativeDistance.toFixed(2)}mm, ratio ${cprAnnulusRatioRef.current.toFixed(3)}`);
      } else {
        console.warn('⚠️ Could not find annulus position on centerline');
      }
    }

    // Draw lines immediately
    requestAnimationFrame(() => {
      drawCPRPositionLineOnCanvas('sagittal', positionRatio, cprAnnulusRatioRef.current);
      drawCPRPositionLineOnCanvas('coronal', positionRatio, cprAnnulusRatioRef.current);
    });
  };

  const initializeMPRViewport = async () => {
    if (running.current) {
      return;
    }
    running.current = true;

    try {
      setIsLoading(true);
      setError(null);

      console.log('🔄 Checking if already initialized...');

      // Check if already initialized - if so, skip init
      let needsInit = false;
      try {
        const existingEngine = renderingEngineId && 
          document.querySelector(`[data-viewport-uid*="${renderingEngineId}"]`);
        if (!existingEngine) {
          needsInit = true;
        }
      } catch {
        needsInit = true;
      }

      if (needsInit) {
        console.log('🔄 Initializing Cornerstone3D...');
        await csRenderInit();
        await csToolsInit();
        dicomImageLoaderInit({ maxWebWorkers: 1 });
      }

      console.log('🔍 Loading DICOM images...');

      // Load DICOM images and get phase information
      const { imageIds, phaseInfo: detectedPhaseInfo } = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: patientInfo!.studyInstanceUID!,
        SeriesInstanceUID: patientInfo!.seriesInstanceUID!,
        wadoRsRoot: "http://127.0.0.1/orthanc/dicom-web",
      });

      if (imageIds.length === 0) {
        throw new Error('No DICOM images found for this series');
      }

      // Store phase information
      setPhaseInfo(detectedPhaseInfo);
      console.log(`📋 Found ${imageIds.length} DICOM images`);
      console.log(`📊 Phase Info:`, detectedPhaseInfo);

      // Set initial phase if multi-phase
      if (detectedPhaseInfo && detectedPhaseInfo.isMultiPhase) {
        setSelectedPhase(0); // Default to first phase
        console.log(`🎬 Multi-phase dataset detected with ${detectedPhaseInfo.totalPhases} phases`);
      }

      // Try to reuse existing rendering engine if it exists (this is what makes it work when coming back!)
      let renderingEngine = renderingEngineRef.current;
      const isFirstLoad = !renderingEngine;
      if (!renderingEngine) {
        renderingEngine = new RenderingEngine(renderingEngineId);
        renderingEngineRef.current = renderingEngine;
        console.log('🆕🆕🆕 FIRST LOAD - Created new rendering engine');
      } else {
        console.log('♻️♻️♻️ SECOND LOAD - Reusing existing rendering engine');
      }

      // Log the state of everything
      console.log('📊 State Check:');
      console.log('  - Is First Load:', isFirstLoad);
      console.log('  - Rendering Engine exists:', !!renderingEngine);
      console.log('  - Synchronizer exists:', !!slabSynchronizerRef.current);
      console.log('  - Viewports on engine:', renderingEngine.getViewports().map(v => v.id));
      
      // Create volume (exactly like App.tsx)
      const volumeId = `streamingImageVolume_${Date.now()}`;
      const volume = await volumeLoader.createAndCacheVolume(volumeId, {
        imageIds,
      });

      // Store volume for CPR conversion
      currentVolumeRef.current = volume;

      // Start volume loading (streaming)
      volume.load();

      // If multi-phase, cache the first phase volume
      if (detectedPhaseInfo && detectedPhaseInfo.isMultiPhase) {
        preloadedVolumesRef.current[0] = volumeId;
        console.log(`💾 Cached phase 0 volume: ${volumeId}`);
      }

      // Setup viewports (exactly like App.tsx)
      const viewports = [
        { id: "axial", orientation: Enums.OrientationAxis.AXIAL },
        { id: "sagittal", orientation: Enums.OrientationAxis.SAGITTAL },
        { id: "coronal", orientation: Enums.OrientationAxis.CORONAL },
      ];

      // Add 4th viewport (3D volume rendering) only for ROOT_DEFINITION stage
      if (currentStage === WorkflowStage.ROOT_DEFINITION && elementRefs.volume3D?.current) {
        viewports.push({
          id: "volume3D",
          orientation: Enums.OrientationAxis.AXIAL // Default orientation for 3D view
        });
      }

      // MEASUREMENTS stage: Add measurement1 viewport (3D view in top row)
      if (currentStage === WorkflowStage.MEASUREMENTS && elementRefs.measurement1?.current) {
        viewports.push({
          id: "measurement1",
          orientation: Enums.OrientationAxis.AXIAL // Default orientation for 3D view
        });
      }

      // Enable viewports and set volumes (check if already enabled first)
      // CRITICAL: Don't await setVolumes - let it stream in background like App.tsx
      console.log(`📊 Setting up viewports for stage: ${currentStage}`);
      console.log(`📊 Viewport list:`, viewports.map(v => v.id));

      viewports.forEach(({ id, orientation }) => {
        // Check if this is a 3D viewport (needed for both new and reused viewports)
        const is3DViewport = id === 'volume3D' || (id === 'measurement1' && currentStage === WorkflowStage.MEASUREMENTS);
        console.log(`🔍 Viewport ${id}: is3DViewport=${is3DViewport}, currentStage=${currentStage}`);

        // Use VOLUME_3D type for the 3D viewport
        const viewportType = is3DViewport
          ? Enums.ViewportType.VOLUME_3D
          : Enums.ViewportType.ORTHOGRAPHIC;

        // VOLUME_3D viewports don't use orientation, use darker background
        const viewportOptions = is3DViewport
          ? { background: [0.1, 0.1, 0.15] as Types.Point3 } // Darker blue-ish for 3D
          : { orientation, background: [0, 0, 0] as Types.Point3 };

        // Check if viewport already exists
        let viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;

        if (!viewport) {
          // Viewport doesn't exist, enable it
          console.log(`  🆕 ${id}: Creating NEW viewport (3D=${is3DViewport})`);

          console.log(`  🎨 ${id}: Type=${viewportType === Enums.ViewportType.VOLUME_3D ? 'VOLUME_3D' : 'ORTHOGRAPHIC'}`);

          // Check if element ref exists
          if (!elementRefs[id]?.current) {
            console.error(`❌ ${id}: Element ref is null or undefined!`);
            return;
          }

          renderingEngine.enableElement({
            viewportId: id,
            type: viewportType,
            element: elementRefs[id].current,
            defaultOptions: viewportOptions,
          });
          viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
          console.log(`  ✅ ${id}: Viewport created successfully`);
        } else {
          // Viewport exists - check if we need to rebind due to layout change
          const currentElement = renderingEngine.getViewport(id).element;
          const newElement = elementRefs[id].current;

          if (currentElement !== newElement) {
            console.log(`  🔄 ${id}: Element changed, rebinding viewport...`);

            // Preserve view presentation before rebinding
            const presentation = (viewport as Types.IVolumeViewport).getViewPresentation?.();

            // Disable and re-enable viewport with new element
            renderingEngine.disableElement(id);
            renderingEngine.enableElement({
              viewportId: id,
              type: viewportType,
              element: newElement,
              defaultOptions: viewportOptions,
            });

            viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;

            // Re-set volumes after rebinding
            console.log(`  📦 ${id}: Re-setting volumes after rebind...`);
            viewport.setVolumes([{ volumeId }]);

            // Restore presentation if available
            if (presentation && typeof (viewport as any).setViewPresentation === 'function') {
              (viewport as any).setViewPresentation(presentation);
            }

            viewport.render();
            console.log(`  ✅ ${id}: Viewport rebound successfully`);
          } else {
            console.log(`  ♻️ ${id}: Reusing existing viewport (same element)`);
          }
        }

        // For 3D viewport (volume3D or measurement1 in MEASUREMENTS stage)
        if (is3DViewport) {
          console.log(`  📦 ${id}: Setting volumes for 3D viewport...`);
          setVolumesForViewports(
            renderingEngine,
            [{ volumeId }],
            [id]
          ).then(() => {
            console.log(`  ✅ ${id}: Volumes set successfully for 3D viewport`);

            // Apply custom VTK color transfer function
            const actors = (viewport as any).getActors();
            if (actors && actors.length > 0) {
              const volumeActor = actors[0].actor;
              const property = volumeActor.getProperty();

              // Custom color transfer function
              const ctfun = vtkColorTransferFunction.newInstance();
              ctfun.addRGBPoint(0, 85 / 255.0, 0, 0);
              ctfun.addRGBPoint(95, 1.0, 1.0, 1.0);
              ctfun.addRGBPoint(225, 0.66, 0.66, 0.5);
              ctfun.addRGBPoint(255, 0.3, 1.0, 0.5);

              // Custom opacity function
              const ofun = vtkPiecewiseFunction.newInstance();
              ofun.addPoint(0.0, 0.0);
              ofun.addPoint(255.0, 1.0);

              // Apply transfer functions
              property.setRGBTransferFunction(0, ctfun);
              property.setScalarOpacity(0, ofun);
              property.setScalarOpacityUnitDistance(0, 3.0);
              property.setInterpolationTypeToLinear();

              // Gradient opacity settings
              property.setUseGradientOpacity(0, true);
              property.setGradientOpacityMinimumValue(0, 2);
              property.setGradientOpacityMinimumOpacity(0, 0.0);
              property.setGradientOpacityMaximumValue(0, 20);
              property.setGradientOpacityMaximumOpacity(0, 1.0);

              // Shading settings
              property.setShade(true);
              property.setAmbient(0.2);
              property.setDiffuse(0.7);
              property.setSpecular(0.3);
              property.setSpecularPower(8.0);

              console.log('🎨 Applied custom VTK color transfer function to 3D viewport');
            }

            // Set default front view (AP - Anterior-Posterior view)
            // Camera at back (posterior), looking towards front (anterior/chest)
            const camera = viewport.getCamera();
            const { focalPoint, position } = camera;

            // Calculate distance from focal point to camera
            const distance = Math.sqrt(
              Math.pow(position[0] - focalPoint[0], 2) +
              Math.pow(position[1] - focalPoint[1], 2) +
              Math.pow(position[2] - focalPoint[2], 2)
            );

            // Set camera to back view (looking from posterior towards anterior)
            // In medical imaging: +X = patient's right, +Y = anterior (front), +Z = superior (head)
            // Camera at -Y (back/spine side) looking towards +Y (chest/front)
            viewport.setCamera({
              focalPoint: focalPoint, // Keep center
              position: [focalPoint[0], focalPoint[1] - distance, focalPoint[2]], // Move camera to back (posterior)
              viewUp: [0, 0, 1], // Z-axis up (head up)
            });

            viewport.render();

            // Initialize orientation display
            setTimeout(updateCameraOrientation, 100);

            // DISABLED - VTK OrientationMarkerWidget appears in all views due to shared interactor
            // The parentRenderer parameter doesn't isolate it properly in Cornerstone3D
            // TODO: Implement viewport-specific orientation indicator later
            // setTimeout(initializeOrientationWidget, 200);

            // Add 3D viewport to 3D tool group for rotation to work
            const toolGroup3DId = `${toolGroupId}_3D`;
            const toolGroup3D = ToolGroupManager.getToolGroup(toolGroup3DId);
            if (toolGroup3D) {
              if (!toolGroup3D.getViewportsInfo().find(vp => vp.viewportId === id)) {
                toolGroup3D.addViewport(id, renderingEngineId);
                console.log(`  📌 Added ${id} to 3D tool group for rotation`);
              }

              // Activate OrientationMarkerTool AFTER viewport is added
              toolGroup3D.setToolActive(OrientationMarkerTool.toolName);
              console.log(`  ✅ OrientationMarkerTool activated for ${id} viewport`);

              viewport.render();
            }
            console.log('ℹ️ Volume cropping tool is DISABLED, rotation enabled');

          });
        } else {
          // For MPR viewports, use regular setVolumes
          console.log(`  📦 ${id}: Setting volumes for MPR viewport...`);
          viewport.setVolumes([{ volumeId }]);
          viewport.render();
          console.log(`  ✅ ${id}: Volumes set and rendered for MPR viewport`);
        }
      });

      // Setup tools first WITHOUT any state updates
      await setupTools();

      // CRITICAL: Set imageInfo in ref (no re-render since it's a ref)
      // The layout shift from the info bar was the real issue, not this assignment
      imageInfoRef.current = {
        width: 512,
        height: 512,
        numberOfImages: imageIds.length,
        seriesInstanceUID: patientInfo?.seriesInstanceUID,
        volumeId: volumeId,
        status: 'MPR Viewport Active'
      };

      if (onImageLoaded) {
        onImageLoaded({ imageIds, volume });
      }

      setIsLoading(false);

      // Apply initial window/level AFTER everything else to avoid interfering with CrosshairsTool
      // Small delay to let CrosshairsTool fully stabilize
      setTimeout(() => {
        let viewportIds = ["axial", "sagittal", "coronal"];
        if (currentStage === WorkflowStage.ROOT_DEFINITION) {
          viewportIds.push("volume3D");
        }
        // MEASUREMENTS stage: no extra viewports, using same 3 viewports
        viewportIds.forEach((id) => {
          const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
          if (viewport) {
            viewport.setProperties({
              voiRange: {
                lower: windowLevel.level - windowLevel.window / 2,
                upper: windowLevel.level + windowLevel.window / 2,
              },
            });
            viewport.render();
          }
        });

        // Just enable RectangleROI tool - don't auto-create annotation
        // Auto-creation is causing performance issues and the annotation isn't editable
        if (initializeCropBox) {
          const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
          if (toolGroup) {
            // Enable RectangleROI so users can draw it manually
            toolGroup.setToolEnabled(RectangleROITool.toolName);
            console.log('✅ RectangleROI tool enabled for manual crop box drawing');
          }
        }
      }, 200);

      // For ANNULUS_DEFINITION stage, position axial view perpendicular to centerline at valve


      if (currentStage === WorkflowStage.ANNULUS_DEFINITION && existingSpheres && existingSpheres.length >= 3) {
        console.log('✅ Condition met! Setting up centerline camera in 500ms...');
        setTimeout(() => {
          console.log('🎯 Setting up centerline-aligned axial view at valve position');

          // Generate centerline from root points
          const centerlineData = CenterlineGenerator.generateFromRootPoints(
            existingSpheres.map((sphere, index) => {
              let type: any;
              if (existingSpheres.length === 3) {
                type = index === 0 ? RootPointType.LV_OUTFLOW :
                      index === 1 ? RootPointType.AORTIC_VALVE :
                      RootPointType.ASCENDING_AORTA;
              } else {
                const middleIndex = Math.floor(existingSpheres.length / 2);
                type = index === 0 ? RootPointType.LV_OUTFLOW :
                      index === middleIndex ? RootPointType.AORTIC_VALVE :
                      index === existingSpheres.length - 1 ? RootPointType.ASCENDING_AORTA :
                      RootPointType.EXTENDED;
              }
              return {
                id: sphere.id,
                position: sphere.pos,
                type: type,
                timestamp: Date.now()
              };
            })
          );

          // Store centerline data for scrolling
          centerlineDataRef.current = centerlineData;

          // Calculate optimal scroll step size for 0.1mm precision
          const numPoints = centerlineData.position.length / 3;
          let totalLength = 0;
          for (let i = 1; i < numPoints; i++) {
            const dx = centerlineData.position[i * 3] - centerlineData.position[(i - 1) * 3];
            const dy = centerlineData.position[i * 3 + 1] - centerlineData.position[(i - 1) * 3 + 1];
            const dz = centerlineData.position[i * 3 + 2] - centerlineData.position[(i - 1) * 3 + 2];
            totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
          }
          const avgSegmentLength = totalLength / (numPoints - 1);
          const targetStepMM = 0.1; // 0.1mm per scroll event
          cprScrollStepSizeRef.current = targetStepMM / avgSegmentLength;
          console.log(`📏 Centerline: ${numPoints} points, ${totalLength.toFixed(1)}mm total, avg ${avgSegmentLength.toFixed(3)}mm/segment`);
          console.log(`📏 Scroll step: ${cprScrollStepSizeRef.current.toFixed(3)} index units = ${targetStepMM}mm`);

          // Store the 3 sphere positions for discrete scrolling
          spherePositionsRef.current = existingSpheres.map(sphere => sphere.pos as Types.Point3);

          // Find the RED sphere (valve) - supports refinement points
          const valveSphere = existingSpheres.find(sphere => sphere.color === 'red');
          if (!valveSphere) {
            console.error('❌ Could not find red (valve) sphere for centerline alignment');
            return;
          }

          const valveSphereIndex = existingSpheres.indexOf(valveSphere);
          currentSphereIndexRef.current = valveSphereIndex;

          // Use valve sphere position
          const valveCenterlinePos = valveSphere.pos;

          // Find closest centerline point to valve to calculate tangent
          let closestIndex = 0;
          let minDist = Infinity;
          for (let i = 0; i < numPoints; i++) {
            const x = centerlineData.position[i * 3];
            const y = centerlineData.position[i * 3 + 1];
            const z = centerlineData.position[i * 3 + 2];

            const dist = Math.sqrt(
              Math.pow(x - valveCenterlinePos[0], 2) +
              Math.pow(y - valveCenterlinePos[1], 2) +
              Math.pow(z - valveCenterlinePos[2], 2)
            );

            if (dist < minDist) {
              minDist = dist;
              closestIndex = i;
            }
          }

          // Calculate centerline tangent at valve
          let tangent = [0, 0, 1];
          if (closestIndex > 0 && closestIndex < numPoints - 1) {
            const prevPoint = [
              centerlineData.position[(closestIndex - 1) * 3],
              centerlineData.position[(closestIndex - 1) * 3 + 1],
              centerlineData.position[(closestIndex - 1) * 3 + 2]
            ];
            const nextPoint = [
              centerlineData.position[(closestIndex + 1) * 3],
              centerlineData.position[(closestIndex + 1) * 3 + 1],
              centerlineData.position[(closestIndex + 1) * 3 + 2]
            ];

            tangent = [
              nextPoint[0] - prevPoint[0],
              nextPoint[1] - prevPoint[1],
              nextPoint[2] - prevPoint[2]
            ];

            // Normalize
            const len = Math.sqrt(tangent[0] ** 2 + tangent[1] ** 2 + tangent[2] ** 2);
            if (len > 0) {
              tangent[0] /= len;
              tangent[1] /= len;
              tangent[2] /= len;
            }
          }

          console.log('📍 Valve position:', valveCenterlinePos);
          console.log('📐 Centerline tangent at valve:', tangent);

          // Position axial viewport to look along centerline at valve
          // This makes the viewing plane PERPENDICULAR to the centerline
          const axialViewport = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
          if (axialViewport) {
            const cameraDistance = 200; // Distance from focal point

            // Camera looks ALONG the centerline tangent (toward the focal point)
            // This creates a plane perpendicular to the centerline
            const cameraPos = [
              valveCenterlinePos[0] + tangent[0] * cameraDistance,
              valveCenterlinePos[1] + tangent[1] * cameraDistance,
              valveCenterlinePos[2] + tangent[2] * cameraDistance
            ] as Types.Point3;

            // Calculate viewUp perpendicular to tangent
            // Use cross product to get a consistent perpendicular vector
            let viewUp: Types.Point3;

            // Choose a reference vector that's not parallel to tangent
            const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];

            // Cross product: tangent × reference = perpendicular
            const cross = [
              tangent[1] * reference[2] - tangent[2] * reference[1],
              tangent[2] * reference[0] - tangent[0] * reference[2],
              tangent[0] * reference[1] - tangent[1] * reference[0]
            ];

            // Normalize
            const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
            if (crossLen > 0) {
              viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
            } else {
              viewUp = [0, 0, 1] as Types.Point3;
            }

            axialViewport.setCamera({
              position: cameraPos,
              focalPoint: valveCenterlinePos as Types.Point3,
              viewUp: viewUp,
              parallelScale: 60, // Zoomed in to focus on annulus area
            });

            // Store the locked focal point for annulus definition
            lockedFocalPointRef.current = valveCenterlinePos as Types.Point3;
            console.log('🔒 Locked focal point at valve:', lockedFocalPointRef.current);

            axialViewport.render();

            // Force another render after a short delay to ensure it sticks
            setTimeout(() => {
              axialViewport.render();
              renderingEngine.renderViewports(['axial', 'sagittal', 'coronal']);
            }, 100);

            const camera = axialViewport.getCamera();
            console.log('✅ Axial viewport plane perpendicular to centerline at valve');
            console.log('   Camera position:', camera.position);
            console.log('   Focal point:', camera.focalPoint);
            console.log('   ViewUp:', camera.viewUp);
            console.log('   View plane normal:', camera.viewPlaneNormal);

            // CRITICAL FIX: Get the ACTUAL screen-space directions from the axial camera
            // Instead of using calculated viewUp and sagittalDirection, use what Cornerstone actually set up
            // This ensures the sagittal/coronal views match the crosshair lines exactly

            // Get actual viewUp from camera (this is the GREEN vertical line direction in screen space)
            const actualViewUp = camera.viewUp;

            // Calculate viewRight (RED horizontal line direction) = viewUp × viewPlaneNormal
            // IMPORTANT: Use actualViewUp × viewPlaneNormal (not the reverse) for correct right-hand coordinate system
            const viewPlaneNormal = camera.viewPlaneNormal;
            const actualViewRight = [
              actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
              actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
              actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
            ];

            // Normalize
            const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
            if (rightLen > 0) {
              actualViewRight[0] /= rightLen;
              actualViewRight[1] /= rightLen;
              actualViewRight[2] /= rightLen;
            }

            console.log('📐 Screen-space directions from axial camera:');
            console.log('   actualViewUp (GREEN line):', actualViewUp);
            console.log('   actualViewRight (RED line):', actualViewRight);
            console.log('   viewPlaneNormal (forward):', viewPlaneNormal);

            // CRITICAL FIX: Get initial rotation angle from FixedCrosshairTool
            // The crosshair might already have a rotation offset that we need to account for
            const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
            const fixedCrosshairTool = toolGroup?.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
            const initialRotation = fixedCrosshairTool?.getRotationAngle ? fixedCrosshairTool.getRotationAngle() : 0;

            console.log('🔄 Initial crosshair rotation:', (initialRotation * 180 / Math.PI).toFixed(1), '°');

            // Apply initial rotation to the screen-space directions
            // This ensures cameras match the actual crosshair line orientations
            const cos = Math.cos(initialRotation);
            const sin = Math.sin(initialRotation);

            // Rotate actualViewRight and actualViewUp by the initial rotation angle
            const rotatedViewRight = [
              actualViewRight[0] * cos - actualViewUp[0] * sin,
              actualViewRight[1] * cos - actualViewUp[1] * sin,
              actualViewRight[2] * cos - actualViewUp[2] * sin
            ];

            const rotatedViewUp = [
              actualViewRight[0] * sin + actualViewUp[0] * cos,
              actualViewRight[1] * sin + actualViewUp[1] * cos,
              actualViewRight[2] * sin + actualViewUp[2] * cos
            ];

            console.log('📐 Rotated directions (matching crosshair lines):');
            console.log('   rotatedViewUp (GREEN line after rotation):', rotatedViewUp);
            console.log('   rotatedViewRight (RED line after rotation):', rotatedViewRight);

            // Position sagittal viewport - looks perpendicular to GREEN line
            const sagittalViewport = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
            if (sagittalViewport) {
              const sagCameraPos = [
                valveCenterlinePos[0] + rotatedViewRight[0] * cameraDistance,
                valveCenterlinePos[1] + rotatedViewRight[1] * cameraDistance,
                valveCenterlinePos[2] + rotatedViewRight[2] * cameraDistance
              ] as Types.Point3;

              sagittalViewport.setCamera({
                position: sagCameraPos,
                focalPoint: valveCenterlinePos as Types.Point3,
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: 60, // Zoomed in to focus on annulus area
              });

              sagittalViewport.render();
              console.log('✅ Sagittal viewport: camera perpendicular to GREEN line');
            }

            // Position coronal viewport - looks perpendicular to RED line
            const coronalViewport = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
            if (coronalViewport) {
              const corCameraPos = [
                valveCenterlinePos[0] + rotatedViewUp[0] * cameraDistance,
                valveCenterlinePos[1] + rotatedViewUp[1] * cameraDistance,
                valveCenterlinePos[2] + rotatedViewUp[2] * cameraDistance
              ] as Types.Point3;

              coronalViewport.setCamera({
                position: corCameraPos,
                focalPoint: valveCenterlinePos as Types.Point3,
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: 60, // Zoomed in to focus on annulus area
              });

              coronalViewport.render();
              console.log('✅ Coronal viewport: camera perpendicular to RED line');
            }

            // For annulus definition, hide interactive crosshairs and show fixed ones
            setTimeout(() => {
              try {
                const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
                if (toolGroup) {
                  console.log('🔄 Switching to fixed crosshairs for annulus definition...');

                  // Disable interactive CrosshairsTool
                  toolGroup.setToolDisabled(CrosshairsTool.toolName);

                  // Enable FixedCrosshairTool and set its position
                  const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
                  if (fixedCrosshairTool) {
                    fixedCrosshairTool.setFixedPosition(valveCenterlinePos as Types.Point3, renderingEngineId);

                    // Set up callback to update valve sphere and viewports when center dot is dragged
                    // This enables viewport updates BEFORE cusp dots are placed (free dragging mode)
                    fixedCrosshairTool.setValveSphereUpdateCallback((newPosition: Types.Point3) => {
                      console.log('🔴 Center dot dragged (initial setup), updating valve sphere and viewports:', newPosition);

                      // Update valve sphere position
                      if (onSpherePositionsUpdate && existingSpheres) {
                        const updatedSpheres = existingSpheres.map((sphere, index) => {
                          if (index === 1) {
                            return { ...sphere, pos: newPosition };
                          }
                          return sphere;
                        });
                        onSpherePositionsUpdate(updatedSpheres);

                        // Update the visual sphere in the tool directly
                        const sphereTool = toolGroup?.getToolInstance(SphereMarkerTool.toolName) as any;
                        if (sphereTool && sphereTool.spheres && sphereTool.spheres.length >= 2) {
                          sphereTool.spheres[1].pos = [newPosition[0], newPosition[1], newPosition[2]];
                          if (sphereTool.spheres[1].source) {
                            sphereTool.spheres[1].source.setCenter(newPosition[0], newPosition[1], newPosition[2]);
                            sphereTool.spheres[1].source.modified();
                          }
                          sphereTool._updateConnectionLines();
                        }
                      }

                      // Update locked focal point ref
                      lockedFocalPointRef.current = newPosition;

                      // CRITICAL: Update all viewport cameras ONLY BEFORE annular plane is defined
                      // AFTER annular plane is defined, viewports stay locked to the annular plane orientation
                      const isAnnularPlaneDefined = cuspDotsRef.current && cuspDotsRef.current.length === 3;

                      if (!isAnnularPlaneDefined) {
                        // BEFORE 3 cusp dots: Update viewports to follow the new center position (like crosshair)
                        console.log('📐 Updating viewport cameras to follow center dot (before annular plane)');
                        const renderingEngine = renderingEngineRef.current;
                        if (renderingEngine) {
                          const currentAxialVp = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
                          if (currentAxialVp) {
                            // Get current axial camera settings
                            const currentAxialCamera = currentAxialVp.getCamera();
                            const cameraDistance = 200;

                            // Update axial viewport focal point
                            const newAxialCameraPos = [
                              newPosition[0] + currentAxialCamera.viewPlaneNormal[0] * cameraDistance,
                              newPosition[1] + currentAxialCamera.viewPlaneNormal[1] * cameraDistance,
                              newPosition[2] + currentAxialCamera.viewPlaneNormal[2] * cameraDistance
                            ] as Types.Point3;

                            currentAxialVp.setCamera({
                              ...currentAxialCamera,
                              position: newAxialCameraPos,
                              focalPoint: newPosition
                            });
                            currentAxialVp.render();

                            // Update sagittal and coronal viewports to show the new slice position
                            // Get current rotation angle from fixed crosshair
                            const currentRotationAngle = fixedCrosshairTool.getRotationAngle() || 0;
                            const cos = Math.cos(currentRotationAngle);
                            const sin = Math.sin(currentRotationAngle);

                            // Calculate view directions based on current rotation
                            const viewPlaneNormal = currentAxialCamera.viewPlaneNormal;
                            const actualViewUp = currentAxialCamera.viewUp;

                            const actualViewRight = [
                              actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
                              actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
                              actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
                            ];

                            const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
                            if (rightLen > 0) {
                              actualViewRight[0] /= rightLen;
                              actualViewRight[1] /= rightLen;
                              actualViewRight[2] /= rightLen;
                            }

                            const rotatedViewRight = [
                              actualViewRight[0] * cos - actualViewUp[0] * sin,
                              actualViewRight[1] * cos - actualViewUp[1] * sin,
                              actualViewRight[2] * cos - actualViewUp[2] * sin
                            ];

                            const rotatedViewUp = [
                              actualViewRight[0] * sin + actualViewUp[0] * cos,
                              actualViewRight[1] * sin + actualViewUp[1] * cos,
                              actualViewRight[2] * sin + actualViewUp[2] * cos
                            ];

                            // Update sagittal viewport
                            const sagittalVp = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
                            if (sagittalVp) {
                              const sagCameraPos = [
                                newPosition[0] + rotatedViewRight[0] * cameraDistance,
                                newPosition[1] + rotatedViewRight[1] * cameraDistance,
                                newPosition[2] + rotatedViewRight[2] * cameraDistance
                              ] as Types.Point3;

                              sagittalVp.setCamera({
                                position: sagCameraPos,
                                focalPoint: newPosition,
                                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                                parallelScale: sagittalVp.getCamera().parallelScale
                              });
                              sagittalVp.render();
                            }

                            // Update coronal viewport
                            const coronalVp = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
                            if (coronalVp) {
                              const corCameraPos = [
                                newPosition[0] + rotatedViewUp[0] * cameraDistance,
                                newPosition[1] + rotatedViewUp[1] * cameraDistance,
                                newPosition[2] + rotatedViewUp[2] * cameraDistance
                              ] as Types.Point3;

                              coronalVp.setCamera({
                                position: corCameraPos,
                                focalPoint: newPosition,
                                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                                parallelScale: coronalVp.getCamera().parallelScale
                              });
                              coronalVp.render();
                            }

                          }
                        }
                      } else {
                        // AFTER 3 cusp dots: Viewports stay locked to annular plane orientation
                        console.log('🔒 Viewports locked to annular plane (after 3 cusp dots)');
                      }
                    });

                    // CRITICAL: Set tool to ACTIVE (not just enabled) so mouse callbacks work
                    toolGroup.setToolActive(FixedCrosshairTool.toolName, {
                      bindings: [{ mouseButton: MouseBindings.Primary }],
                    });

                    console.log('✅ Fixed crosshairs activated at valve position with rotation enabled');
                  }

                  // Force render all viewports to show fixed crosshairs
                  renderingEngine.renderViewports(['axial', 'sagittal', 'coronal']);
                }
              } catch (error) {
                console.error('Failed to setup fixed crosshairs:', error);
              }

              console.log('🔄 All viewports aligned to centerline-based coordinate system');
            }, 200);
          }
        }, 500); // Delay after tools are set up
      }

      // For MEASUREMENTS stage, position cameras at annular plane
      if (currentStage === WorkflowStage.MEASUREMENTS && lockedFocalPointRef.current && centerlineDataRef.current) {
        console.log('✅ MEASUREMENTS stage - Positioning cameras at annular plane');

        // CRITICAL: Remove old volume3D viewport from previous stage
        // It's no longer displayed but still in the rendering engine, causing resize warnings
        setTimeout(() => {
          const renderingEngine = renderingEngineRef.current;
          if (renderingEngine) {
            // Check if old volume3D viewport exists and remove it
            try {
              const oldVolume3D = renderingEngine.getViewport('volume3D');
              if (oldVolume3D) {
                console.log('🧹 Removing old volume3D viewport from ROOT_DEFINITION stage...');
                renderingEngine.disableElement('volume3D');
                console.log('  ✅ Old volume3D viewport removed');
              }
            } catch (e) {
              console.log('  ℹ️ No old volume3D viewport to remove');
            }
          }
        }, 100);

        // CRITICAL: Force viewport resize and crosshair recalculation after layout change
        // Viewports have been rebound to new elements, now ensure everything is sized correctly
        setTimeout(() => {
          const renderingEngine = renderingEngineRef.current;
          if (renderingEngine) {
            console.log('📐 Verifying viewport sizes after rebinding...');
            const viewportIds = ['axial', 'sagittal', 'coronal'];

            let allValid = true;

            // Use for loop instead of forEach to ensure better error handling
            for (let i = 0; i < viewportIds.length; i++) {
              const id = viewportIds[i];

              try {
                console.log(`  🔍 Processing viewport ${i + 1}/${viewportIds.length}: ${id}`);

                const viewport = renderingEngine.getViewport(id);
                if (!viewport) {
                  console.warn(`  ⚠️ ${id}: Viewport not found in rendering engine`);
                  allValid = false;
                  continue;
                }

                const element = elementRefs[id]?.current;
                if (!element) {
                  console.warn(`  ⚠️ ${id}: Element ref not found`);
                  allValid = false;
                  continue;
                }

                const width = element.clientWidth;
                const height = element.clientHeight;
                console.log(`  📏 ${id}: ${width}x${height}`);

                if (width === 0 || height === 0) {
                  console.warn(`  ⚠️ ${id}: Zero dimension detected!`);
                  allValid = false;
                }

                // CRITICAL: Ensure volumes are set for all orthographic viewports
                if (viewport.type === 'orthographic') {
                  try {
                    const actors = (viewport as any).getActors?.();
                    const hasVolumes = actors && actors.length > 0;
                    console.log(`  📦 ${id}: Has volumes: ${hasVolumes}, actors: ${actors?.length || 0}`);

                    if (!hasVolumes) {
                      console.log(`  🔄 ${id}: Re-setting volumes for empty viewport...`);
                      viewport.setVolumes([{ volumeId }]);
                      viewport.render();
                      console.log(`  ✅ ${id}: Volumes set and rendered successfully`);
                    }
                  } catch (volError) {
                    console.error(`  ❌ ${id}: Error during volume check:`, volError);
                    // Continue to next viewport even if volume check fails
                  }
                } else {
                  console.log(`  📦 ${id}: 3D viewport, skipping volume check`);
                }

                console.log(`  ✅ ${id}: Processing complete`);

              } catch (error) {
                console.error(`  ❌ ${id}: Unexpected error during processing:`, error);
                // Continue to next viewport even if this one fails
              }
            }

            console.log(`  📊 Processed ${viewportIds.length} viewports, allValid=${allValid}`);

            // CRITICAL: Use manualResize() utility for proper viewport resizing
            // This preserves view presentation (zoom, pan, rotation, displayArea)
            console.log('  🔄 Using manualResize() utility to resize with presentation preservation...');
            manualResize(renderingEngineId, viewportIds);
            console.log('  ✅ Viewports resized with presentation preservation');

            // CRITICAL: Reset FixedCrosshairTool viewport cache AFTER viewports are resized
            // This ensures crosshair positions are recalculated with correct dimensions
            const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
            if (toolGroup) {
              const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
              if (fixedCrosshairTool && typeof fixedCrosshairTool.resetViewportSizes === 'function') {
                fixedCrosshairTool.resetViewportSizes();
                console.log('  🔄 FixedCrosshairTool cache reset after viewport resize');
                // Force a render to recalculate crosshair positions
                setTimeout(() => {
                  if (allValid) {
                    renderingEngine.render();
                    console.log('  ✅ Crosshairs recalculated with new viewport dimensions');
                  } else {
                    console.warn('  ⚠️ Some viewports have invalid dimensions, skipping crosshair recalculation');
                  }
                }, 150);
              }
            }
          }
        }, 500); // Increased delay to ensure rebinding and volume loading complete

        // Wait longer to ensure volumes are fully loaded before positioning cameras
        setTimeout(() => {
          console.log('🎯 Setting up cameras at annular plane for measurements');
          console.log('  📍 Annulus position:', lockedFocalPointRef.current);
          console.log('  🔗 Centerline data available:', !!centerlineDataRef.current);

          const annulusCenter = lockedFocalPointRef.current!;
          const centerlineData = centerlineDataRef.current;

          // Find nearest centerline index to annulus center
          const nearestIndex = findNearestCenterlineIndex(annulusCenter);
          const position = getCenterlinePositionAtIndex(nearestIndex);
          const tangent = getCenterlineTangentAtIndex(nearestIndex);

          if (!position || !tangent) {
            console.warn('⚠️ Failed to get centerline position/tangent for measurements');
            return;
          }

          console.log('📍 Annulus center:', annulusCenter);
          console.log('📐 Centerline tangent:', tangent);

          const renderingEngine = renderingEngineRef.current;
          if (!renderingEngine) {
            console.error('❌ Rendering engine not available');
            return;
          }

          // Position axial viewport perpendicular to centerline at annulus
          const axialViewport = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
          if (axialViewport) {
            console.log('  ✅ Axial viewport found, positioning camera...');
            const cameraDistance = 200;

            const cameraPos = [
              position[0] + tangent[0] * cameraDistance,
              position[1] + tangent[1] * cameraDistance,
              position[2] + tangent[2] * cameraDistance
            ] as Types.Point3;

            // Calculate viewUp perpendicular to tangent
            let viewUp: Types.Point3;
            const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
            const cross = [
              tangent[1] * reference[2] - tangent[2] * reference[1],
              tangent[2] * reference[0] - tangent[0] * reference[2],
              tangent[0] * reference[1] - tangent[1] * reference[0]
            ];

            const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
            if (crossLen > 0) {
              viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
            } else {
              viewUp = [0, 0, 1] as Types.Point3;
            }

            axialViewport.setCamera({
              position: cameraPos,
              focalPoint: position,
              viewUp: viewUp,
              parallelScale: 60, // Zoomed in view
            });

            axialViewport.render();
            console.log('✅ Axial viewport: positioned at annular plane');

            // Position sagittal and coronal viewports
            const newCamera = axialViewport.getCamera();
            const viewPlaneNormal = newCamera.viewPlaneNormal;
            const actualViewUp = newCamera.viewUp;

            // Calculate actualViewRight
            const actualViewRight = [
              actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
              actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
              actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
            ];

            const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
            if (rightLen > 0) {
              actualViewRight[0] /= rightLen;
              actualViewRight[1] /= rightLen;
              actualViewRight[2] /= rightLen;
            }

            // Position sagittal viewport
            const sagittalViewport = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
            if (sagittalViewport) {
              const sagCameraPos = [
                position[0] + actualViewRight[0] * cameraDistance,
                position[1] + actualViewRight[1] * cameraDistance,
                position[2] + actualViewRight[2] * cameraDistance
              ] as Types.Point3;

              sagittalViewport.setCamera({
                position: sagCameraPos,
                focalPoint: position,
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: 60, // Zoomed in view
              });

              sagittalViewport.render();
              console.log('✅ Sagittal viewport: positioned at annular plane');
            }

            // Position coronal viewport
            const coronalViewport = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
            if (coronalViewport) {
              const corCameraPos = [
                position[0] + actualViewUp[0] * cameraDistance,
                position[1] + actualViewUp[1] * cameraDistance,
                position[2] + actualViewUp[2] * cameraDistance
              ] as Types.Point3;

              coronalViewport.setCamera({
                position: corCameraPos,
                focalPoint: position,
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: 60, // Zoomed in view
              });

              coronalViewport.render();
              console.log('✅ Coronal viewport: positioned at annular plane');
            }

            // Create annulus reference lines in sagittal and coronal views
            import('@kitware/vtk.js/Filters/Sources/LineSource').then((module) => {
              const vtkLineSource = module.default;
              return import('@kitware/vtk.js/Filters/General/TubeFilter').then((tubeModule) => {
                const vtkTubeFilter = tubeModule.default;
                return import('@kitware/vtk.js/Rendering/Core/Mapper').then((mapperModule) => {
                  const vtkMapper = mapperModule.default;
                  return import('@kitware/vtk.js/Rendering/Core/Actor').then((actorModule) => {
                    const vtkActor = actorModule.default;

                  // Remove old annulus lines if they exist
                  if (annulusLineActorsRef.current) {
                    if (sagittalViewport && annulusLineActorsRef.current.sagittal) {
                      try {
                        sagittalViewport.removeActor({ uid: 'annulus-line-sagittal' });
                      } catch (e) { /* ignore */ }
                    }
                    if (coronalViewport && annulusLineActorsRef.current.coronal) {
                      try {
                        coronalViewport.removeActor({ uid: 'annulus-line-coronal' });
                      } catch (e) { /* ignore */ }
                    }
                  }

                  // Create thin grayish-black line at annulus level
                  const lineLength = 80; // Shorter line to stay within viewport

                  // Sagittal view: line goes left-right (along actualViewUp direction)
                  if (sagittalViewport) {
                    const lineSource = vtkLineSource.newInstance();
                    const lineStart = [
                      position[0] - actualViewUp[0] * lineLength,
                      position[1] - actualViewUp[1] * lineLength,
                      position[2] - actualViewUp[2] * lineLength
                    ];
                    const lineEnd = [
                      position[0] + actualViewUp[0] * lineLength,
                      position[1] + actualViewUp[1] * lineLength,
                      position[2] + actualViewUp[2] * lineLength
                    ];
                    lineSource.setPoint1(lineStart);
                    lineSource.setPoint2(lineEnd);

                    // Use tube filter for smooth, anti-aliased appearance
                    const tubeFilter = vtkTubeFilter.newInstance();
                    tubeFilter.setInputConnection(lineSource.getOutputPort());
                    tubeFilter.setRadius(0.3); // Thin smooth tube (0.3mm)
                    tubeFilter.setNumberOfSides(16); // Smooth circular profile
                    tubeFilter.setCapping(true);

                    const mapper = vtkMapper.newInstance();
                    mapper.setInputConnection(tubeFilter.getOutputPort());

                    const actor = vtkActor.newInstance();
                    actor.setMapper(mapper);

                    const property = actor.getProperty();
                    property.setColor(0.55, 0.55, 0.55); // Medium gray
                    property.setOpacity(0.7);
                    property.setInterpolationToPhong(); // Smooth shading

                    sagittalViewport.addActor({ uid: 'annulus-line-sagittal', actor });

                    if (!annulusLineActorsRef.current) {
                      annulusLineActorsRef.current = { sagittal: null, coronal: null };
                    }
                    annulusLineActorsRef.current.sagittal = actor;
                  }

                  // Coronal view: line goes left-right (along actualViewRight direction)
                  if (coronalViewport) {
                    const lineSource = vtkLineSource.newInstance();
                    const lineStart = [
                      position[0] - actualViewRight[0] * lineLength,
                      position[1] - actualViewRight[1] * lineLength,
                      position[2] - actualViewRight[2] * lineLength
                    ];
                    const lineEnd = [
                      position[0] + actualViewRight[0] * lineLength,
                      position[1] + actualViewRight[1] * lineLength,
                      position[2] + actualViewRight[2] * lineLength
                    ];
                    lineSource.setPoint1(lineStart);
                    lineSource.setPoint2(lineEnd);

                    // Use tube filter for smooth, anti-aliased appearance
                    const tubeFilter = vtkTubeFilter.newInstance();
                    tubeFilter.setInputConnection(lineSource.getOutputPort());
                    tubeFilter.setRadius(0.3); // Thin smooth tube (0.3mm)
                    tubeFilter.setNumberOfSides(16); // Smooth circular profile
                    tubeFilter.setCapping(true);

                    const mapper = vtkMapper.newInstance();
                    mapper.setInputConnection(tubeFilter.getOutputPort());

                    const actor = vtkActor.newInstance();
                    actor.setMapper(mapper);

                    const property = actor.getProperty();
                    property.setColor(0.55, 0.55, 0.55); // Medium gray
                    property.setOpacity(0.7);
                    property.setInterpolationToPhong(); // Smooth shading

                    coronalViewport.addActor({ uid: 'annulus-line-coronal', actor });

                    if (!annulusLineActorsRef.current) {
                      annulusLineActorsRef.current = { sagittal: null, coronal: null };
                    }
                    annulusLineActorsRef.current.coronal = actor;
                  }

                    // Render viewports with new lines
                    renderingEngine.renderViewports(['sagittal', 'coronal']);
                    console.log('✅ Annulus reference lines added to sagittal and coronal views');
                  });
                });
              });
            });

            // Force render all viewports
            renderingEngine.renderViewports(['axial', 'sagittal', 'coronal']);
            console.log('🔄 All viewports positioned at annular plane for measurements');
          }
        }, 1000); // Increased delay to ensure rebinding, volume loading, and resize complete before camera positioning
      }

    } catch (err) {
      console.error('❌ Failed to initialize MPR Viewport:', err);
      setError(`Failed to load DICOM images: ${err}`);
      setIsLoading(false);
    }
  };

  const adjustToAnnularPlane = (dots: { id: string; pos: [number, number, number]; color: string; cuspType: string }[]) => {
    if (dots.length !== 3 || !renderingEngineRef.current) {
      console.warn('⚠️ Cannot adjust to annular plane: need exactly 3 dots and rendering engine');
      return;
    }

    const renderingEngine = renderingEngineRef.current;

    // Get the 3 cusp points
    const p1 = dots[0].pos as Types.Point3;
    const p2 = dots[1].pos as Types.Point3;
    const p3 = dots[2].pos as Types.Point3;

    console.log('📐 Calculating annular plane from 3 cusp points (SECOND ADJUSTMENT):');
    console.log(`   P1 (${dots[0].cuspType}) - Color: ${dots[0].color}:`, p1);
    console.log(`   P2 (${dots[1].cuspType}) - Color: ${dots[1].color}:`, p2);
    console.log(`   P3 (${dots[2].cuspType}) - Color: ${dots[2].color}:`, p3);

    // Calculate distances between points to verify they're not too close
    const dist12 = Math.sqrt(
      (p2[0] - p1[0]) ** 2 +
      (p2[1] - p1[1]) ** 2 +
      (p2[2] - p1[2]) ** 2
    );
    const dist23 = Math.sqrt(
      (p3[0] - p2[0]) ** 2 +
      (p3[1] - p2[1]) ** 2 +
      (p3[2] - p2[2]) ** 2
    );
    const dist31 = Math.sqrt(
      (p1[0] - p3[0]) ** 2 +
      (p1[1] - p3[1]) ** 2 +
      (p1[2] - p3[2]) ** 2
    );

    console.log(`   Distance P1-P2: ${dist12.toFixed(2)}mm`);
    console.log(`   Distance P2-P3: ${dist23.toFixed(2)}mm`);
    console.log(`   Distance P3-P1: ${dist31.toFixed(2)}mm`);

    // Calculate two vectors in the plane
    const v1 = [
      p2[0] - p1[0],
      p2[1] - p1[1],
      p2[2] - p1[2]
    ];

    const v2 = [
      p3[0] - p1[0],
      p3[1] - p1[1],
      p3[2] - p1[2]
    ];

    // Calculate plane normal: v1 × v2
    let planeNormal = [
      v1[1] * v2[2] - v1[2] * v2[1],
      v1[2] * v2[0] - v1[0] * v2[2],
      v1[0] * v2[1] - v1[1] * v2[0]
    ];

    // Normalize
    const normalLen = Math.sqrt(planeNormal[0] ** 2 + planeNormal[1] ** 2 + planeNormal[2] ** 2);
    if (normalLen > 0) {
      planeNormal[0] /= normalLen;
      planeNormal[1] /= normalLen;
      planeNormal[2] /= normalLen;
    }

    // CRITICAL: Ensure normal points in correct direction (towards ascending aorta, away from LV)
    // Use centerline direction to determine correct orientation
    // The normal should point generally in the same direction as the centerline at the valve
    if (centerlineDataRef.current && spherePositionsRef.current.length >= 2) {
      const lvPos = spherePositionsRef.current[0]; // LV outflow
      const ascendingPos = spherePositionsRef.current[2]; // Ascending aorta

      // Calculate expected direction (from LV towards ascending aorta)
      const expectedDir = [
        ascendingPos[0] - lvPos[0],
        ascendingPos[1] - lvPos[1],
        ascendingPos[2] - lvPos[2]
      ];

      // Normalize expected direction
      const expectedLen = Math.sqrt(expectedDir[0] ** 2 + expectedDir[1] ** 2 + expectedDir[2] ** 2);
      if (expectedLen > 0) {
        expectedDir[0] /= expectedLen;
        expectedDir[1] /= expectedLen;
        expectedDir[2] /= expectedLen;
      }

      // Dot product to check alignment
      const alignment = planeNormal[0] * expectedDir[0] +
                       planeNormal[1] * expectedDir[1] +
                       planeNormal[2] * expectedDir[2];

      // If normal points opposite to expected direction, flip it
      if (alignment < 0) {
        console.log('⚠️ Plane normal pointing wrong direction, flipping...');
        console.log('   Original normal:', planeNormal);
        planeNormal[0] = -planeNormal[0];
        planeNormal[1] = -planeNormal[1];
        planeNormal[2] = -planeNormal[2];
        console.log('   Flipped normal:', planeNormal);
      } else {
        console.log('✅ Plane normal direction correct (alignment:', alignment.toFixed(3), ')');
      }
    }

    // Calculate center of the 3 points (annulus center - centroid)
    const annulusCenter: Types.Point3 = [
      (p1[0] + p2[0] + p3[0]) / 3,
      (p1[1] + p2[1] + p3[1]) / 3,
      (p1[2] + p2[2] + p3[2]) / 3
    ];

    console.log('   Plane normal:', planeNormal);
    console.log('   📍 Annulus center (centroid of 3 cusp dots):', annulusCenter);
    console.log('   Distance from P1 to center:', Math.sqrt(
      (p1[0] - annulusCenter[0])**2 +
      (p1[1] - annulusCenter[1])**2 +
      (p1[2] - annulusCenter[2])**2
    ).toFixed(2), 'mm');
    console.log('   Distance from P2 to center:', Math.sqrt(
      (p2[0] - annulusCenter[0])**2 +
      (p2[1] - annulusCenter[1])**2 +
      (p2[2] - annulusCenter[2])**2
    ).toFixed(2), 'mm');
    console.log('   Distance from P3 to center:', Math.sqrt(
      (p3[0] - annulusCenter[0])**2 +
      (p3[1] - annulusCenter[1])**2 +
      (p3[2] - annulusCenter[2])**2
    ).toFixed(2), 'mm');

    // CRITICAL: Move the red sphere (valve) to the annulus center (centroid)
    // The valve position should be at the exact center of the triangle formed by the 3 cusp dots
    const valveSphere = spherePositionsRef.current[1]; // Middle sphere (red, valve)

    console.log('🔴 Moving RED valve sphere to annulus center (centroid):');
    console.log('   Original valve position:', valveSphere);
    console.log('   Target position (centroid):', annulusCenter);

    const moveDistance = Math.sqrt(
      (valveSphere[0] - annulusCenter[0])**2 +
      (valveSphere[1] - annulusCenter[1])**2 +
      (valveSphere[2] - annulusCenter[2])**2
    );
    console.log('   Distance to move:', moveDistance.toFixed(2), 'mm');

    // Update the valve sphere position to the centroid
    spherePositionsRef.current[1] = annulusCenter;

    // Update the sphere in the parent component and tool
    if (onSpherePositionsUpdate && existingSpheres) {
      const updatedSpheres = existingSpheres.map((sphere, index) => {
        if (index === 1) {
          // Update the middle sphere (valve) with centroid position
          return { ...sphere, pos: annulusCenter };
        }
        return sphere;
      });
      onSpherePositionsUpdate(updatedSpheres);

      // Update the visual sphere in the tool directly
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      const sphereTool = toolGroup?.getToolInstance(SphereMarkerTool.toolName) as any;
      if (sphereTool && sphereTool.spheres && sphereTool.spheres.length >= 2) {
        // Update the middle sphere (valve) position to centroid
        sphereTool.spheres[1].pos = [annulusCenter[0], annulusCenter[1], annulusCenter[2]];

        // Update the sphere source center
        if (sphereTool.spheres[1].source) {
          sphereTool.spheres[1].source.setCenter(annulusCenter[0], annulusCenter[1], annulusCenter[2]);
          sphereTool.spheres[1].source.modified();
        }

        // Update connection lines
        sphereTool._updateConnectionLines();

        // Render all viewports
        const enabledElements = getEnabledElements();
        enabledElements.forEach(({ viewport }: any) => viewport.render());

        console.log('✅ RED valve sphere moved to exact centroid position');
      }
    }

    // Regenerate centerline with the valve at centroid position
    console.log('🔄 Regenerating centerline with projected valve position...');
    const updatedCenterlineData = CenterlineGenerator.generateFromRootPoints(
      spherePositionsRef.current.map((pos, index) => ({
        id: `sphere-${index}`,
        position: pos,
        type: index === 0 ? RootPointType.LV_OUTFLOW :
              index === 1 ? RootPointType.AORTIC_VALVE :
              RootPointType.ASCENDING_AORTA,
        timestamp: Date.now()
      }))
    );
    centerlineDataRef.current = updatedCenterlineData;

    // Recalculate scroll step size for updated centerline
    const numPoints = updatedCenterlineData.position.length / 3;
    let totalLength = 0;
    for (let i = 1; i < numPoints; i++) {
      const dx = updatedCenterlineData.position[i * 3] - updatedCenterlineData.position[(i - 1) * 3];
      const dy = updatedCenterlineData.position[i * 3 + 1] - updatedCenterlineData.position[(i - 1) * 3 + 1];
      const dz = updatedCenterlineData.position[i * 3 + 2] - updatedCenterlineData.position[(i - 1) * 3 + 2];
      totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const avgSegmentLength = totalLength / (numPoints - 1);
    const targetStepMM = 0.1; // 0.1mm per scroll event
    cprScrollStepSizeRef.current = targetStepMM / avgSegmentLength;
    console.log(`📏 Updated scroll step: ${cprScrollStepSizeRef.current.toFixed(3)} index units = ${targetStepMM}mm`);

    console.log('✅ Centerline regenerated with projected valve');

    // IMPORTANT: Project annulus center onto centerline to get accurate focal point
    // This ensures proper alignment and avoids camera orientation issues
    const centerlineData = centerlineDataRef.current;
    if (!centerlineData) {
      console.error('❌ No centerline data available');
      return;
    }

    const centerlinePointCount = centerlineData.position.length / 3;
    let closestIndex = 0;
    let minDist = Infinity;
    for (let i = 0; i < centerlinePointCount; i++) {
      const x = centerlineData.position[i * 3];
      const y = centerlineData.position[i * 3 + 1];
      const z = centerlineData.position[i * 3 + 2];
      const dist = Math.sqrt(
        Math.pow(x - annulusCenter[0], 2) +
        Math.pow(y - annulusCenter[1], 2) +
        Math.pow(z - annulusCenter[2], 2)
      );
      if (dist < minDist) {
        minDist = dist;
        closestIndex = i;
      }
    }

    // Get the closest centerline point as the focal point
    const newFocalPoint: Types.Point3 = [
      centerlineData.position[closestIndex * 3],
      centerlineData.position[closestIndex * 3 + 1],
      centerlineData.position[closestIndex * 3 + 2]
    ];

    console.log('📍 Annulus center (centroid):', annulusCenter);
    console.log('📍 Closest centerline point (focal point):', newFocalPoint);
    console.log('📍 Closest centerline index:', closestIndex);
    console.log('📏 Distance from centroid to centerline:', minDist.toFixed(2), 'mm');

    // Get the centerline tangent at this point (CRITICAL: use tangent, not plane normal!)
    const tangent = getCenterlineTangentAtIndex(closestIndex);
    if (!tangent) {
      console.error('❌ Failed to get centerline tangent at index', closestIndex);
      return;
    }

    console.log('📐 Centerline tangent at annulus:', tangent);
    console.log('📐 Plane normal:', planeNormal);

    // Position axial camera perpendicular to the annular plane
    const axialVp = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
    if (!axialVp) return;

    const cameraDistance = 200;

    // Camera position along the plane normal (from annulus center)
    const cameraPos: Types.Point3 = [
      newFocalPoint[0] + planeNormal[0] * cameraDistance,
      newFocalPoint[1] + planeNormal[1] * cameraDistance,
      newFocalPoint[2] + planeNormal[2] * cameraDistance
    ];

    // CRITICAL: Calculate viewUp using EXACT same method as scroll handler (lines 6086-6100)
    // Use tangent × reference where reference depends on tangent[2]
    let viewUp: Types.Point3;
    const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const cross = [
      tangent[1] * reference[2] - tangent[2] * reference[1],
      tangent[2] * reference[0] - tangent[0] * reference[2],
      tangent[0] * reference[1] - tangent[1] * reference[0]
    ];

    const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
    if (crossLen > 0) {
      viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
      console.log('✅ ViewUp calculated using EXACT scroll handler method:', viewUp);
      console.log('   tangent:', tangent);
      console.log('   reference:', reference);
    } else {
      viewUp = [0, 0, 1] as Types.Point3;
      console.warn('⚠️ Cross product too small, using fallback [0,0,1]');
    }

    // Preserve current zoom level
    const currentCamera = axialVp.getCamera();
    const currentParallelScale = currentCamera.parallelScale || 60;

    console.log('🎥 Setting axial camera perpendicular to annular plane (SECOND ADJUSTMENT):');
    console.log('   Camera position:', cameraPos);
    console.log('   Focal point (centerline):', newFocalPoint);
    console.log('   ViewUp (using same cross product as scroll):', viewUp);
    console.log('   Preserving parallelScale:', currentParallelScale);

    // Set camera - spread existing camera to preserve clippingRange and other properties
    // This ensures crosshair synchronization is maintained
    axialVp.setCamera({
      ...currentCamera,
      position: cameraPos,
      focalPoint: newFocalPoint,
      viewUp: viewUp,
      parallelScale: currentParallelScale, // Preserve current zoom level
    });

    // CRITICAL: Lock the camera orientation so scrolling doesn't change it
    // Store the camera position direction (normalized) and viewUp
    const viewDirection = [
      cameraPos[0] - newFocalPoint[0],
      cameraPos[1] - newFocalPoint[1],
      cameraPos[2] - newFocalPoint[2]
    ];
    const viewDirLen = Math.sqrt(viewDirection[0] ** 2 + viewDirection[1] ** 2 + viewDirection[2] ** 2);
    const normalizedViewDir: Types.Point3 = [
      viewDirection[0] / viewDirLen,
      viewDirection[1] / viewDirLen,
      viewDirection[2] / viewDirLen
    ];

    lockedAxialCameraRef.current = {
      position: normalizedViewDir, // Store normalized direction, not absolute position
      viewUp: viewUp,
      parallelScale: currentParallelScale
    };

    console.log('🔒 Locked axial camera orientation:', {
      viewDirection: normalizedViewDir,
      viewUp: viewUp,
      parallelScale: currentParallelScale
    });

    console.log('📐 Axial viewport camera updated to be perpendicular to annular plane');

    // Force immediate render to apply camera changes
    axialVp.render();

    // CRITICAL: Add camera modified listener to re-apply orientation after scrolling
    // This ensures the orientation stays locked even when the focal point changes
    const cameraModifiedListener = () => {
      if (!lockedAxialCameraRef.current) return;

      const currentCam = axialVp.getCamera();
      const locked = lockedAxialCameraRef.current;

      // Calculate new camera position from current focal point and locked direction
      const newCameraPos: Types.Point3 = [
        currentCam.focalPoint[0] + locked.position[0] * cameraDistance,
        currentCam.focalPoint[1] + locked.position[1] * cameraDistance,
        currentCam.focalPoint[2] + locked.position[2] * cameraDistance
      ];

      // Check if orientation has changed (viewUp or position direction)
      const currentViewDir = [
        currentCam.position[0] - currentCam.focalPoint[0],
        currentCam.position[1] - currentCam.focalPoint[1],
        currentCam.position[2] - currentCam.focalPoint[2]
      ];
      const currentViewDirLen = Math.sqrt(
        currentViewDir[0] ** 2 + currentViewDir[1] ** 2 + currentViewDir[2] ** 2
      );
      const normalizedCurrentViewDir = [
        currentViewDir[0] / currentViewDirLen,
        currentViewDir[1] / currentViewDirLen,
        currentViewDir[2] / currentViewDirLen
      ];

      // Calculate dot product to check if direction changed
      const dotProduct =
        normalizedCurrentViewDir[0] * locked.position[0] +
        normalizedCurrentViewDir[1] * locked.position[1] +
        normalizedCurrentViewDir[2] * locked.position[2];

      // If orientation has changed significantly (dot product < 0.99), re-apply it
      if (dotProduct < 0.99) {
        console.log('🔄 Re-applying locked camera orientation (orientation changed during scroll)');
        axialVp.setCamera({
          ...currentCam,
          position: newCameraPos,
          viewUp: locked.viewUp,
          parallelScale: locked.parallelScale
        });
        axialVp.render();
      }
    };

    // Add listener to axial viewport's camera modified event
    const axialElement = axialVp.element;
    axialElement.addEventListener(Enums.Events.CAMERA_MODIFIED, cameraModifiedListener);

    // Store listener reference for cleanup
    (axialElement as any)._annulusPlaneOrientationListener = cameraModifiedListener;

    console.log('✅ Axial viewport camera set perpendicular to annular plane with orientation lock');

    // CRITICAL: Also update sagittal and coronal viewports to show the annular plane
    // They should intersect at the annulus center focal point
    const sagittalViewport = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
    const coronalViewport = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;

    if (sagittalViewport) {
      const sagCam = sagittalViewport.getCamera();
      sagittalViewport.setCamera({
        ...sagCam,
        focalPoint: newFocalPoint,
      });
      sagittalViewport.render();
      console.log('✅ Sagittal viewport focal point updated');
    }

    if (coronalViewport) {
      const corCam = coronalViewport.getCamera();
      coronalViewport.setCamera({
        ...corCam,
        focalPoint: newFocalPoint,
      });
      coronalViewport.render();
      console.log('✅ Coronal viewport focal point updated');
    }

    // CRITICAL: Use CrosshairsTool to synchronize - trigger jump to annulus center
    // This ensures all viewports scroll to show the intersection at the annular plane
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    const crosshairTool = toolGroup?.getToolInstance(CrosshairsTool.toolName) as any;

    if (crosshairTool) {
      console.log('🎯 Triggering CrosshairsTool jump to annulus center');

      // Force crosshair to jump to the new focal point
      // This will cause all synchronized viewports to update their slices
      try {
        // Simulate a mouse event at the focal point in the axial viewport
        // This is the most reliable way to make CrosshairsTool jump
        const canvas = axialVp.canvas;

        // Convert world coordinates to canvas coordinates
        const canvasCoords = axialVp.worldToCanvas(newFocalPoint);

        console.log('   Canvas coords for focal point:', canvasCoords);

        // Create a synthetic mouse event
        const mouseEvent = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: canvasCoords[0],
          clientY: canvasCoords[1],
          button: 0 // Left button
        });

        // Dispatch the event to trigger crosshair jump
        canvas.dispatchEvent(mouseEvent);

        // Immediately dispatch mouseup to complete the interaction
        const mouseUpEvent = new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          clientX: canvasCoords[0],
          clientY: canvasCoords[1],
          button: 0
        });
        canvas.dispatchEvent(mouseUpEvent);

        console.log('✅ Crosshair jump triggered via synthetic mouse event');
      } catch (error) {
        console.warn('⚠️ Could not trigger crosshair jump:', error);
      }
    }

    // Final render of all viewports
    renderingEngine.renderViewports(['axial', 'sagittal', 'coronal']);

    console.log('✅ All viewports rendered with new annular plane alignment');

    // Update fixed crosshair to annulus center (red dot at centroid of 3 cusp dots)
    const fixedCrosshairTool = toolGroup?.getToolInstance(FixedCrosshairTool.toolName) as any;
    if (fixedCrosshairTool) {
      console.log('🎯 Setting fixed crosshair (red dot) position to annulus center:', newFocalPoint);
      console.log('   Annulus center (centroid of 3 cusp dots):', annulusCenter);
      console.log('   Are they the same?', newFocalPoint[0] === annulusCenter[0] && newFocalPoint[1] === annulusCenter[1] && newFocalPoint[2] === annulusCenter[2]);
      fixedCrosshairTool.setFixedPosition(newFocalPoint, renderingEngineId);

      // IMPORTANT: Lock the center dot to axial-only movement now that annular plane is defined
      fixedCrosshairTool.setAnnularPlaneDefined(true);

      // Set up callback to update valve sphere when center dot is dragged (axial-only after annular plane)
      fixedCrosshairTool.setValveSphereUpdateCallback((newPosition: Types.Point3) => {
        console.log('🔴 Center dot dragged, updating valve sphere and all viewport cameras:', newPosition);

        // Update valve sphere position
        if (onSpherePositionsUpdate && existingSpheres) {
          const updatedSpheres = existingSpheres.map((sphere, index) => {
            if (index === 1) {
              return { ...sphere, pos: newPosition };
            }
            return sphere;
          });
          onSpherePositionsUpdate(updatedSpheres);

          // Update the visual sphere in the tool directly
          const sphereTool = toolGroup?.getToolInstance(SphereMarkerTool.toolName) as any;
          if (sphereTool && sphereTool.spheres && sphereTool.spheres.length >= 2) {
            sphereTool.spheres[1].pos = [newPosition[0], newPosition[1], newPosition[2]];
            if (sphereTool.spheres[1].source) {
              sphereTool.spheres[1].source.setCenter(newPosition[0], newPosition[1], newPosition[2]);
              sphereTool.spheres[1].source.modified();
            }
            sphereTool._updateConnectionLines();
          }
        }

        // Update locked focal point ref
        lockedFocalPointRef.current = newPosition;

        // CRITICAL: Update all viewport cameras ONLY BEFORE annular plane is defined
        // AFTER annular plane is defined, viewports stay locked to the annular plane orientation
        const isAnnularPlaneDefined = cuspDotsRef.current && cuspDotsRef.current.length === 3;

        if (!isAnnularPlaneDefined) {
          // BEFORE 3 cusp dots: Update viewports to follow the new center position (like crosshair)
          console.log('📐 Updating viewport cameras to follow center dot (before annular plane)');
          const renderingEngine = getRenderingEngine(renderingEngineId);
          if (renderingEngine) {
          const currentAxialVp = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
          if (currentAxialVp) {
            // Get current axial camera settings
            const currentAxialCamera = currentAxialVp.getCamera();
            const cameraDistance = 200;

            // Update axial viewport focal point
            const newAxialCameraPos = [
              newPosition[0] + currentAxialCamera.viewPlaneNormal[0] * cameraDistance,
              newPosition[1] + currentAxialCamera.viewPlaneNormal[1] * cameraDistance,
              newPosition[2] + currentAxialCamera.viewPlaneNormal[2] * cameraDistance
            ] as Types.Point3;

            currentAxialVp.setCamera({
              ...currentAxialCamera,
              position: newAxialCameraPos,
              focalPoint: newPosition
            });
            currentAxialVp.render();

            // Update sagittal and coronal viewports to show the new slice position
            // Get current rotation angle from fixed crosshair
            const currentRotationAngle = fixedCrosshairTool.getRotationAngle() || 0;
            const cos = Math.cos(currentRotationAngle);
            const sin = Math.sin(currentRotationAngle);

            // Calculate view directions based on current rotation
            const viewPlaneNormal = currentAxialCamera.viewPlaneNormal;
            const actualViewUp = currentAxialCamera.viewUp;

            const actualViewRight = [
              actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
              actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
              actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
            ];

            const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
            if (rightLen > 0) {
              actualViewRight[0] /= rightLen;
              actualViewRight[1] /= rightLen;
              actualViewRight[2] /= rightLen;
            }

            const rotatedViewRight = [
              actualViewRight[0] * cos - actualViewUp[0] * sin,
              actualViewRight[1] * cos - actualViewUp[1] * sin,
              actualViewRight[2] * cos - actualViewUp[2] * sin
            ];

            const rotatedViewUp = [
              actualViewRight[0] * sin + actualViewUp[0] * cos,
              actualViewRight[1] * sin + actualViewUp[1] * cos,
              actualViewRight[2] * sin + actualViewUp[2] * cos
            ];

            // Update sagittal viewport
            const sagittalVp = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
            if (sagittalVp) {
              const sagCameraPos = [
                newPosition[0] + rotatedViewRight[0] * cameraDistance,
                newPosition[1] + rotatedViewRight[1] * cameraDistance,
                newPosition[2] + rotatedViewRight[2] * cameraDistance
              ] as Types.Point3;

              sagittalVp.setCamera({
                position: sagCameraPos,
                focalPoint: newPosition,
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: sagittalVp.getCamera().parallelScale
              });
              sagittalVp.render();
            }

            // Update coronal viewport
            const coronalVp = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
            if (coronalVp) {
              const corCameraPos = [
                newPosition[0] + rotatedViewUp[0] * cameraDistance,
                newPosition[1] + rotatedViewUp[1] * cameraDistance,
                newPosition[2] + rotatedViewUp[2] * cameraDistance
              ] as Types.Point3;

              coronalVp.setCamera({
                position: corCameraPos,
                focalPoint: newPosition,
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: coronalVp.getCamera().parallelScale
              });
              coronalVp.render();
            }

            console.log('✅ All viewports updated to follow new center position');
          }
          }
        } else {
          // AFTER 3 cusp dots: Viewports stay locked to annular plane orientation
          console.log('🔒 Viewports locked to annular plane (after 3 cusp dots)');
        }
      });

      // Verify it was set correctly
      const verifyPosition = fixedCrosshairTool.getFixedPosition();
      console.log('🔍 Verified fixed crosshair position:', verifyPosition);
      console.log('✅ Fixed crosshair (red dot) positioned at annulus center');
      console.log('🔒 Center dot now locked to AXIAL-ONLY movement');
    } else {
      console.error('❌ FixedCrosshairTool not found!');
    }

    // Update sagittal and coronal viewports with new screen-space directions
    const newCamera = axialVp.getCamera();
    const viewPlaneNormal = newCamera.viewPlaneNormal;
    const actualViewUp = newCamera.viewUp;

    // Calculate actualViewRight
    const actualViewRight = [
      actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
      actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
      actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
    ];

    const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
    if (rightLen > 0) {
      actualViewRight[0] /= rightLen;
      actualViewRight[1] /= rightLen;
      actualViewRight[2] /= rightLen;
    }

    // Apply rotation if any
    const rotationAngle = fixedCrosshairTool?.getRotationAngle() || 0;
    const cos = Math.cos(rotationAngle);
    const sin = Math.sin(rotationAngle);

    const rotatedViewRight = [
      actualViewRight[0] * cos - actualViewUp[0] * sin,
      actualViewRight[1] * cos - actualViewUp[1] * sin,
      actualViewRight[2] * cos - actualViewUp[2] * sin
    ];

    const rotatedViewUp = [
      actualViewRight[0] * sin + actualViewUp[0] * cos,
      actualViewRight[1] * sin + actualViewUp[1] * cos,
      actualViewRight[2] * sin + actualViewUp[2] * cos
    ];

    // Update sagittal
    const sagittalVp = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
    if (sagittalVp) {
      const sagCameraPos = [
        newFocalPoint[0] + rotatedViewRight[0] * cameraDistance,
        newFocalPoint[1] + rotatedViewRight[1] * cameraDistance,
        newFocalPoint[2] + rotatedViewRight[2] * cameraDistance
      ] as Types.Point3;

      sagittalVp.setCamera({
        position: sagCameraPos,
        focalPoint: newFocalPoint,
        viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
        parallelScale: 60, // Zoomed in to focus on annulus area
      });

      sagittalVp.render();
      console.log('✅ Updated sagittal viewport to annular plane');
    }

    // Update coronal
    const coronalVp = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
    if (coronalVp) {
      const corCameraPos = [
        newFocalPoint[0] + rotatedViewUp[0] * cameraDistance,
        newFocalPoint[1] + rotatedViewUp[1] * cameraDistance,
        newFocalPoint[2] + rotatedViewUp[2] * cameraDistance
      ] as Types.Point3;

      coronalVp.setCamera({
        position: corCameraPos,
        focalPoint: newFocalPoint,
        viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
        parallelScale: 60, // Zoomed in to focus on annulus area
      });

      coronalVp.render();
      console.log('✅ Updated coronal viewport to annular plane');
    }

    // Update locked focal point ref to annulus center
    lockedFocalPointRef.current = newFocalPoint;

    // Force re-render cusp dots after camera adjustment to ensure proper positioning
    const currentToolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    if (currentToolGroup) {
      const cuspTool = currentToolGroup.getToolInstance('CuspNadir');
      if (cuspTool && typeof (cuspTool as any).forceReRenderDots === 'function') {
        console.log('🔄 Force re-rendering cusp dots after camera adjustment to annular plane');
        (cuspTool as any).forceReRenderDots();
      }
      // Note: Valve sphere already moved to centroid earlier in this function
    }

    console.log('✅ All viewports adjusted to be perpendicular to annular plane!');
    console.log('   Green crosshair center positioned at annulus center (centroid of 3 cusp dots)');
    console.log('   Red valve sphere MOVED to annulus center (should be at triangle center)');
    console.log('   All 3 cusp dots should now be visible in the axial view');
    console.log('   Centerline regenerated with valve at annulus center');
  };

  const setupTools = async () => {
    console.log('🔧🔧🔧 SETUP TOOLS STARTING...');

      // Add tools to Cornerstone3D (exactly like App.tsx)
      cornerstoneTools.addTool(CrosshairsTool);
      cornerstoneTools.addTool(ZoomTool);
      cornerstoneTools.addTool(PanTool);
      cornerstoneTools.addTool(WindowLevelTool);
      cornerstoneTools.addTool(StackScrollTool);
      cornerstoneTools.addTool(SphereMarkerTool);
      cornerstoneTools.addTool(CuspNadirTool);
      cornerstoneTools.addTool(FixedCrosshairTool);
      cornerstoneTools.addTool(TrackballRotateTool); // For 3D viewport rotation
      cornerstoneTools.addTool(OrientationMarkerTool); // For orientation markers

      // CROPPING DISABLED - Volume cropping tools disabled
      // cornerstoneTools.addTool(VolumeCroppingTool);
      // cornerstoneTools.addTool(VolumeCroppingControlTool);

      // Add measurement tools
      cornerstoneTools.addTool(SplineROITool);
      cornerstoneTools.addTool(LengthTool);
      cornerstoneTools.addTool(AngleTool);
      cornerstoneTools.addTool(LabelTool);
      cornerstoneTools.addTool(RectangleROITool);
      cornerstoneTools.addTool(ProbeTool);
      cornerstoneTools.addTool(CircleROITool);
      cornerstoneTools.addTool(VerticalDistanceTool);
      cornerstoneTools.addTool(VerticalLineTool);
      cornerstoneTools.addTool(CurvedLeafletTool);

      // Destroy existing tool group if it exists
      try {
        const existingToolGroup = ToolGroupManager.getToolGroup(toolGroupId);
        if (existingToolGroup) {
          console.log('  🗑️ Destroying existing tool group');
          ToolGroupManager.destroyToolGroup(toolGroupId);
        }
      } catch (error) {
        // Tool group doesn't exist, which is fine
        console.log('  ✅ No existing tool group to destroy');
      }

      // Create tool group
      console.log('  🆕 Creating new tool group');
      const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);

      if (!toolGroup) {
        throw new Error('Failed to create tool group');
      }

      // Add Crosshairs tool and configure it to link the three viewports (exactly like App.tsx)
      // Note: Don't activate yet - wait until viewports are added
      // CRITICAL: During ANNULUS_DEFINITION, lock crosshair center at valve (allow rotation, no translation)
      toolGroup.addTool(CrosshairsTool.toolName, {
        getReferenceLineColor: (viewportId) => {
          const colors = {
            axial: "rgb(200, 0, 0)",
            sagittal: "rgb(200, 200, 0)",
            coronal: "rgb(0, 200, 0)",
          };
          return colors[viewportId];
        },
        // Allow all crosshair interactions (we'll lock focal point via event listener)
        getReferenceLineControllable: () => true,
        getReferenceLineDraggableRotatable: () => true,
        getReferenceLineSlabThicknessControlsOn: () => true,
      });

      toolGroup.addTool(ZoomTool.toolName, {
        invert: false,
        preventZoomOutsideImage: true,
      });

      // Zoom tool - disable on sagittal/coronal in CPR mode to prevent line misalignment
      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [
         {
            mouseButton: MouseBindings.Secondary, // Right Click
          },
        ],
      });

      // Disable zoom on CPR viewports (sagittal/coronal) when in CPR mode
      if (renderMode === 'cpr') {
        toolGroup.setToolDisabled(ZoomTool.toolName, ['sagittal', 'coronal']);
        console.log('  🔒 Zoom disabled for sagittal/coronal in CPR mode');
      }

      toolGroup.addTool(PanTool.toolName);

      toolGroup.addTool(WindowLevelTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      // Add RectangleROI tool for volume cropping in ROOT_DEFINITION stage
      toolGroup.addTool(RectangleROITool.toolName);
      toolGroup.addTool(ProbeTool.toolName);
      toolGroup.addTool(CircleROITool.toolName);
      toolGroup.addTool(LabelTool.toolName, {
        configuration: {
          getTextCallback: (callback, defaultText) => callback(defaultText ?? ''),
          changeTextCallback: (data, callback) => callback(data.text ?? ''),
          preventHandleOutsideImage: false,
        }
      });

      // CROPPING DISABLED - VolumeCroppingControlTool disabled
      // toolGroup.addTool(VolumeCroppingControlTool.toolName, {
      //   getReferenceLineColor: (viewportId) => {
      //     const colors = {
      //       axial: "rgb(200, 0, 0)",
      //       sagittal: "rgb(200, 200, 0)",
      //       coronal: "rgb(0, 200, 0)",
      //     };
      //     return colors[viewportId];
      //   },
      //   viewportIndicators: true,
      // });

      // CROPPING DISABLED - VolumeCroppingControlTool activation disabled
      // toolGroup.setToolActive(VolumeCroppingControlTool.toolName, {
      //   bindings: [{ mouseButton: MouseBindings.Primary }],
      // });
      console.log('ℹ️ VolumeCroppingControlTool is DISABLED in MPR viewports');

      toolGroup.addTool(StackScrollTool.toolName, {
        viewportIndicators: true,
      });
      toolGroup.setToolActive(StackScrollTool.toolName, {
        bindings: [
          {
            mouseButton: MouseBindings.Wheel,
          },
          {
            mouseButton: MouseBindings.Secondary,
          }
        ]
      });

      toolGroup.addTool(SphereMarkerTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      // Add CuspNadirTool for cusp nadir point identification
      toolGroup.addTool(CuspNadirTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      // Add FixedCrosshairTool for annulus definition (fixed, non-draggable crosshairs)
      toolGroup.addTool(FixedCrosshairTool.toolName);

      // Add TrackballRotateTool for 3D viewport manipulation
      toolGroup.addTool(TrackballRotateTool.toolName);

      // Set up callback for sphere position updates
      if (onSpherePositionsUpdate) {
        const sphereTool = toolGroup.getToolInstance(SphereMarkerTool.toolName) as SphereMarkerTool;
        if (sphereTool) {
          sphereTool.setPositionUpdateCallback((spheres) => {
            onSpherePositionsUpdate(spheres);

            // If in annulus definition stage and we have 3 cusp dots,
            // update crosshair when valve sphere (index 1) is dragged
            if (currentStage === WorkflowStage.ANNULUS_DEFINITION &&
                cuspDotsRef.current &&
                cuspDotsRef.current.length === 3 &&
                spheres.length >= 3) {

              const valvePos = spheres[1].pos as Types.Point3;

              // Update locked focal point to follow the valve sphere
              lockedFocalPointRef.current = valvePos;

              // Update crosshair center to valve sphere position
              const fixedCrosshairTool = toolGroup.getToolInstance('FixedCrosshair');
              if (fixedCrosshairTool && typeof (fixedCrosshairTool as any).setPosition === 'function') {
                (fixedCrosshairTool as any).setPosition(valvePos);
              }

              console.log('🔴 Valve sphere dragged, crosshair center updated to:', valvePos);
            }
          });
        }
      }

      // Set up callback for cusp dots position updates
      if (onCuspDotsUpdate) {
        const cuspTool = toolGroup.getToolInstance(CuspNadirTool.toolName) as CuspNadirTool;
        if (cuspTool) {
          cuspTool.setPositionUpdateCallback((dots) => {
            // Store cusp dots in ref
            cuspDotsRef.current = dots;

            // Call parent callback
            onCuspDotsUpdate(dots);

            // If we have 3 cusp dots during annulus definition, adjust plane
            if (dots.length === 3 && currentStage === WorkflowStage.ANNULUS_DEFINITION) {
              console.log('🎯 3 cusp dots placed! Adjusting axial view to be perpendicular to annular plane...');
              setTimeout(() => {
                adjustToAnnularPlane(dots);
              }, 100); // Small delay to let rendering settle
            }
          });
        }
      }

      // CRITICAL: Activate CrosshairsTool BEFORE adding viewports (like App.tsx)
      // This is the correct order for proper synchronization
      // EXCEPT for MEASUREMENTS and ROOT_DEFINITION stages
      if (currentStage !== WorkflowStage.MEASUREMENTS && currentStage !== WorkflowStage.ROOT_DEFINITION) {
        console.log('  🎯 Activating CrosshairsTool BEFORE adding viewports...');
        toolGroup.setToolActive(CrosshairsTool.toolName, {
          bindings: [{
            mouseButton: MouseBindings.Primary,
          }],
        });
        console.log('  ✅ CrosshairsTool activated');
      } else {
        console.log('  ⏭️ Skipping CrosshairsTool activation (stage uses different tool)');
      }

      // Add viewports to the tool group AFTER activating CrosshairsTool
      // NOTE: Don't add 3D viewports here - they get their own tool group
      const viewportIds = ["axial", "sagittal", "coronal"];

      console.log('  📌 Adding 2D viewports to main tool group:', viewportIds);
      const renderingEngine = renderingEngineRef.current;
      if (renderingEngine) {
        viewportIds.forEach((id) => {
          // Skip if viewport doesn't exist yet
          const viewport = renderingEngine.getViewport(id);
          if (!viewport) {
            console.log(`    - Skipping ${id} (not yet created)`);
            return;
          }
          toolGroup.addViewport(id, renderingEngineId);
          console.log(`    - Added ${id} to tool group`);
        });
      }

      // Add volume3D viewport to tool group for ROOT_DEFINITION stage
      // Configure it with TrackballRotateTool for 3D manipulation
      if (currentStage === WorkflowStage.ROOT_DEFINITION) {
        console.log('  🎯 Setting up volume3D viewport with TrackballRotateTool');

        // Create a separate tool group for 3D viewport to isolate TrackballRotateTool
        const toolGroup3DId = `${toolGroupId}_3D`;
        let toolGroup3D;

        try {
          const existingToolGroup3D = ToolGroupManager.getToolGroup(toolGroup3DId);
          if (existingToolGroup3D) {
            ToolGroupManager.destroyToolGroup(toolGroup3DId);
          }
        } catch (error) {
          // Tool group doesn't exist
        }

        toolGroup3D = ToolGroupManager.createToolGroup(toolGroup3DId);

        // Add TrackballRotateTool, Zoom, Pan, and OrientationMarker to 3D tool group
        toolGroup3D.addTool(TrackballRotateTool.toolName);
        toolGroup3D.addTool(ZoomTool.toolName);
        toolGroup3D.addTool(PanTool.toolName);
        toolGroup3D.addTool(OrientationMarkerTool.toolName);

        // Configure OrientationMarkerTool with Human.vtp
        toolGroup3D.setToolConfiguration(OrientationMarkerTool.toolName, {
          overlayMarkerType: 3, // CUSTOM type for VTP file
          overlayConfiguration: {
            3: {
              polyDataURL: HumanVTP,
            },
          },
        });
        console.log('🧑 Configured OrientationMarkerTool with Human.vtp:', HumanVTP);

        // Activate tools
        toolGroup3D.setToolActive(TrackballRotateTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });

        toolGroup3D.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Secondary }],
        });

        toolGroup3D.setToolActive(PanTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Auxiliary }],
        });

        // Note: volume3D viewport will be added to tool group AFTER volume is loaded
        // This ensures proper initialization order for VolumeCroppingTool

        console.log('  ✅ 3D tool group created, viewport will be added after volume loads');
      }

      // Add measurement1 viewport to 3D tool group for MEASUREMENTS stage
      if (currentStage === WorkflowStage.MEASUREMENTS) {
        console.log('  🎯 Setting up measurement1 viewport with TrackballRotateTool');

        // Create a separate tool group for 3D viewport to isolate TrackballRotateTool
        const toolGroup3DId = `${toolGroupId}_3D`;
        let toolGroup3D;

        try {
          const existingToolGroup3D = ToolGroupManager.getToolGroup(toolGroup3DId);
          if (existingToolGroup3D) {
            ToolGroupManager.destroyToolGroup(toolGroup3DId);
          }
        } catch (error) {
          // Tool group doesn't exist
        }

        toolGroup3D = ToolGroupManager.createToolGroup(toolGroup3DId);

        // Add TrackballRotateTool, Zoom, Pan, and OrientationMarker to 3D tool group
        toolGroup3D.addTool(TrackballRotateTool.toolName);
        toolGroup3D.addTool(ZoomTool.toolName);
        toolGroup3D.addTool(PanTool.toolName);
        toolGroup3D.addTool(OrientationMarkerTool.toolName);

        // Configure OrientationMarkerTool with Human.vtp
        toolGroup3D.setToolConfiguration(OrientationMarkerTool.toolName, {
          overlayMarkerType: 3, // CUSTOM type for VTP file
          overlayConfiguration: {
            3: {
              polyDataURL: HumanVTP,
            },
          },
        });
        console.log('🧑 Configured OrientationMarkerTool with Human.vtp:', HumanVTP);

        // Activate tools
        toolGroup3D.setToolActive(TrackballRotateTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });

        toolGroup3D.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Secondary }],
        });

        toolGroup3D.setToolActive(PanTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Auxiliary }],
        });

        // Note: measurement1 viewport will be added to tool group AFTER volume is loaded
        // This ensures proper initialization order

        console.log('  ✅ 3D tool group created for measurements stage, viewport will be added after volume loads');
      }

      // CRITICAL: Force render ALL viewports AFTER CrosshairsTool activation
      // This ensures CrosshairsTool's initial state is rendered correctly
      if (renderingEngine) {
        console.log('  🎨 Force rendering all viewports...');
        renderingEngine.renderViewports(viewportIds);
        console.log('  ✅ Force rendered all viewports');
      }

      // Setup slab synchronizer
      const synchronizerId = 'MPR_SLAB_THICKNESS_SYNCHRONIZER_ID';
      if (!slabSynchronizerRef.current) {
        const synchronizer = createSlabThicknessSynchronizer(synchronizerId);
        slabSynchronizerRef.current = synchronizer;
        viewportIds.forEach((id) => {
          synchronizer.add({ renderingEngineId, viewportId: id });
        });
        synchronizer.setEnabled(true);
        console.log('  ✅ Created and enabled slab synchronizer');
      }

      // Zoom synchronization removed per user request
      // Spheres now use fixed sizes regardless of zoom level

      // CRITICAL: Configure distance measurement for MEASUREMENTS stage
      // This must happen AFTER tools are created and added to the tool group
      if (currentStage === WorkflowStage.MEASUREMENTS) {
        console.log('📏 Configuring distance measurement for MEASUREMENTS stage...');

        const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;

        // NOTE: Viewport size cache reset moved to after viewport resize (line 3023)
        // to ensure correct dimensions are used for crosshair calculations

        if (lockedFocalPointRef.current && fixedCrosshairTool) {
          // Disable center dragging during measurements
          if (typeof fixedCrosshairTool.setCenterDraggingDisabled === 'function') {
            fixedCrosshairTool.setCenterDraggingDisabled(true);
            console.log('  🔒 Center dragging disabled');
          }

          // Enable distance measurement from annulus reference position
          if (typeof fixedCrosshairTool.setAnnulusReference === 'function') {
            fixedCrosshairTool.setAnnulusReference(lockedFocalPointRef.current);
            console.log('  📏 Distance measurement enabled at:', lockedFocalPointRef.current);
          }

          // In measurements stage: Use appropriate rotation based on renderMode
          if (typeof fixedCrosshairTool.setCPRRotationCallback === 'function') {
            if (renderMode === 'mpr') {
              // MPR mode: Use camera repositioning
              fixedCrosshairTool.setCPRRotationCallback(null);
              console.log('  🔄 MPR mode in measurements - using camera repositioning');
            }
            // Note: CPR callback will be set by the CPR setup effect if in CPR mode
          }
        } else {
          console.warn('  ⚠️ Cannot configure distance measurement:', {
            hasLockedFocalPoint: !!lockedFocalPointRef.current,
            hasFixedCrosshairTool: !!fixedCrosshairTool
          });
        }
      }

      // Configure measurement tools with viewport restrictions
      console.log('📐 Configuring measurement tools...');

      // 1. Smooth Polygon Tool (SplineROI with CatmullRom) - Axial only
      toolGroup.addToolInstance('SmoothPolygon', SplineROITool.toolName, {
        configuration: {
          calculateStats: true,
        },
        // Viewport filter function: only enable on axial viewport
        getViewportsForAnnotation: (annotation: any, viewportIds: string[]) => {
          return viewportIds.filter(id => id === 'axial');
        }
      });

      // Override the SplineROI statistics calculation to include our custom measurements
      const smoothPolygonTool = toolGroup.getToolInstance('SmoothPolygon');
      if (smoothPolygonTool) {
        // Get the tool's class (constructor)
        const ToolClass = (smoothPolygonTool as any).constructor;

        // Store the original _getTextLines method if it exists (fallback)
        const original_getTextLines = ToolClass.prototype._getTextLines || ToolClass.prototype.getTextLines;

        ToolClass.prototype._getTextLines = function(data: any, targetId: string) {
          const lines: string[] = [];

          if (data?.label) {
            lines.push(data.label);
          }

          const cachedStats = data?.cachedStats || {};
          const volumeIds = Object.keys(cachedStats);
          const stats = volumeIds.length > 0 ? cachedStats[volumeIds[0]] : null;

          const addNumericLine = (prefix: string, value: unknown, suffix: string = '') => {
            if (typeof value === 'number' && isFinite(value)) {
              lines.push(`${prefix}: ${value.toFixed(2)}${suffix}`.trim());
            }
          };

          if (stats) {
            if (Array.isArray(stats.textLines) && stats.textLines.length > 0) {
              lines.push(...stats.textLines);
            } else {
              addNumericLine('Area', stats.area, ' mm²');
              addNumericLine('Area Ø', stats['Area Ø'] ?? stats.areaDerivedDiameter, ' mm');
              addNumericLine('Perim', stats.perimeter, ' mm');
              addNumericLine('Perim Ø', stats['Perimeter Ø'] ?? stats.perimeterDerivedDiameter, ' mm');
              addNumericLine('Long', stats['Long Axis'], ' mm');
              addNumericLine('Short', stats['Short Axis'], ' mm');
            }
          }

          // Fallback to original implementation if nothing generated
          if (lines.length === 0 && typeof original_getTextLines === 'function') {
            try {
              const fallback = original_getTextLines.call(this, data, targetId);
              if (Array.isArray(fallback)) {
                return fallback;
              }
            } catch (error) {
              // ignore fallback errors
            }
          }

          return lines;
        };

        ToolClass.prototype.getTextLines = ToolClass.prototype._getTextLines;
      }

      // 2. Axial Line Tool - Axial only, renderMode-aware
      toolGroup.addToolInstance('AxialLine', LengthTool.toolName, {
        // Viewport filter function: only enable on axial viewport AND only show in matching renderMode
        getViewportsForAnnotation: (annotation: any, viewportIds: string[]) => {
          // Check if annotation has renderMode metadata
          const annotationRenderMode = annotation?.metadata?.renderMode;

          // If annotation has renderMode, only show in matching mode
          if (annotationRenderMode && annotationRenderMode !== renderMode) {
            return []; // Hide in different render mode
          }

          return viewportIds.filter(id => id === 'axial');
        }
      });

      // 3. MPR Long Axis Line Tool - Sagittal/Coronal only, renderMode-aware
      // In CPR mode, use VerticalLineTool to constrain to vertical lines only
      const longAxisToolName = renderMode === 'cpr' ? VerticalLineTool.toolName : LengthTool.toolName;
      toolGroup.addToolInstance('MPRLongAxisLine', longAxisToolName, {
        // Viewport filter function: only enable on sagittal and coronal viewports AND only show in matching renderMode
        getViewportsForAnnotation: (annotation: any, viewportIds: string[]) => {
          // Check if annotation has renderMode metadata
          const annotationRenderMode = annotation?.metadata?.renderMode;

          // If annotation has renderMode, only show in matching mode
          if (annotationRenderMode && annotationRenderMode !== renderMode) {
            return []; // Hide in different render mode
          }

          return viewportIds.filter(id => id === 'sagittal' || id === 'coronal');
        }
      });

      // 4. Angle measurement tool - Axial only
      toolGroup.addToolInstance('AngleMeasurement', AngleTool.toolName, {
        getViewportsForAnnotation: (_annotation: any, viewportIds: string[]) => viewportIds.filter(id => id === 'axial')
      });

      // 5. CurvedLeafletTool - For workflow leaflet measurements (Sagittal/Coronal only)
      toolGroup.addTool(CurvedLeafletTool.toolName, {
        getViewportsForAnnotation: (annotation: any, viewportIds: string[]) => {
          return viewportIds.filter(id => id === 'sagittal' || id === 'coronal');
        }
      });


      // Add event listener for SplineROI annotations to calculate extended statistics
      const annotationModifiedHandler = (evt: any) => {
        const { annotation, element: annotationElement } = evt.detail;

        // Only process SmoothPolygon annotations (our tool instance name)
        if (annotation?.metadata?.toolName !== 'SmoothPolygon') {
          return;
        }

        // Get spline points from annotation
        const splinePoints = annotation?.data?.spline?.points;

        if (!splinePoints || splinePoints.length < 3) {
          return;
        }

        try {
          // Get built-in stats - they're nested by volumeId
          const cachedStats = annotation?.data?.cachedStats;

          // Find the first volumeId key and get its stats
          const volumeIds = Object.keys(cachedStats || {});
          const firstVolumeStats = volumeIds.length > 0 ? cachedStats[volumeIds[0]] : {};

          const area = firstVolumeStats?.area || 0;

          // Calculate perimeter from spline points (built-in perimeter is often 0)
          let perimeter = 0;
          for (let i = 0; i < splinePoints.length; i++) {
            const p1 = splinePoints[i];
            const p2 = splinePoints[(i + 1) % splinePoints.length];

            if (!p1 || !p2 || !Array.isArray(p1) || !Array.isArray(p2)) {
              continue;
            }

            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            const dz = p2[2] - p1[2];
            perimeter += Math.sqrt(dx * dx + dy * dy + dz * dz);
          }

          // Calculate long/short axes
          const axes = calculateSplineAxes(splinePoints, perimeter);

          // Calculate area-derived diameter
          const areaDerivedDiameter = 2 * Math.sqrt(area / Math.PI);

          // Store all measurements in cachedStats for display
          // Stats are stored per volumeId, so update the first volumeId's stats
          if (!annotation.data.cachedStats) {
            annotation.data.cachedStats = {};
          }

          // Prepare text lines for overlay
          let overlayTextLines: string[] = [];

          if (volumeIds.length > 0) {
            const volumeId = volumeIds[0];
            const currentStats = annotation.data.cachedStats[volumeId] || {};

            annotation.data.cachedStats[volumeId] = {
              ...currentStats,
              perimeter: perimeter, // Store calculated perimeter
              'Long Axis': axes.longAxisLength,
              'Short Axis': axes.shortAxisLength,
              'Perimeter Ø': axes.perimeterDerivedDiameter,
              'Area Ø': areaDerivedDiameter,
            };

            // Create custom text lines array for display
            if (area > 0) {
              overlayTextLines.push(`Area: ${area.toFixed(2)} mm²`);
            }
            if (areaDerivedDiameter > 0) {
              overlayTextLines.push(`Area Ø: ${areaDerivedDiameter.toFixed(2)} mm`);
            }
            if (axes.longAxisLength > 0) {
              overlayTextLines.push(`Long: ${axes.longAxisLength.toFixed(2)} mm`);
            }
            if (axes.shortAxisLength > 0) {
              overlayTextLines.push(`Short: ${axes.shortAxisLength.toFixed(2)} mm`);
            }
            if (perimeter > 0) {
              overlayTextLines.push(`Perim: ${perimeter.toFixed(2)} mm`);
              if (axes.perimeterDerivedDiameter > 0) {
                overlayTextLines.push(`Perim Ø: ${axes.perimeterDerivedDiameter.toFixed(2)} mm`);
              }
            }

            // Add textBox handle with custom text (Cornerstone3D renders this)
            if (!annotation.data.handles.textBox) {
              annotation.data.handles.textBox = {
                hasMoved: false,
                worldPosition: [0, 0, 0] as Types.Point3,
                worldBoundingBox: {
                  topLeft: [0, 0, 0] as Types.Point3,
                  topRight: [0, 0, 0] as Types.Point3,
                  bottomLeft: [0, 0, 0] as Types.Point3,
                  bottomRight: [0, 0, 0] as Types.Point3,
                }
              };
            }

            // If a custom/workflow label exists, prepend it so it displays as the first line
            const customLabel = annotation.metadata?.customLabel;
            if (customLabel?.text) {
              overlayTextLines = [customLabel.text, ...overlayTextLines];
            }

            // Store text lines in cached stats for rendering
            annotation.data.cachedStats[volumeId].textLines = overlayTextLines;
          }

          // Store axes endpoints in metadata for potential line overlay
          if (!annotation.metadata) {
            annotation.metadata = {};
          }
          annotation.metadata.axesMeasurements = axes;

          // Mark annotation as modified to trigger re-render
          annotation.invalidated = true;

          // Trigger re-render of axis lines
          setAxisLinesKey(prev => prev + 1);

          // Add custom text overlay using React state
          const viewportId = annotation.metadata?.viewportId || 'axial';
          if (annotation.data?.handles?.points?.length > 0 && overlayTextLines.length > 0) {
            // Get the first point of the polygon as anchor
            const firstPoint = annotation.data.handles.points[0];

            // Get viewport to convert world to canvas
            const viewport = renderingEngineRef.current?.getViewport(viewportId);
            if (viewport) {
              const canvasPoint = viewport.worldToCanvas(firstPoint) as Types.Point2;
              const viewportElement = getViewportElementById(viewportId);
              const displayPoint = canvasToDisplayPoint(viewport, viewportElement, canvasPoint);

              // Update React state to show overlay
              setAnnotationOverlays(prev => {
                // Find existing overlay for this annotation
                const existingOverlay = prev.find(o => o.uid === annotation.annotationUID);
                const filtered = prev.filter(o => o.uid !== annotation.annotationUID);

                // Check if user has moved the text (stored in annotation metadata)
                const customPos = annotation.metadata?.customTextPosition;
                const userMoved = customPos?.userMoved || existingOverlay?.userMoved || false;

                // If user moved it, use the stored custom position
                // Otherwise use default position from first point
                const overlayX = userMoved && customPos ? customPos.x : displayPoint[0] + 10;
                const overlayY = userMoved && customPos ? customPos.y : displayPoint[1] - 10;

                // Add new overlay with preserved position if user moved it
                return [...filtered, {
                  uid: annotation.annotationUID,
                  x: overlayX,
                  y: overlayY,
                  lines: overlayTextLines,
                  viewportId,
                  annotationUID: annotation.annotationUID,
                  userMoved: userMoved
                }];
              });
            }
          }
        } catch (error) {
          // Silent error handling
        }
      };

      // Use annotation state API to monitor for new annotations
      const { annotation: annotationAPI } = cornerstoneTools;

      // Listen for annotation events to calculate/update stats
      // Note: axialElement declared above using document.getElementById, but we'll use the ref instead

      // Track which annotations we've processed and their polyline hash
      const processedAnnotations = new Map<string, string>();

      const getPolylineHash = (polyline: number[]): string => {
        // Create a simple hash from first/last few points to detect changes
        if (polyline.length < 6) return polyline.join(',');
        return `${polyline[0]},${polyline[1]},${polyline[2]},${polyline[polyline.length-3]},${polyline[polyline.length-2]},${polyline[polyline.length-1]},${polyline.length}`;
      };

      // Track if user is currently dragging
      let isDragging = false;

      const handleAnnotationRendered = (evt: any) => {
        // ANNOTATION_RENDERED is the only event that fires for SplineROI tool
        // We need to check all annotations to find closed ones we haven't processed yet

        // Skip processing during drag to prevent snap-back
        if (isDragging) return;

        try {
          const allAnnotations = annotationAPI?.state?.getAllAnnotations?.();
          if (!allAnnotations) return;

          allAnnotations.forEach((annotation: any) => {
            // Only process SmoothPolygon annotations that are closed
            if (annotation?.metadata?.toolName === 'SmoothPolygon' &&
                annotation?.data?.contour?.closed) {

              const uid = annotation.annotationUID;
              const polyline = annotation.data?.contour?.polyline || [];

              const currentHash = getPolylineHash(polyline);

              // Check if this annotation has changed since last processing
              const lastHash = processedAnnotations.get(uid);

              if (!lastHash || lastHash !== currentHash) {
                // New or modified annotation - process it
                processedAnnotations.set(uid, currentHash);

                // Check if polyline is already in point format or flat format
                let contourPoints: [number, number, number][] = [];

                if (Array.isArray(polyline[0])) {
                  // Polyline is already an array of points [x,y,z]
                  contourPoints = polyline as [number, number, number][];
                } else {
                  // Polyline is flat array, convert to points
                  for (let i = 0; i < polyline.length; i += 3) {
                    contourPoints.push([polyline[i], polyline[i+1], polyline[i+2]]);
                  }
                }

                if (contourPoints.length >= 3) {
                  // Modify the annotation in-place instead of creating a new object
                  // This prevents the annotation from "snapping back" when dragged
                  if (!annotation.data.spline) {
                    annotation.data.spline = {};
                  }
                  annotation.data.spline.points = contourPoints;

                  annotationModifiedHandler({ detail: { annotation: annotation } });
                }
              }
              // If hash matches, skip processing (already calculated and unchanged)
            }
          });
        } catch (error) {
          // Silent error handling
        }
      };

      // Track workflow-processed annotations separately (existing processedAnnotations is for stats)
      const workflowProcessedAnnotations = new Set<string>();

      // Add event listener to tag annotations with renderMode when they're completed
      const annotationCompletedHandler = (evt: any) => {
        // Use refs to get latest values and avoid closure issues
        const currentWorkflowControlled = workflowControlledRef.current;
        const currentStep = currentWorkflowStepRef.current;
        const measurementCompleteCallback = onMeasurementCompleteRef.current;

        const { annotation, element: annotationElement } = evt.detail;

        // Prevent duplicate processing of the same annotation
        if (annotation?.annotationUID && workflowProcessedAnnotations.has(annotation.annotationUID)) {
          console.log('⚠️ Skipping duplicate event for annotation:', annotation.annotationUID);
          return;
        }

        console.log('🎯 ANNOTATION_COMPLETED event fired!', evt.detail);
        console.log('   workflowControlled:', currentWorkflowControlled);
        console.log('   currentWorkflowStep:', currentStep);
        console.log('   annotation:', annotation);
        console.log('   toolName:', annotation?.metadata?.toolName);

        // Tag line annotations with current renderMode
        if (annotation?.metadata?.toolName === 'AxialLine' ||
            annotation?.metadata?.toolName === 'MPRLongAxisLine') {
          if (!annotation.metadata) {
            annotation.metadata = {};
          }
          annotation.metadata.renderMode = renderMode;
        }

        // Workflow auto-labeling: apply label from workflow step
        if (currentStep && annotation) {
          const isWorkflowControlled = workflowControlledRef.current;
          const workflowManager = getWorkflowManager();
          const expectedToolName = workflowManager.getToolNameForStep(currentStep);

          let measuredValue: any = null;
          const toolName = annotation?.metadata?.toolName;

          if (toolName !== expectedToolName) {
            console.warn('⚠️ Annotation tool does not match step requirement, ignoring.', {
              expectedToolName,
              actualTool: toolName,
              step: currentStep.id,
            });
            if (annotation.annotationUID) {
              workflowProcessedAnnotations.add(annotation.annotationUID);
            }
            return;
          }

          if (toolName === 'SplineROITool' || toolName === 'SmoothPolygon') {
            const stats = annotation?.data?.cachedStats;
            if (stats) {
              const volumeId = Object.keys(stats)[0];
              measuredValue = {
                area: stats[volumeId]?.area,
                perimeter: stats[volumeId]?.perimeter,
                areaDerivedDiameter: stats[volumeId]?.areaDerivedDiameter,
                perimeterDerivedDiameter: stats[volumeId]?.perimeterDerivedDiameter,
              };
            }
          } else if (toolName === 'AxialLine' || toolName === 'MPRLongAxisLine') {
            const handles = annotation?.data?.handles;
            if (handles?.points) {
              const length = annotation?.data?.cachedStats?.length;
              measuredValue = { length };
            }
          } else if (toolName === CurvedLeafletTool.toolName) {
            const splinePoints = annotation?.data?.spline?.points;
            if (splinePoints && splinePoints.length >= 2) {
              const length = CurvedLeafletTool.calculateCurveLength(splinePoints);
              measuredValue = { length };
            }
          }

          const measurementAnnotations = measurementAnnotationByStepRef.current;
          const existingAnnotationUID = measurementAnnotations[currentStep.id];
          if (existingAnnotationUID && existingAnnotationUID !== annotation.annotationUID) {
            console.log('🗑️ Removing previous workflow annotation for step:', currentStep.name);
            deleteAnnotation(existingAnnotationUID);
            delete measurementAnnotations[currentStep.id];
          }

          const isAutoMode = isWorkflowControlled && autoAdvanceWorkflowRef.current;

          if (!isAutoMode) {
            measurementAnnotations[currentStep.id] = annotation.annotationUID;
            if (annotation.annotationUID) {
              workflowProcessedAnnotations.add(annotation.annotationUID);
            }

            setCurrentMeasurementData({
              annotationUID: annotation.annotationUID,
              measuredValue,
            });
            setMeasurementReadyForConfirm(true);

            console.log(`✅ Annotation recorded for step ${currentStep.name} (manual mode). Waiting for user confirmation.`);
            return;
          }

          measurementAnnotations[currentStep.id] = annotation.annotationUID;

          console.log('✅ Entering workflow auto-labeling logic');
          console.log('   Current step ID:', currentStep.id);
          console.log('   Current step name:', currentStep.name);
          console.log('   Current step autoLabel:', currentStep.autoLabel);

          const labelData = workflowManager.getLabelForStep(currentStep);

          console.log(`🏷️ Auto-labeling annotation for step: ${currentStep.name}`);
          console.log(`   Label from manager: "${labelData.text}", Color: ${labelData.color}`);

          const cachedStats = annotation?.data?.cachedStats;
          const overlayVolumeIds = cachedStats ? Object.keys(cachedStats) : [];
          const statsForOverlay = overlayVolumeIds.length > 0 ? cachedStats[overlayVolumeIds[0]] : undefined;

          const measurementLines: string[] = [];
          const appendLine = (label: string, value?: number, unit: string = '') => {
            if (typeof value === 'number' && isFinite(value)) {
              measurementLines.push(`${label}: ${value.toFixed(2)}${unit}`);
            }
          };

          if (statsForOverlay) {
            if (Array.isArray(statsForOverlay.textLines) && statsForOverlay.textLines.length > 0) {
              measurementLines.push(
                ...statsForOverlay.textLines.filter(line => line && line !== labelData.text)
              );
            } else {
              const areaValue = typeof statsForOverlay.area === 'number' ? statsForOverlay.area : undefined;
              const areaDiameter = statsForOverlay['Area Ø'] ?? statsForOverlay.areaDerivedDiameter ??
                (typeof areaValue === 'number' ? 2 * Math.sqrt(areaValue / Math.PI) : undefined);
              const perimeterValue = typeof statsForOverlay.perimeter === 'number' ? statsForOverlay.perimeter : undefined;
              const perimeterDiameter = statsForOverlay['Perimeter Ø'] ?? statsForOverlay.perimeterDerivedDiameter ??
                (typeof perimeterValue === 'number' ? perimeterValue / Math.PI : undefined);

              appendLine('Area', areaValue, ' mm²');
              appendLine('Area Ø', areaDiameter, ' mm');
              appendLine('Perim', perimeterValue, ' mm');
              appendLine('Perim Ø', perimeterDiameter, ' mm');
              appendLine('Long', statsForOverlay['Long Axis'], ' mm');
              appendLine('Short', statsForOverlay['Short Axis'], ' mm');
            }
          } else if (measuredValue && typeof measuredValue === 'object') {
            const mv: any = measuredValue;
            const areaValue = mv.area;
            const areaDiameter = mv.areaDerivedDiameter ?? (typeof areaValue === 'number' ? 2 * Math.sqrt(areaValue / Math.PI) : undefined);
            const perimeterValue = mv.perimeter;
            const perimeterDiameter = mv.perimeterDerivedDiameter ?? (typeof perimeterValue === 'number' ? perimeterValue / Math.PI : undefined);

            appendLine('Area', areaValue, ' mm²');
            appendLine('Area Ø', areaDiameter, ' mm');
            appendLine('Perim', perimeterValue, ' mm');
            appendLine('Perim Ø', perimeterDiameter, ' mm');
            appendLine('Length', mv.length, ' mm');
          }
      };

      // Delay attaching event listeners until DOM elements are ready
      setTimeout(() => {
        const axialElementFromRef = elementRefs.axial.current;

        if (axialElementFromRef) {
          axialElementFromRef.addEventListener(csToolsEnums.Events.ANNOTATION_RENDERED, handleAnnotationRendered);
        }

        // Listen to global event target for annotation completion (not DOM elements)
        eventTarget.addEventListener(csToolsEnums.Events.ANNOTATION_COMPLETED, annotationCompletedHandler);
      }, 500);

      // Customize annotation rendering to show extended statistics
      const annotationRenderingHandler = (evt: any) => {
        const { element, viewportId, renderingEngine } = evt.detail;

        // Only customize for SmoothPolygon annotations
        const enabledElement = element;
        if (!enabledElement) return;

        // Get all annotations for this viewport
        const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
        if (!toolGroup) return;

        // We'll render custom text overlays in a separate canvas layer
        // This is handled by modifying the annotation's text content
        // The annotation system will automatically render it
      };

      // Handle right-click on annotations to show context menu
      const handleAnnotationContextMenu = (evt: MouseEvent) => {
        if (currentStage !== WorkflowStage.MEASUREMENTS) {
          return;
        }

        evt.preventDefault();

        // Get the viewport element that was clicked
        const target = evt.target as HTMLElement;

        // Determine which viewport was clicked by checking which ref contains the target
        let viewportId: string | null = null;
        let viewportElement: HTMLElement | null = null;

        if (elementRefs.axial.current?.contains(target)) {
          viewportId = 'axial';
          viewportElement = elementRefs.axial.current;
        } else if (elementRefs.sagittal.current?.contains(target)) {
          viewportId = 'sagittal';
          viewportElement = elementRefs.sagittal.current;
        } else if (elementRefs.coronal.current?.contains(target)) {
          viewportId = 'coronal';
          viewportElement = elementRefs.coronal.current;
        }

        if (!viewportId || !viewportElement) {
          return;
        }

        const viewport = renderingEngineRef.current?.getViewport(viewportId);
        if (!viewport) {
          return;
        }

        // Get canvas and display coordinates
        const rect = (viewportElement as HTMLElement).getBoundingClientRect();
        const canvas = viewport.getCanvas() as HTMLCanvasElement;

        // Calculate click position in canvas pixel space (not display space)
        const canvasX = ((evt.clientX - rect.left) / rect.width) * canvas.width;
        const canvasY = ((evt.clientY - rect.top) / rect.height) * canvas.height;

        // Check for CPR position indicator line (only in sagittal/coronal when centerline data exists)

        // Check if we have CPR position line data (indicates CPR mode is active)
        if ((viewportId === 'sagittal' || viewportId === 'coronal') &&
            centerlineDataRef.current &&
            cprPositionRatioRef.current !== undefined) {
          console.log(`  📍 CPR position line data detected in ${viewportId}`);
          if (canvas) {
            const { height: canvasHeight } = canvas;

            console.log(`  📏 Canvas height: ${canvasHeight}, Display height: ${rect.height}`);

            // The line is drawn at positionRatio of the CANVAS height (not display height)
            // because drawCPRPositionLineOnCanvas uses canvas.height
            const positionRatio = cprPositionRatioRef.current;
            const lineYPixel = positionRatio * canvasHeight;

            console.log(`  📏 positionRatio=${positionRatio}, lineYPixel=${lineYPixel}, clickY=${canvasY}`);

            const tolerance = 15; // pixels - increased tolerance
            const distance = Math.abs(canvasY - lineYPixel);
            console.log(`  📐 Distance from line: ${distance}px (tolerance=${tolerance}px)`);

            // Check if click is near the horizontal CPR position line
            if (distance <= tolerance) {
              console.log(`  ✅ Click detected on CPR position line!`);
              // Calculate the arc length at this position
              const positions = centerlineDataRef.current.position;
              const numCenterlinePoints = positions.length / 3;

              // Calculate total arc length
              let totalDistance = 0;
              for (let i = 1; i < numCenterlinePoints; i++) {
                const dx = positions[i * 3] - positions[(i - 1) * 3];
                const dy = positions[i * 3 + 1] - positions[(i - 1) * 3 + 1];
                const dz = positions[i * 3 + 2] - positions[(i - 1) * 3 + 2];
                const segmentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
                totalDistance += segmentLength;
              }

              // Calculate arc length at current position
              const currentDistance = positionRatio * totalDistance;

              // Calculate distance from annulus (same logic as yellow label on CPR)
              let distanceFromAnnulus = 0;
              let annulusYPixel = 0;
              if (cprAnnulusRatioRef.current !== undefined) {
                const annulusDistance = cprAnnulusRatioRef.current * totalDistance;
                // Negative = below annulus (towards LV), Positive = above annulus (towards ascending aorta)
                distanceFromAnnulus = currentDistance - annulusDistance;
                // Calculate annulus Y position in CANVAS coordinates (not display)
                annulusYPixel = cprAnnulusRatioRef.current * canvasHeight;
              }

              console.log(`  📊 Distance from annulus: ${distanceFromAnnulus.toFixed(2)}mm`);

              // Show context menu with special type for CPR line
              setViewportContextMenu(null);
              setContextMenu({
                x: evt.clientX,
                y: evt.clientY,
                annotationUID: 'cpr-position-line',
                viewportId,
                cprLineData: {
                  arcLength: currentDistance,
                  totalLength: totalDistance,
                  positionRatio: positionRatio,
                  distanceFromAnnulus: distanceFromAnnulus,
                  viewportId: viewportId,
                  annulusYPixel: annulusYPixel,
                  clickedYPixel: canvasY
                }
              });
              console.log(`  ✅ Context menu set!`);
              return;
            } else {
              console.log(`  ❌ Click too far from line (${distance}px > ${tolerance}px)`);
            }
          }
        }

        // Convert to world coordinates
        const worldPoint = viewport.canvasToWorld([canvasX, canvasY]);

        // Check if click is near any annotation
        const allAnnotations = cornerstoneTools.annotation.state.getAllAnnotations();
        const tolerance = 150; // pixels - very large tolerance for easier clicking


        console.log(`Checking ${allAnnotations.length} annotations`);

        for (const annotation of allAnnotations) {
          // Note: Polygon context menu is handled by right-clicking on the text overlay
          // (see onContextMenu handler in the text overlay div above)

          // Check for line annotations (AxialLine, MPRLongAxisLine)
          if ((annotation.metadata?.toolName === 'AxialLine' || annotation.metadata?.toolName === 'MPRLongAxisLine')
              && annotation.data?.handles?.points?.length === 2) {
            console.log(`Found line: ${annotation.metadata?.toolName}, uid: ${annotation.annotationUID.substring(0, 8)}`);
            const p1 = annotation.data.handles.points[0];
            const p2 = annotation.data.handles.points[1];

            // For AxialLine, check if line is in current slice
            if (annotation.metadata?.toolName === 'AxialLine') {
              const camera = viewport.getCamera();
              const { viewPlaneNormal, focalPoint } = camera;

              const p1Vector = [p1[0] - focalPoint[0], p1[1] - focalPoint[1], p1[2] - focalPoint[2]];
              const p2Vector = [p2[0] - focalPoint[0], p2[1] - focalPoint[1], p2[2] - focalPoint[2]];

              const p1Distance = Math.abs(
                p1Vector[0] * viewPlaneNormal[0] +
                p1Vector[1] * viewPlaneNormal[1] +
                p1Vector[2] * viewPlaneNormal[2]
              );

              const p2Distance = Math.abs(
                p2Vector[0] * viewPlaneNormal[0] +
                p2Vector[1] * viewPlaneNormal[1] +
                p2Vector[2] * viewPlaneNormal[2]
              );

              const slabThickness = (viewport as any).getSlabThickness?.() || 0.1;
              const visibilityThreshold = slabThickness / 2;

              if (p1Distance > visibilityThreshold && p2Distance > visibilityThreshold) {
                continue;
              }
            }

            const p1Canvas = viewport.worldToCanvas(p1);
            const p2Canvas = viewport.worldToCanvas(p2);

            const distToLine = distanceToLineSegment(
              [canvasX, canvasY],
              p1Canvas,
              p2Canvas
            );

            console.log(`  Distance to line: ${distToLine.toFixed(2)}px (tolerance: ${tolerance}px)`);

            if (distToLine <= tolerance) {
              console.log(`  ✅ Showing context menu for line`);
              setViewportContextMenu(null);
              setContextMenu({
                x: evt.clientX,
                y: evt.clientY,
                annotationUID: annotation.annotationUID,
                viewportId
              });
              return;
            } else {
              console.log(`  ❌ Too far from line`);
            }
          }
        }

        // No annotation context menu fired - fall back to general viewport actions when appropriate
        if (currentStage === WorkflowStage.MEASUREMENTS && viewportId) {
          setContextMenu(null);
          setViewportContextMenu({
            x: evt.clientX,
            y: evt.clientY,
            viewportId,
          });
        }

        // Helper function to calculate distance from point to line segment
        function distanceToLineSegment(
          point: number[],
          lineStart: number[],
          lineEnd: number[]
        ): number {
          const x = point[0], y = point[1];
          const x1 = lineStart[0], y1 = lineStart[1];
          const x2 = lineEnd[0], y2 = lineEnd[1];

          const A = x - x1;
          const B = y - y1;
          const C = x2 - x1;
          const D = y2 - y1;

          const dot = A * C + B * D;
          const lenSq = C * C + D * D;
          let param = -1;

          if (lenSq !== 0) param = dot / lenSq;

          let xx, yy;

          if (param < 0) {
            xx = x1;
            yy = y1;
          } else if (param > 1) {
            xx = x2;
            yy = y2;
          } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
          }

          const dx = x - xx;
          const dy = y - yy;
          return Math.sqrt(dx * dx + dy * dy);
        }
      };

      // Add camera modified listener to update overlay positions
      const updateOverlayPositions = () => {
        if (!renderingEngineRef.current) return;

        setAnnotationOverlays(prev => {
          const updated: typeof prev = [];
          const processedUIDs = new Set<string>();

          // First, update existing overlays
          prev.forEach(overlay => {
            try {
              const annotations = annotationAPI?.state?.getAllAnnotations?.();
              const annotation = annotations?.find((ann: any) => ann.annotationUID === overlay.annotationUID);

              if (!annotation || !annotation.data?.handles?.points?.length) {
                return; // Annotation deleted
              }

              processedUIDs.add(overlay.annotationUID);

              const viewport = renderingEngineRef.current?.getViewport(overlay.viewportId);
              if (!viewport) return;

              let firstPoint: Types.Point3 | null = null;
              if (Array.isArray(annotation.data?.handles?.points) && annotation.data.handles.points.length > 0) {
                firstPoint = [...annotation.data.handles.points[0]] as Types.Point3;
              } else if (Array.isArray(annotation.data?.contour?.polyline) && annotation.data.contour.polyline.length >= 3) {
                const polyline = annotation.data.contour.polyline;
                firstPoint = [polyline[0], polyline[1], polyline[2]] as Types.Point3;
              }

              if (!firstPoint) return;
              const camera = viewport.getCamera();
              const { viewPlaneNormal, focalPoint } = camera;

              const vectorToPoint = [
                firstPoint[0] - focalPoint[0],
                firstPoint[1] - focalPoint[1],
                firstPoint[2] - focalPoint[2]
              ];

              const distanceToPlane = Math.abs(
                vectorToPoint[0] * viewPlaneNormal[0] +
                vectorToPoint[1] * viewPlaneNormal[1] +
                vectorToPoint[2] * viewPlaneNormal[2]
              );

              const slabThickness = (viewport as any).getSlabThickness?.() || 0.1;
              const visibilityThreshold = slabThickness / 2;
              const isVisible = distanceToPlane <= visibilityThreshold;

              if (isVisible) {
                const canvasPoint = viewport.worldToCanvas(firstPoint) as Types.Point2;
                const canvas = viewport.canvas;
                const isInBounds = canvasPoint[0] >= -50 &&
                                 canvasPoint[0] <= canvas.width + 50 &&
                                 canvasPoint[1] >= -50 &&
                                 canvasPoint[1] <= canvas.height + 50;

                if (isInBounds) {
                  // Check if user has moved the text (stored in annotation metadata)
                  const customPos = annotation.metadata?.customTextPosition;
                  const userMoved = customPos?.userMoved || overlay.userMoved || false;

                  // Preserve user's dragged position if they moved it
                  const viewportElement = getViewportElementById(overlay.viewportId);
                  const displayPoint = canvasToDisplayPoint(viewport, viewportElement, canvasPoint);
                  const finalX = userMoved && customPos ? customPos.x : displayPoint[0] + 10;
                  const finalY = userMoved && customPos ? customPos.y : displayPoint[1] - 10;

                  updated.push({
                    ...overlay,
                    x: finalX,
                    y: finalY,
                    userMoved: userMoved
                  });
                }
              }
            } catch (error) {
              console.warn('Error updating overlay:', error);
            }
          });

          // Check for annotations that don't have overlays yet (newly visible)
          try {
            const allAnnotations = annotationAPI?.state?.getAllAnnotations?.();
            if (allAnnotations) {
              allAnnotations.forEach((annotation: any) => {
                if (annotation.metadata?.toolName === 'SmoothPolygon' &&
                    !processedUIDs.has(annotation.annotationUID) &&
                    annotation.data?.contour?.closed) {

                  // Check if this annotation is visible
             const viewport = renderingEngineRef.current?.getViewport('axial');
                  if (!viewport) return;
                  const handlesPoints = annotation.data?.handles?.points;
                  const textBoxPos = annotation.data?.handles?.textBox?.worldPosition;
                  const firstPoint = Array.isArray(handlesPoints) && handlesPoints.length > 0
                    ? [...handlesPoints[0]] as Types.Point3
                    : Array.isArray(textBoxPos)
                      ? [...textBoxPos] as Types.Point3
                      : null;

                  if (!firstPoint) return;

                  const camera = viewport.getCamera();
                  const { viewPlaneNormal, focalPoint } = camera;

                  const vectorToPoint = [
                    firstPoint[0] - focalPoint[0],
                    firstPoint[1] - focalPoint[1],
                    firstPoint[2] - focalPoint[2]
                  ];

                  const distanceToPlane = Math.abs(
                    vectorToPoint[0] * viewPlaneNormal[0] +
                    vectorToPoint[1] * viewPlaneNormal[1] +
                    vectorToPoint[2] * viewPlaneNormal[2]
                  );

                  const slabThickness = (viewport as any).getSlabThickness?.() || 0.1;
                  const visibilityThreshold = slabThickness / 2;

                  if (distanceToPlane <= visibilityThreshold) {
                    // This annotation is visible but doesn't have an overlay - create one
                    const cachedStats = annotation.data?.cachedStats;
                    const volumeIds = Object.keys(cachedStats || {});
                    if (volumeIds.length > 0) {
                      let stats = cachedStats[volumeIds[0]];


                      // Check if extended stats exist
                      const hasExtendedStats = stats['Long Axis'] !== undefined;

                      if (!hasExtendedStats) {
                        // Extended stats not calculated yet - calculate them now
                        const splinePoints = annotation.data?.spline?.points;

                        // If no spline points, the annotation might not be fully processed yet
                        if (!splinePoints || splinePoints.length < 3) {
                          // Try using contour polyline points instead
                          const polylinePoints = annotation.data?.contour?.polyline;
                          if (polylinePoints && polylinePoints.length >= 9) { // At least 3 points (x,y,z each)
                            // Convert flat array to point array
                            const points: [number, number, number][] = [];
                            for (let i = 0; i < polylinePoints.length; i += 3) {
                              points.push([polylinePoints[i], polylinePoints[i+1], polylinePoints[i+2]]);
                            }

                            try {
                              const area = stats.area || 0;

                              // Calculate perimeter from points
                              let perimeter = 0;
                              for (let i = 0; i < points.length; i++) {
                                const p1 = points[i];
                                const p2 = points[(i + 1) % points.length];
                                const dx = p2[0] - p1[0];
                                const dy = p2[1] - p1[1];
                                const dz = p2[2] - p1[2];
                                perimeter += Math.sqrt(dx * dx + dy * dy + dz * dz);
                              }

                              const axes = calculateSplineAxes(points, perimeter);
                              const areaDerivedDiameter = 2 * Math.sqrt(area / Math.PI);

                              // Store in cachedStats
                              annotation.data.cachedStats[volumeIds[0]] = {
                                ...stats,
                                perimeter: perimeter,
                                'Long Axis': axes.longAxisLength,
                                'Short Axis': axes.shortAxisLength,
                                'Perimeter Ø': axes.perimeterDerivedDiameter,
                                'Area Ø': areaDerivedDiameter,
                              };
                              stats = annotation.data.cachedStats[volumeIds[0]];
                            } catch (error) {
                              console.warn('Failed to calculate axes from polyline:', error);
                              return;
                            }
                          } else {
                            return; // No points available yet
                          }
                        } else {
                          // Use spline points
                          try {
                            const area = stats.area || 0;

                            // Calculate perimeter from spline points
                            let perimeter = 0;
                            for (let i = 0; i < splinePoints.length; i++) {
                              const p1 = splinePoints[i];
                              const p2 = splinePoints[(i + 1) % splinePoints.length];
                              const dx = p2[0] - p1[0];
                              const dy = p2[1] - p1[1];
                              const dz = p2[2] - p1[2];
                              perimeter += Math.sqrt(dx * dx + dy * dy + dz * dz);
                            }

                            const axes = calculateSplineAxes(splinePoints, perimeter);
                            const areaDerivedDiameter = 2 * Math.sqrt(area / Math.PI);

                            // Store in cachedStats
                            annotation.data.cachedStats[volumeIds[0]] = {
                              ...stats,
                              perimeter: perimeter,
                              'Long Axis': axes.longAxisLength,
                              'Short Axis': axes.shortAxisLength,
                              'Perimeter Ø': axes.perimeterDerivedDiameter,
                              'Area Ø': areaDerivedDiameter,
                            };
                            stats = annotation.data.cachedStats[volumeIds[0]];
                          } catch (error) {
                            console.warn('Failed to calculate axes from spline:', error);
                            return;
                          }
                        }
                      }

                      const textLines: string[] = [];
                      if (stats.area) textLines.push(`Area: ${stats.area.toFixed(2)} mm²`);
                      if (stats['Area Ø']) textLines.push(`Area Ø: ${stats['Area Ø'].toFixed(2)} mm`);
                      if (stats['Long Axis']) textLines.push(`Long: ${stats['Long Axis'].toFixed(2)} mm`);
                      if (stats['Short Axis']) textLines.push(`Short: ${stats['Short Axis'].toFixed(2)} mm`);
                      if (stats.perimeter) textLines.push(`Perim: ${stats.perimeter.toFixed(2)} mm`);
                      if (stats['Perimeter Ø']) textLines.push(`Perim Ø: ${stats['Perimeter Ø'].toFixed(2)} mm`);

                      const canvasPoint = viewport.worldToCanvas(firstPoint) as Types.Point2;
                      const customPos = annotation.metadata?.customTextPosition;
                      const userMoved = !!customPos?.userMoved;
                      const viewportElement = getViewportElementById(annotation.metadata?.viewportId || 'axial');
                      const displayPoint = canvasToDisplayPoint(viewport, viewportElement, canvasPoint);
                      const overlayX = userMoved && customPos ? customPos.x : displayPoint[0] + 10;
                      const overlayY = userMoved && customPos ? customPos.y : displayPoint[1] - 10;

                      updated.push({
                        uid: annotation.annotationUID,
                        x: overlayX,
                        y: overlayY,
                        lines: textLines,
                        viewportId: 'axial',
                        annotationUID: annotation.annotationUID,
                        userMoved,
                      });
                      processedUIDs.add(annotation.annotationUID);
                    }
                  }
                }
              });
            }
          } catch (error) {
            console.warn('Error checking for new overlays:', error);
          }

          return updated;
        });
      };

      // Listen for camera modified and stack viewport scroll events
      // Use the ref to get the axial element
      const axialElement = elementRefs.axial.current;

      // Store event listener reference for cleanup
      const cleanupOverlayListeners = () => {
        const axialEl = elementRefs.axial.current;
        if (axialEl) {
          axialEl.removeEventListener(Enums.Events.CAMERA_MODIFIED, updateOverlayPositions);
          axialEl.removeEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, updateOverlayPositions);
          axialEl.removeEventListener(Enums.Events.IMAGE_RENDERED, updateOverlayPositions);
          axialEl.removeEventListener('contextmenu', handleAnnotationContextMenu as any);
          axialEl.removeEventListener(csToolsEnums.Events.ANNOTATION_RENDERED, handleAnnotationRendered);
          document.removeEventListener('wheel', updateOverlayPositions);
        }

        // Remove context menu listeners from sagittal and coronal
        const sagittalEl = elementRefs.sagittal.current;
        if (sagittalEl) {
          sagittalEl.removeEventListener('contextmenu', handleAnnotationContextMenu as any);
        }

        const coronalEl = elementRefs.coronal.current;
        if (coronalEl) {
          coronalEl.removeEventListener('contextmenu', handleAnnotationContextMenu as any);
        }

        // Remove global annotation completed listener
        eventTarget.removeEventListener(csToolsEnums.Events.ANNOTATION_COMPLETED, annotationCompletedHandler);
      };

      // Handler to detect manual scrolling (wheel event) and temporarily disable auto-scroll
      const handleManualScroll = () => {
        // User is manually scrolling with mouse wheel - disable auto-scroll temporarily
        skipAutoScrollRef.current = true;
        console.log('🔒 Auto-scroll disabled (user scrolling)');

        // Clear any existing timeout
        if (autoScrollTimeoutRef.current) {
          clearTimeout(autoScrollTimeoutRef.current);
        }

        // Re-enable auto-scroll after 2 seconds of no scrolling
        autoScrollTimeoutRef.current = setTimeout(() => {
          skipAutoScrollRef.current = false;
          console.log('🔓 Auto-scroll re-enabled');
        }, 2000);
      };

      if (axialElement) {
        axialElement.addEventListener(Enums.Events.CAMERA_MODIFIED, updateOverlayPositions);
        axialElement.addEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, updateOverlayPositions);
        axialElement.addEventListener(Enums.Events.IMAGE_RENDERED, updateOverlayPositions);
        axialElement.addEventListener('contextmenu', handleAnnotationContextMenu as any);

        // Also listen for wheel events directly on the element
        axialElement.addEventListener('wheel', updateOverlayPositions, { passive: true });

        // Listen for wheel events to detect manual scrolling (only wheel, not CAMERA_MODIFIED)
        axialElement.addEventListener('wheel', handleManualScroll, { passive: true });

        console.log('  ✅ Overlay position updater and context menu registered for axial');
      }

      // Add context menu listeners to sagittal and coronal viewports for CPR line context menu
      const sagittalElement = elementRefs.sagittal.current;
      const coronalElement = elementRefs.coronal.current;

      if (sagittalElement) {
        sagittalElement.addEventListener('contextmenu', handleAnnotationContextMenu as any);
        console.log('  ✅ Context menu registered for sagittal');
      }

      if (coronalElement) {
        coronalElement.addEventListener('contextmenu', handleAnnotationContextMenu as any);
        console.log('  ✅ Context menu registered for coronal');
      }

      // Also set up an interval as a fallback to check visibility every 500ms
      overlayUpdateIntervalRef.current = window.setInterval(updateOverlayPositions, 500);

      console.log('  ✅ Overlay visibility checker running every 500ms');

      // CRITICAL: Activate default tool after setup based on stage
      if (currentStage === WorkflowStage.ROOT_DEFINITION) {
        console.log('🎯 Activating SphereMarker tool for ROOT_DEFINITION stage...');
        toolGroup.setToolActive(SphereMarkerTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });
        setActiveTool('SphereMarker');
        console.log('  ✅ SphereMarker tool activated');
      } else if (currentStage === WorkflowStage.MEASUREMENTS) {
        console.log('🎯 Setting up tools for MEASUREMENTS stage...');

        // For measurements stage, we want:
        // - Mouse wheel: scroll through slices
        // - Left click+drag with Shift: scroll through slices (StackScrollTool)
        // - Left click+drag: pan the image (PanTool)
        // - Right click+drag: zoom (ZoomTool)
        // - FixedCrosshairTool for rotation (like in ANNULUS_DEFINITION)

        // Ensure StackScrollTool is active for mouse wheel scrolling
        toolGroup.setToolActive(StackScrollTool.toolName, {
          bindings: [
            { mouseButton: MouseBindings.Wheel },
            // Add Shift+left drag for stack scrolling
            {
              mouseButton: MouseBindings.Primary,
              modifierKey: 'Shift'
            }
          ],
        });

        // DISABLED: Pan tool conflicts with FixedCrosshairTool rotation
        // Instead, use middle mouse button for panning or Shift+Primary
        // toolGroup.setToolActive(PanTool.toolName, {
        //   bindings: [{ mouseButton: MouseBindings.Primary }],
        // });

        // Zoom tool for right click drag
        toolGroup.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Secondary }],
        });

        // Window/Level on middle mouse button
        toolGroup.setToolActive(WindowLevelTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Auxiliary }],
        });

        // CRITICAL: Enable FixedCrosshairTool for rotation (like in ANNULUS_DEFINITION)
        // This allows crosshair rotation to update the other viewport cameras
        toolGroup.setToolActive(FixedCrosshairTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });

        setActiveTool('FixedCrosshair');
      }

      if (pendingToolRef.current) {
        handleToolChange(pendingToolRef.current);
      }
  };

  const handleToolChange = (toolName: string) => {
    try {
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (!toolGroup) {
        pendingToolRef.current = toolName;
        return;
      }

      // Always disable CrosshairsTool when switching to other tools (completely hide it)
      // We use FixedCrosshairTool for custom crosshairs instead
      toolGroup.setToolDisabled(CrosshairsTool.toolName);

      // Set other tools to passive first
      toolGroup.setToolPassive(ZoomTool.toolName);
      toolGroup.setToolPassive(PanTool.toolName);
      toolGroup.setToolPassive(SphereMarkerTool.toolName);
      toolGroup.setToolPassive(CuspNadirTool.toolName);
      toolGroup.setToolPassive(WindowLevelTool.toolName);
      toolGroup.setToolPassive(FixedCrosshairTool.toolName); // Also disable fixed crosshairs when switching tools
      toolGroup.setToolPassive('SmoothPolygon');
      toolGroup.setToolPassive('AxialLine');
      toolGroup.setToolPassive('MPRLongAxisLine');
      toolGroup.setToolPassive('AngleMeasurement');
      toolGroup.setToolPassive(LabelTool.toolName);
      toolGroup.setToolPassive(CurvedLeafletTool.toolName);
      toolGroup.setToolPassive(ProbeTool.toolName);
      toolGroup.setToolPassive(RectangleROITool.toolName);
      toolGroup.setToolPassive(CircleROITool.toolName);

      // Set measurement tool instances to enabled (not passive!)
      // Enabled = annotations are visible and interactive but tool is not actively drawing
      // Passive = annotations become invisible
      toolGroup.setToolEnabled('SmoothPolygon');
      toolGroup.setToolEnabled('AxialLine');
      toolGroup.setToolEnabled('MPRLongAxisLine');
      toolGroup.setToolEnabled('AngleMeasurement');
      toolGroup.setToolEnabled(LabelTool.toolName);
      toolGroup.setToolEnabled(CurvedLeafletTool.toolName);
      toolGroup.setToolEnabled(ProbeTool.toolName);
      toolGroup.setToolEnabled(RectangleROITool.toolName);
      toolGroup.setToolEnabled(CircleROITool.toolName);

      // Always keep these tools active with their default bindings
      toolGroup.setToolActive(StackScrollTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Wheel }],
      });
      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Secondary }],
      });

      // Activate selected tool
      if (toolName === 'SphereMarker') {
        console.log('🎯 Activating SphereMarker tool for dragging spheres');
        toolGroup.setToolActive(SphereMarkerTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });
      } else if (toolName === 'CuspNadir') {
        console.log('🎯 Activating CuspNadir tool');
        toolGroup.setToolActive(CuspNadirTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });
      } else if (toolName === 'Zoom') {
        toolGroup.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });
      } else if (toolName === 'Pan') {
        toolGroup.setToolActive(PanTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });
      } else if (toolName === 'Crosshairs') {
        // During annulus definition, crosshairs are fixed (non-interactive)
        // Don't allow switching to regular crosshairs
        if (currentStage === WorkflowStage.ANNULUS_DEFINITION) {
          console.log('⚠️ Crosshairs are locked during annulus definition');
          return; // Don't activate regular crosshairs
        }

        toolGroup.setToolActive(CrosshairsTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });
      } else if (toolName === 'WindowLevel') {
        toolGroup.setToolActive(WindowLevelTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });
      } else if (toolName === 'SmoothPolygon') {
        console.log('🎯 Activating SmoothPolygon tool (SplineROI)');
        // Activate on axial viewport - the tool is already configured with viewport filter
        // at tool registration (getViewportsForAnnotation) so it will only work on axial
        toolGroup.setToolActive('SmoothPolygon', {
          bindings: [
            { mouseButton: MouseBindings.Primary }  // Single clicks to add points
          ],
        });

        console.log('  ℹ️ Click to add points on AXIAL view only, click near first point to close polygon');
      } else if (toolName === 'AxialLine') {
        console.log('🎯 Activating AxialLine tool');
        toolGroup.setToolActive('AxialLine', {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });
      } else if (toolName === 'Angle') {
        console.log('🎯 Activating AngleMeasurement tool');
      toolGroup.setToolActive('AngleMeasurement', {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });
    } else if (toolName === 'Probe') {
      console.log('🎯 Activating Probe tool');
      toolGroup.setToolActive(ProbeTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });
    } else if (toolName === 'Label') {
      console.log('🎯 Activating Label tool');
      toolGroup.setToolActive(LabelTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });
    } else if (toolName === 'MPRLongAxisLine') {
      console.log('🎯 Activating MPRLongAxisLine tool');
      toolGroup.setToolActive('MPRLongAxisLine', {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });
    } else if (toolName === 'RectangleROI') {
      console.log('🎯 Activating Rectangle ROI tool');
      toolGroup.setToolActive(RectangleROITool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });
    } else if (toolName === 'CircleROI') {
      console.log('🎯 Activating Circle ROI tool');
      toolGroup.setToolActive(CircleROITool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });
    } else if (toolName === 'CurvedLeafletTool') {
      console.log('🎯 Activating CurvedLeafletTool for leaflet measurements');
      toolGroup.setToolActive(CurvedLeafletTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });
        console.log('  ℹ️ Click to add points on SAGITTAL/CORONAL views, creates open spline curve');
      }

      setActiveTool(toolName);
      pendingToolRef.current = null;
    } catch (error) {
      console.warn('Tool change error:', error);
    }
  };

  const handleClearSpheres = () => {
    try {
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (!toolGroup) return;
      
      const sphereTool = toolGroup.getToolInstance(SphereMarkerTool.toolName) as SphereMarkerTool;
      if (sphereTool) {
        sphereTool.clearAll();
        console.log('🧹 Cleared all spheres and connection lines');
      }
    } catch (error) {
      console.warn('Clear spheres error:', error);
    }
  };

  const handleClearCuspDots = () => {
    try {
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (!toolGroup) return;

      const cuspTool = toolGroup.getToolInstance(CuspNadirTool.toolName) as CuspNadirTool;
      if (cuspTool) {
        cuspTool.clearAll();
        console.log('🧹 Cleared all cusp nadir dots');
      }
    } catch (error) {
      console.warn('Clear cusp dots error:', error);
    }
  };

  // Workflow auto-activation: when currentWorkflowStep changes, auto-activate the appropriate tool
  useEffect(() => {
    if (!workflowControlled || !currentWorkflowStep) {
      console.log('⚠️ Workflow auto-activation skipped:', { workflowControlled, hasStep: !!currentWorkflowStep });
      return; // Only activate when workflow is in control
    }

    // Add a small delay to ensure tool group is ready
    const activationTimeout = setTimeout(() => {
      const workflowManager = getWorkflowManager();
      const toolName = workflowManager.getToolNameForStep(currentWorkflowStep);

      // Check if tool group exists
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (!toolGroup) {
        console.warn('Tool group not found for workflow step:', currentWorkflowStep.name);
        return;
      }

      handleToolChange(toolName);
    }, 100); // Small delay to ensure everything is initialized

    return () => clearTimeout(activationTimeout);
  }, [currentWorkflowStep, workflowControlled]);

  // Workflow auto-scroll: automatically scroll to the correct slice height for the current measurement step
  useEffect(() => {
    if (!workflowControlled || !currentWorkflowStep || !annularPlane || !renderingEngineRef.current) {
      return;
    }

    // Only auto-scroll if the step has changed (not already auto-scrolled to this step)
    if (lastAutoScrolledStepRef.current === currentWorkflowStep.id) {
      return;
    }

    // Skip if user is manually scrolling
    if (skipAutoScrollRef.current) {
      return;
    }

    // Calculate the offset from annulus based on the step configuration
    const workflowManager = getWorkflowManager();
    const offsetMm = workflowManager.calculateSliceOffset(currentWorkflowStep, annulusArea);

    // The annular plane normal points from LV towards ascending aorta
    // Positive offset = move UP (towards ascending aorta) = opposite to normal
    // Negative offset = move DOWN (towards LV outflow) = along the normal
    // So we NEGATE the offset to get correct direction
    const targetPosition: [number, number, number] = [
      annularPlane.center[0] - (annularPlane.normal[0] * offsetMm),
      annularPlane.center[1] - (annularPlane.normal[1] * offsetMm),
      annularPlane.center[2] - (annularPlane.normal[2] * offsetMm)
    ];

    // Update both the crosshair position AND viewport cameras to actually scroll the slices
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    if (toolGroup) {
      const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
      if (fixedCrosshairTool) {
        // Update crosshair position - this updates the yellow text
        fixedCrosshairTool.setFixedPosition(targetPosition, 'mprRenderingEngine');

        // Also update all viewport cameras to actually scroll to the new position
        const viewportIds = ['axial', 'sagittal', 'coronal'];
        viewportIds.forEach(viewportId => {
          const viewport = renderingEngineRef.current!.getViewport(viewportId) as Types.IVolumeViewport;
          if (viewport) {
            const camera = viewport.getCamera();
            viewport.setCamera({
              ...camera,
              focalPoint: targetPosition
            });
            viewport.render();
          }
        });

        // CRITICAL: Update currentCenterlineIndexRef to the new position
        // This ensures manual scrolling starts from the auto-scrolled position, not annulus
        if (centerlineDataRef.current) {
          const nearestIndex = findNearestCenterlineIndex(targetPosition);
          currentCenterlineIndexRef.current = nearestIndex;
        }

        // Mark this step as auto-scrolled
        lastAutoScrolledStepRef.current = currentWorkflowStep.id;
      }
    }
  }, [currentWorkflowStep, workflowControlled, annularPlane, annulusArea]);

  // Handle stage changes to lock/unlock tools and switch crosshair modes
  useEffect(() => {
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    if (!toolGroup) return;

    const sphereTool = toolGroup.getToolInstance(SphereMarkerTool.toolName) as SphereMarkerTool;
    const cuspTool = toolGroup.getToolInstance(CuspNadirTool.toolName) as CuspNadirTool;
    const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;

    if (currentStage === WorkflowStage.ANNULUS_DEFINITION) {
      // CRITICAL: Delete all measurement annotations when entering annulus definition
      console.log('🧹 Deleting all measurement annotations (entering annulus definition)');
      const allAnnotations = cornerstoneTools.annotation.state.getAllAnnotations();
      const measurementAnnotations = allAnnotations.filter((ann: any) =>
        ann?.metadata?.toolName === 'SmoothPolygon' ||
        ann?.metadata?.toolName === 'AxialLine' ||
        ann?.metadata?.toolName === 'MPRLongAxisLine'
      );

      const measurementAnnotationUIDs = new Set(measurementAnnotations.map((ann: any) => ann.annotationUID));

      measurementAnnotations.forEach((ann: any) => {
        cornerstoneTools.annotation.state.removeAnnotation(ann.annotationUID);
      });

      if (measurementAnnotations.length > 0) {
        console.log(`  ✅ Deleted ${measurementAnnotations.length} measurement annotations`);

        // CRITICAL: Clear ALL related UI state
        setAnnotationLabels({});  // Clear labels
        setAnnotationOverlays(prev =>
          prev.filter(overlay => !measurementAnnotationUIDs.has(overlay.annotationUID))
        );  // Clear text overlays

        // Force render to show deletions
        if (renderingEngineRef.current) {
          renderingEngineRef.current.renderViewports(['axial', 'sagittal', 'coronal']);
        }
      }

      // Allow sphere editing when explicitly selected, otherwise lock
      if (sphereTool && typeof sphereTool.setDraggable === 'function') {
        sphereTool.setDraggable(true); // Allow dragging if tool is selected
      }
      if (cuspTool) {
        cuspTool.setDraggable(true);
      }

      // Disable forceVisible - use normal slice-based visibility during annulus definition
      if (sphereTool && typeof sphereTool.setForceVisible === 'function') {
        sphereTool.setForceVisible(false);
      }
      if (cuspTool && typeof cuspTool.setForceVisible === 'function') {
        cuspTool.setForceVisible(false);
      }

      // During annulus definition, activate THREE tools: FixedCrosshairTool, CuspNadirTool, and SphereMarkerTool
      // CuspNadirTool will capture events when hovering over cusp dots
      // SphereMarkerTool will capture events when hovering over valve sphere
      // FixedCrosshairTool will handle rotation when not over any interactive element
      if (lockedFocalPointRef.current && fixedCrosshairTool) {
        console.log('🔄 Annulus Definition mode - Rotation, cusp dragging, and valve sphere dragging active');

        // Disable regular crosshairs
        toolGroup.setToolDisabled(CrosshairsTool.toolName);

        // Make non-primary tools passive
        toolGroup.setToolPassive(WindowLevelTool.toolName);

        // CRITICAL: Disable StackScrollTool during annulus definition
        // We handle scrolling manually to follow centerline
        toolGroup.setToolDisabled(StackScrollTool.toolName);
        console.log('🔇 StackScrollTool disabled for discrete scrolling');

        fixedCrosshairTool.setFixedPosition(lockedFocalPointRef.current, renderingEngineId);

        // CRITICAL: For ANNULUS_DEFINITION, always use MPR rotation (no CPR)
        // Clear any CPR callback that might have been set
        // IMPORTANT: Must clear BOTH the instance and static callback
        if (typeof fixedCrosshairTool.setCPRRotationCallback === 'function') {
          fixedCrosshairTool.setCPRRotationCallback(null);
          // Also clear the callback ref to ensure it's recreated fresh if needed
          cprRotationCallbackRef.current = null;
          console.log('  🔄 Using MPR rotation for ANNULUS_DEFINITION (CPR callback cleared completely)');
        }

        // Re-enable center dragging and disable distance measurement when going back to annulus definition
        if (typeof fixedCrosshairTool.setCenterDraggingDisabled === 'function') {
          fixedCrosshairTool.setCenterDraggingDisabled(false);
          console.log('  🔓 Center dragging re-enabled for ANNULUS_DEFINITION');
        }
        if (typeof fixedCrosshairTool.setAnnulusReference === 'function') {
          fixedCrosshairTool.setAnnulusReference(null);
          console.log('  📏 Distance measurement disabled for ANNULUS_DEFINITION');
        }

        // CRITICAL: Activate ALL THREE tools with same mouse button
        // Priority order (based on preMouseDownCallback return values):
        // 1. CuspNadirTool captures events when over a cusp dot
        // 2. SphereMarkerTool captures events when over valve sphere
        // 3. FixedCrosshairTool handles rotation when not over any interactive element
        toolGroup.setToolActive(CuspNadirTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });

        toolGroup.setToolActive(SphereMarkerTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });

        toolGroup.setToolActive(FixedCrosshairTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });

        // Set CuspNadir as the active tool in UI
        setActiveTool('CuspNadir');

        // Keep zoom active on right mouse button
        toolGroup.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Secondary }],
        });

        // Force render all viewports
        if (renderingEngineRef.current) {
          renderingEngineRef.current.renderViewports(['axial', 'sagittal', 'coronal']);
        }
      }

      console.log('🔓 Stage: Annulus Definition - Both cusp dragging and rotation active');
    } else if (currentStage === WorkflowStage.MEASUREMENTS) {
      // Lock all spheres and cusp dots (no dragging during measurements)
      if (sphereTool && typeof sphereTool.setDraggable === 'function') {
        sphereTool.setDraggable(false);
      }
      if (cuspTool) {
        cuspTool.setDraggable(false);
      }

      // Use normal slice-based visibility (same as annulus definition)
      // Annotations will show only when on or near the current slice
      if (sphereTool && typeof sphereTool.setForceVisible === 'function') {
        sphereTool.setForceVisible(false);
      }
      if (cuspTool && typeof cuspTool.setForceVisible === 'function') {
        cuspTool.setForceVisible(false);
      }

      // During measurements, only rotation is active
      // Scrolling is handled manually along centerline
      console.log('🔄 Measurements mode - Rotation active, scrolling along centerline');

      // CRITICAL: Disable regular CrosshairsTool FIRST to prevent conflicts
      toolGroup.setToolDisabled(CrosshairsTool.toolName);
      console.log('🔇 CrosshairsTool disabled (using FixedCrosshairTool instead)');

      // CRITICAL: Disable StackScrollTool during measurements
      // We handle scrolling manually along centerline
      toolGroup.setToolDisabled(StackScrollTool.toolName);
      console.log('🔇 StackScrollTool disabled for continuous centerline scrolling');

      // CRITICAL: Set the fixed position for the FixedCrosshairTool in measurements
      const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
      if (fixedCrosshairTool && lockedFocalPointRef.current) {
        fixedCrosshairTool.setFixedPosition(lockedFocalPointRef.current, renderingEngineId);
        console.log('🎯 Fixed crosshair position set for measurements at:', lockedFocalPointRef.current);
      } else {
        console.warn('⚠️ Unable to set fixed position:', {
          hasFixedCrosshairTool: !!fixedCrosshairTool,
          hasLockedFocalPoint: !!lockedFocalPointRef.current
        });
      }

      // Make non-primary tools passive
      toolGroup.setToolPassive(WindowLevelTool.toolName);

      // Keep cusp dots and spheres visible (slice-based) but not draggable
      // Setting tools to PASSIVE keeps them visible with slice-based visibility
      toolGroup.setToolPassive(CuspNadirTool.toolName);
      toolGroup.setToolPassive(SphereMarkerTool.toolName);
      console.log('✅ CuspNadirTool and SphereMarkerTool set to passive (slice-based visibility, not interactive)');

      // CRITICAL: Enable measurement tools so annotations remain visible
      // Enabled = annotations are visible and interactive but not actively drawing
      toolGroup.setToolEnabled('SmoothPolygon');
      toolGroup.setToolEnabled('AxialLine');
      toolGroup.setToolEnabled('MPRLongAxisLine');
      console.log('✅ Measurement tools enabled (annotations visible)');

      // CRITICAL: Force render to show all annotations when entering measurements
      setTimeout(() => {
        if (renderingEngineRef.current) {
          renderingEngineRef.current.renderViewports(['axial', 'sagittal', 'coronal']);
          console.log('  ✅ Forced render to show all measurement annotations');
        }
      }, 100);

      // NOTE: FixedCrosshairTool configuration (drag disable, distance measurement)
      // is handled by a dedicated useEffect that runs when entering MEASUREMENTS stage
      // See "Configure Tools for Measurements Stage" useEffect below

      // CRITICAL: Ensure correct zoom level (60) for measurements stage
      // This preserves the zoom from annulus definition stage
      if (renderingEngineRef.current) {
        const renderingEngine = renderingEngineRef.current;
        const viewportIds = ['axial', 'sagittal', 'coronal'];

        viewportIds.forEach(viewportId => {
          const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
          if (viewport) {
            const currentCamera = viewport.getCamera();
            // Only update if zoom is different from desired value
            if (Math.abs(currentCamera.parallelScale - savedCameraZoomRef.current) > 0.1) {
              viewport.setCamera({
                ...currentCamera,
                parallelScale: savedCameraZoomRef.current
              });
              console.log(`  🔍 Set ${viewportId} zoom to ${savedCameraZoomRef.current}`);
            }
          }
        });

        renderingEngine.renderViewports(viewportIds);
      }

      // Keep zoom active on right mouse button
      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Secondary }],
      });

      console.log('🔓 Stage: Measurements - Fixed crosshair active, cusp dots visible (locked)');
    } else {
      // Unlock sphere tool, lock cusp tool
      if (sphereTool && typeof sphereTool.setDraggable === 'function') {
        sphereTool.setDraggable(true);
      }
      if (cuspTool) {
        cuspTool.setDraggable(false);
      }

      // Disable forceVisible - use normal slice-based visibility during root definition
      if (sphereTool && typeof sphereTool.setForceVisible === 'function') {
        sphereTool.setForceVisible(false);
      }
      if (cuspTool && typeof cuspTool.setForceVisible === 'function') {
        cuspTool.setForceVisible(false);
      }

      // Switch back to interactive tools (sphere marker for placement/dragging)
      console.log('🔄 Switching to interactive mode - SphereMarker tool active for dragging');

      // CRITICAL: Disable ALL crosshair tools first
      if (fixedCrosshairTool) {
        toolGroup.setToolDisabled(FixedCrosshairTool.toolName);
        fixedCrosshairTool.clearFixedPosition();
      }
      toolGroup.setToolDisabled(CrosshairsTool.toolName);

      // Re-enable StackScrollTool for normal scrolling
      toolGroup.setToolActive(StackScrollTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Wheel }],
      });

      // CRITICAL: Activate SphereMarker tool for placing and dragging spheres
      toolGroup.setToolActive(SphereMarkerTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      // Auto-select Sphere tool in UI for Root Definition stage
      setActiveTool('SphereMarker');

      // Force render all viewports
      if (renderingEngineRef.current) {
        renderingEngineRef.current.renderViewports(['axial', 'sagittal', 'coronal']);
      }

      console.log('🔓 Stage: Root Definition - SphereMarker active, spheres draggable');
    }
  }, [currentStage]);

  const handleWindowLevelChange = (window: number, level: number) => {
    try {
      setWindowLevel({ window, level });

      // Apply window/level to all viewports
      const viewportIds = ["axial", "sagittal", "coronal"];
      const renderingEngine = renderingEngineRef.current || new RenderingEngine(renderingEngineId);

      viewportIds.forEach((id) => {
        try {
          const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
          if (viewport) {
            viewport.setProperties({
              voiRange: {
                lower: level - window / 2,
                upper: level + window / 2,
              },
            });
            viewport.render();
          }
        } catch (error) {
          console.warn(`Failed to set W/L for viewport ${id}:`, error);
        }
      });

      // Also update CPR actors if in CPR mode
      if (renderMode === 'cpr' && cprActorsRef.current.length > 0) {
        console.log('🎨 Updating CPR actors window/level:', { window, level });
        cprActorsRef.current.forEach(({ actor }) => {
          const property = actor.getProperty();
          property.setColorWindow(window);
          property.setColorLevel(level);
        });
        renderingEngine.renderViewports(viewportIds);
      }

      console.log(`📊 Applied W/L: Window=${window}, Level=${level}`);
    } catch (error) {
      console.warn('Window/Level error:', error);
    }
  };

  // Listen for VOI changes from WindowLevel tool and update state
  useEffect(() => {
    if (!renderingEngineRef.current) return;

    const handleVOIModified = (evt: any) => {
      // Don't update state if we're currently switching phases
      if (isSwitchingPhaseRef.current) {
        console.log('📊 Ignoring VOI event during phase switch');
        return;
      }

      const { viewportId, volumeId, range } = evt.detail;

      // Calculate window/level from VOI range
      const newWindow = Math.round(range.upper - range.lower);
      const newLevel = Math.round((range.upper + range.lower) / 2);

      // Update state to match current viewport settings
      setWindowLevel({ window: newWindow, level: newLevel });

      console.log(`📊 W/L changed by tool: Window=${newWindow}, Level=${newLevel}`);
    };

    const handleCameraModified = (evt: any) => {
      const { element, camera } = evt.detail;

      // If we're NOT switching phases, this is a user interaction - save it
      if (!isSwitchingPhaseRef.current && element && camera) {
        const viewportId = element.viewportId || element.getAttribute?.('data-viewport-uid');
        if (viewportId) {
          // Update the saved camera state so phase switching uses the new position
          savedCameraStatesRef.current[viewportId] = camera;
        }
      }
    };

    // Listen for events
    document.addEventListener('CORNERSTONE_VOI_MODIFIED', handleVOIModified);
    document.addEventListener('CORNERSTONE_CAMERA_MODIFIED', handleCameraModified);

    return () => {
      document.removeEventListener('CORNERSTONE_VOI_MODIFIED', handleVOIModified);
      document.removeEventListener('CORNERSTONE_CAMERA_MODIFIED', handleCameraModified);
    };
  }, [renderingEngineRef.current]);

  // ============================================================================
  // Centerline Helper Functions for Measurements Stage Scrolling
  // ============================================================================

  /**
   * Get 3D position at a specific centerline index
   */
  const getCenterlinePositionAtIndex = (index: number): Types.Point3 | null => {
    if (!centerlineDataRef.current || !centerlineDataRef.current.position) {
      return null;
    }

    const numPoints = centerlineDataRef.current.position.length / 3;
    if (index < 0 || index >= numPoints) {
      return null;
    }

    // Support fractional indices with linear interpolation
    const lowerIndex = Math.floor(index);
    const upperIndex = Math.min(lowerIndex + 1, numPoints - 1);
    const fraction = index - lowerIndex;

    const lowerPos = [
      centerlineDataRef.current.position[lowerIndex * 3],
      centerlineDataRef.current.position[lowerIndex * 3 + 1],
      centerlineDataRef.current.position[lowerIndex * 3 + 2]
    ];

    const upperPos = [
      centerlineDataRef.current.position[upperIndex * 3],
      centerlineDataRef.current.position[upperIndex * 3 + 1],
      centerlineDataRef.current.position[upperIndex * 3 + 2]
    ];

    // Linear interpolation
    return [
      lowerPos[0] + (upperPos[0] - lowerPos[0]) * fraction,
      lowerPos[1] + (upperPos[1] - lowerPos[1]) * fraction,
      lowerPos[2] + (upperPos[2] - lowerPos[2]) * fraction
    ] as Types.Point3;
  };

  /**
   * Get tangent vector at a specific centerline index (direction along the path)
   */
  const getCenterlineTangentAtIndex = (index: number): Types.Point3 | null => {
    if (!centerlineDataRef.current || !centerlineDataRef.current.position) {
      return null;
    }

    const numPoints = centerlineDataRef.current.position.length / 3;
    if (index < 0 || index >= numPoints) {
      return null;
    }

    // Calculate tangent from adjacent points (works for fractional indices too)
    const baseIndex = Math.floor(index);
    let prevIndex = Math.max(0, baseIndex - 1);
    let nextIndex = Math.min(numPoints - 1, baseIndex + 1);

    const prevPos = [
      centerlineDataRef.current.position[prevIndex * 3],
      centerlineDataRef.current.position[prevIndex * 3 + 1],
      centerlineDataRef.current.position[prevIndex * 3 + 2]
    ];

    const nextPos = [
      centerlineDataRef.current.position[nextIndex * 3],
      centerlineDataRef.current.position[nextIndex * 3 + 1],
      centerlineDataRef.current.position[nextIndex * 3 + 2]
    ];

    // Tangent is direction from prev to next
    const tangent = [
      nextPos[0] - prevPos[0],
      nextPos[1] - prevPos[1],
      nextPos[2] - prevPos[2]
    ];

    // Normalize
    const length = Math.sqrt(tangent[0] ** 2 + tangent[1] ** 2 + tangent[2] ** 2);
    if (length === 0) {
      return [0, 0, 1] as Types.Point3; // Default fallback
    }

    return [
      tangent[0] / length,
      tangent[1] / length,
      tangent[2] / length
    ] as Types.Point3;
  };

  /**
   * Find the nearest centerline index to a given world position
   */
  const findNearestCenterlineIndex = (worldPos: Types.Point3): number => {
    if (!centerlineDataRef.current || !centerlineDataRef.current.position) {
      return 0;
    }

    const numPoints = centerlineDataRef.current.position.length / 3;
    let minDistance = Infinity;
    let nearestIndex = 0;

    for (let i = 0; i < numPoints; i++) {
      const pos = getCenterlinePositionAtIndex(i);
      if (!pos) continue;

      const distance = Math.sqrt(
        (pos[0] - worldPos[0]) ** 2 +
        (pos[1] - worldPos[1]) ** 2 +
        (pos[2] - worldPos[2]) ** 2
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestIndex = i;
      }
    }

    return nearestIndex;
  };

  // ============================================================================
  // Continuous Centerline Scrolling for Annulus Definition Stage
  // ============================================================================

  // Handle continuous centerline scrolling during annulus definition (same as measurements)
  useEffect(() => {
    if (currentStage !== WorkflowStage.ANNULUS_DEFINITION ||
        !centerlineDataRef.current ||
        !renderingEngineRef.current ||
        renderMode === 'cpr') {  // Skip scroll handler in CPR mode
      return;
    }

    const renderingEngine = renderingEngineRef.current;
    const numCenterlinePoints = centerlineDataRef.current.position.length / 3;

    // Initialize centerline index if needed
    if (currentCenterlineIndexRef.current === 0 && lockedFocalPointRef.current) {
      const nearestIndex = findNearestCenterlineIndex(lockedFocalPointRef.current);
      currentCenterlineIndexRef.current = nearestIndex;
      console.log(`📍 Initialized centerline index to ${nearestIndex} for annulus definition`);
    }

    // Get axial viewport element
    const axialViewport = renderingEngine.getViewport('axial');
    if (!axialViewport || !axialViewport.element) {
      return;
    }

    const axialElement = axialViewport.element;

    const handleWheel = (evt: WheelEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();

      // Use fractional scrolling for ultra-smooth navigation
      const scrollDirection = evt.deltaY > 0 ? 1 : -1;
      const fractionalStep = cprScrollStepSizeRef.current * scrollDirection;

      // Accumulate fractional position
      const newIndex = currentCenterlineIndexRef.current + fractionalStep;
      const clampedIndex = Math.max(0, Math.min(numCenterlinePoints - 1, newIndex));

      if (clampedIndex === currentCenterlineIndexRef.current) {
        return; // Already at boundary
      }

      currentCenterlineIndexRef.current = clampedIndex;

      // Get position and tangent at new centerline index (fractional supported)
      const newPosition = getCenterlinePositionAtIndex(clampedIndex);
      const tangent = getCenterlineTangentAtIndex(clampedIndex);

      if (!newPosition || !tangent) {
        console.warn('Failed to get centerline position or tangent at index', clampedIndex);
        return;
      }

      // Update axial viewport - position camera perpendicular to centerline
      const axialVp = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
      if (!axialVp) return;

      const camera = axialVp.getCamera();
      const cameraDistance = 200;

      // Position camera along the tangent (perpendicular to axial slice)
      const newCameraPos = [
        newPosition[0] + tangent[0] * cameraDistance,
        newPosition[1] + tangent[1] * cameraDistance,
        newPosition[2] + tangent[2] * cameraDistance
      ] as Types.Point3;

      // Calculate viewUp perpendicular to tangent
      let viewUp: Types.Point3;
      const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const cross = [
        tangent[1] * reference[2] - tangent[2] * reference[1],
        tangent[2] * reference[0] - tangent[0] * reference[2],
        tangent[0] * reference[1] - tangent[1] * reference[0]
      ];

      const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
      if (crossLen > 0) {
        viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
      } else {
        viewUp = [0, 0, 1] as Types.Point3;
      }

      axialVp.setCamera({
        position: newCameraPos,
        focalPoint: newPosition,
        viewUp: viewUp,
        parallelScale: camera.parallelScale,
      });

      axialVp.render();

      // Update fixed crosshair position
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      const fixedCrosshairTool = toolGroup?.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
      if (fixedCrosshairTool) {
        fixedCrosshairTool.setFixedPosition(newPosition, renderingEngineId);
      }

      // Update sagittal and coronal viewports with new screen-space directions
      const newCamera = axialVp.getCamera();
      const viewPlaneNormal = newCamera.viewPlaneNormal;
      const actualViewUp = newCamera.viewUp;

      // Calculate actualViewRight
      const actualViewRight = [
        actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
        actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
        actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
      ];

      const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
      if (rightLen > 0) {
        actualViewRight[0] /= rightLen;
        actualViewRight[1] /= rightLen;
        actualViewRight[2] /= rightLen;
      }

      // Apply rotation if any
      const rotationAngle = fixedCrosshairTool?.getRotationAngle() || 0;
      const cos = Math.cos(rotationAngle);
      const sin = Math.sin(rotationAngle);

      const rotatedViewRight = [
        actualViewRight[0] * cos - actualViewUp[0] * sin,
        actualViewRight[1] * cos - actualViewUp[1] * sin,
        actualViewRight[2] * cos - actualViewUp[2] * sin
      ];

      const rotatedViewUp = [
        actualViewRight[0] * sin + actualViewUp[0] * cos,
        actualViewRight[1] * sin + actualViewUp[1] * cos,
        actualViewRight[2] * sin + actualViewUp[2] * cos
      ];

      // Update sagittal
      const sagittalVp = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
      if (sagittalVp) {
        const sagCameraPos = [
          newPosition[0] + rotatedViewRight[0] * cameraDistance,
          newPosition[1] + rotatedViewRight[1] * cameraDistance,
          newPosition[2] + rotatedViewRight[2] * cameraDistance
        ] as Types.Point3;

        sagittalVp.setCamera({
          position: sagCameraPos,
          focalPoint: newPosition,
          viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
          parallelScale: sagittalVp.getCamera().parallelScale
        });

        sagittalVp.render();
      }

      // Update coronal
      const coronalVp = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
      if (coronalVp) {
        const corCameraPos = [
          newPosition[0] + rotatedViewUp[0] * cameraDistance,
          newPosition[1] + rotatedViewUp[1] * cameraDistance,
          newPosition[2] + rotatedViewUp[2] * cameraDistance
        ] as Types.Point3;

        coronalVp.setCamera({
          position: corCameraPos,
          focalPoint: newPosition,
          viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
          parallelScale: coronalVp.getCamera().parallelScale
        });

        coronalVp.render();
      }

      // CRITICAL: Manually trigger visibility updates for sphere and cusp tools
      // Since we're capturing the wheel event, the tools' visibility listeners don't run
      const tGroup = ToolGroupManager.getToolGroup(toolGroupId);
      const sphereToolInstance = tGroup?.getToolInstance(SphereMarkerTool.toolName) as SphereMarkerTool;
      const cuspToolInstance = tGroup?.getToolInstance(CuspNadirTool.toolName) as CuspNadirTool;

      if (sphereToolInstance && typeof sphereToolInstance.updateVisibilityForSingleViewport === 'function') {
        if (axialVp) sphereToolInstance.updateVisibilityForSingleViewport(axialVp, 0);
        if (sagittalVp) sphereToolInstance.updateVisibilityForSingleViewport(sagittalVp, 1);
        if (coronalVp) sphereToolInstance.updateVisibilityForSingleViewport(coronalVp, 2);
      }

      if (cuspToolInstance && typeof cuspToolInstance.updateVisibilityForSingleViewport === 'function') {
        if (axialVp) cuspToolInstance.updateVisibilityForSingleViewport(axialVp, 0);
        if (sagittalVp) cuspToolInstance.updateVisibilityForSingleViewport(sagittalVp, 1);
        if (coronalVp) cuspToolInstance.updateVisibilityForSingleViewport(coronalVp, 2);
      }

    };

    // Add event listener with capture=true to intercept BEFORE Cornerstone's handlers
    console.log('🔧 Setting up continuous centerline scroll handler on axial viewport (annulus definition)');
    console.log('   Number of centerline points:', numCenterlinePoints);
    console.log('   Starting at centerline index:', currentCenterlineIndexRef.current);

    axialElement.addEventListener('wheel', handleWheel, { passive: false, capture: true });

    return () => {
      console.log('🧹 Removing continuous centerline scroll handler (annulus definition)');
      axialElement.removeEventListener('wheel', handleWheel, { capture: true });
    };
  }, [currentStage, renderingEngineRef.current, centerlineDataRef.current, renderMode]);

  // ============================================================================
  // Continuous Centerline Scrolling for Measurements Stage
  // ============================================================================

  // Handle continuous scrolling along centerline during measurements stage
  useEffect(() => {
    if (currentStage !== WorkflowStage.MEASUREMENTS ||
        !centerlineDataRef.current ||
        !renderingEngineRef.current ||
        !lockedFocalPointRef.current ||
        renderMode === 'cpr') {  // Skip scroll handler in CPR mode
      return;
    }

    const renderingEngine = renderingEngineRef.current;
    const axialViewport = renderingEngine.getViewport('axial') as Types.IVolumeViewport;

    if (!axialViewport || !axialViewport.element) {
      return;
    }

    const axialElement = axialViewport.element;
    const numCenterlinePoints = centerlineDataRef.current.position.length / 3;

    // Don't auto-initialize to annulus - let workflow auto-scroll handle initial positioning
    // The auto-scroll will set the correct position based on the workflow step
    // if (currentCenterlineIndexRef.current === 0 && lockedFocalPointRef.current) {
    //   const nearestIndex = findNearestCenterlineIndex(lockedFocalPointRef.current);
    //   currentCenterlineIndexRef.current = nearestIndex;
    //   console.log(`📍 Initialized centerline index to ${nearestIndex} (nearest to annulus center)`);
    // }

    const handleWheel = (evt: WheelEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();

      // CRITICAL: Disable auto-scroll immediately when user manually scrolls
      skipAutoScrollRef.current = true;
      if (autoScrollTimeoutRef.current) {
        clearTimeout(autoScrollTimeoutRef.current);
      }
      autoScrollTimeoutRef.current = setTimeout(() => {
        skipAutoScrollRef.current = false;
      }, 2000);

      // Use fractional scrolling for ultra-smooth navigation
      const scrollDirection = evt.deltaY > 0 ? 1 : -1;
      const fractionalStep = cprScrollStepSizeRef.current * scrollDirection;

      // Accumulate fractional position
      const newIndex = currentCenterlineIndexRef.current + fractionalStep;
      const clampedIndex = Math.max(0, Math.min(numCenterlinePoints - 1, newIndex));

      if (clampedIndex === currentCenterlineIndexRef.current) {
        return; // Already at boundary
      }

      currentCenterlineIndexRef.current = clampedIndex;

      // Get position and tangent at new centerline index (fractional supported)
      const newPosition = getCenterlinePositionAtIndex(clampedIndex);
      const tangent = getCenterlineTangentAtIndex(clampedIndex);

      if (!newPosition || !tangent) {
        console.warn('Failed to get centerline position or tangent at index', clampedIndex);
        return;
      }

      // Update axial viewport - position camera perpendicular to centerline
      const axialVp = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
      if (!axialVp) return;

      const camera = axialVp.getCamera();
      const cameraDistance = 200;

      // Position camera along the tangent (perpendicular to axial slice)
      const newCameraPos = [
        newPosition[0] + tangent[0] * cameraDistance,
        newPosition[1] + tangent[1] * cameraDistance,
        newPosition[2] + tangent[2] * cameraDistance
      ] as Types.Point3;

      // Calculate viewUp perpendicular to tangent
      let viewUp: Types.Point3;
      const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const cross = [
        tangent[1] * reference[2] - tangent[2] * reference[1],
        tangent[2] * reference[0] - tangent[0] * reference[2],
        tangent[0] * reference[1] - tangent[1] * reference[0]
      ];

      const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
      if (crossLen > 0) {
        viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
      } else {
        viewUp = [0, 0, 1] as Types.Point3;
      }

      axialVp.setCamera({
        position: newCameraPos,
        focalPoint: newPosition,
        viewUp: viewUp,
        parallelScale: camera.parallelScale,
      });

      axialVp.render();

      // Update fixed crosshair position
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      const fixedCrosshairTool = toolGroup?.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
      if (fixedCrosshairTool) {
        fixedCrosshairTool.setFixedPosition(newPosition, renderingEngineId);
      }

      // Update sagittal and coronal viewports with new screen-space directions
      const newCamera = axialVp.getCamera();
      const viewPlaneNormal = newCamera.viewPlaneNormal;
      const actualViewUp = newCamera.viewUp;

      // Calculate actualViewRight
      const actualViewRight = [
        actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
        actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
        actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
      ];

      const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
      if (rightLen > 0) {
        actualViewRight[0] /= rightLen;
        actualViewRight[1] /= rightLen;
        actualViewRight[2] /= rightLen;
      }

      // Apply rotation if any (preserve user's rotation angle)
      const rotationAngle = fixedCrosshairTool?.getRotationAngle() || 0;
      const cos = Math.cos(rotationAngle);
      const sin = Math.sin(rotationAngle);

      const rotatedViewRight = [
        actualViewRight[0] * cos - actualViewUp[0] * sin,
        actualViewRight[1] * cos - actualViewUp[1] * sin,
        actualViewRight[2] * cos - actualViewUp[2] * sin
      ];

      const rotatedViewUp = [
        actualViewRight[0] * sin + actualViewUp[0] * cos,
        actualViewRight[1] * sin + actualViewUp[1] * cos,
        actualViewRight[2] * sin + actualViewUp[2] * cos
      ];

      // Update sagittal viewport
      const sagittalVp = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
      if (sagittalVp) {
        const sagCameraPos = [
          newPosition[0] + rotatedViewRight[0] * cameraDistance,
          newPosition[1] + rotatedViewRight[1] * cameraDistance,
          newPosition[2] + rotatedViewRight[2] * cameraDistance
        ] as Types.Point3;

        sagittalVp.setCamera({
          position: sagCameraPos,
          focalPoint: newPosition,
          viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
          parallelScale: sagittalVp.getCamera().parallelScale
        });

        sagittalVp.render();
      }

      // Update coronal viewport
      const coronalVp = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
      if (coronalVp) {
        const corCameraPos = [
          newPosition[0] + rotatedViewUp[0] * cameraDistance,
          newPosition[1] + rotatedViewUp[1] * cameraDistance,
          newPosition[2] + rotatedViewUp[2] * cameraDistance
        ] as Types.Point3;

        coronalVp.setCamera({
          position: corCameraPos,
          focalPoint: newPosition,
          viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
          parallelScale: coronalVp.getCamera().parallelScale
        });

        coronalVp.render();
      }

      // CRITICAL: Manually trigger visibility updates for sphere and cusp tools
      // Since we're capturing the wheel event, the tools' visibility listeners don't run
      const tGroup = ToolGroupManager.getToolGroup(toolGroupId);
      const sphereToolInstance = tGroup?.getToolInstance(SphereMarkerTool.toolName) as SphereMarkerTool;
      const cuspToolInstance = tGroup?.getToolInstance(CuspNadirTool.toolName) as CuspNadirTool;

      if (sphereToolInstance && typeof sphereToolInstance.updateVisibilityForSingleViewport === 'function') {
        if (axialVp) sphereToolInstance.updateVisibilityForSingleViewport(axialVp, 0);
        if (sagittalVp) sphereToolInstance.updateVisibilityForSingleViewport(sagittalVp, 1);
        if (coronalVp) sphereToolInstance.updateVisibilityForSingleViewport(coronalVp, 2);
      }

      if (cuspToolInstance && typeof cuspToolInstance.updateVisibilityForSingleViewport === 'function') {
        if (axialVp) cuspToolInstance.updateVisibilityForSingleViewport(axialVp, 0);
        if (sagittalVp) cuspToolInstance.updateVisibilityForSingleViewport(sagittalVp, 1);
        if (coronalVp) cuspToolInstance.updateVisibilityForSingleViewport(coronalVp, 2);
      }

    };

    // Add event listener with capture=true to intercept BEFORE Cornerstone's handlers
    console.log('🔧 Setting up continuous centerline scroll handler on axial viewport');
    console.log('   Number of centerline points:', numCenterlinePoints);
    console.log('   Starting at centerline index:', currentCenterlineIndexRef.current);

    axialElement.addEventListener('wheel', handleWheel, { passive: false, capture: true });

    return () => {
      console.log('🧹 Removing continuous centerline scroll handler');
      axialElement.removeEventListener('wheel', handleWheel, { capture: true });
    };
  }, [currentStage, renderingEngineRef.current, centerlineDataRef.current, lockedFocalPointRef.current, renderMode]);

  // ============================================================================
  // CPR Mode Scroll Handler - Updates only axial cross-section
  // ============================================================================

  useEffect(() => {
    // Only enable in CPR mode with centerline data
    if (renderMode !== 'cpr' ||
        !centerlineDataRef.current ||
        !renderingEngineRef.current) {
      return;
    }

    const renderingEngine = renderingEngineRef.current;
    const numCenterlinePoints = centerlineDataRef.current.position.length / 3;

    let axialElement: HTMLElement | null = null;

    const handleWheel = (evt: WheelEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();

      // Use fractional scrolling for ultra-smooth navigation
      // Step size of 0.1 index units = ~0.024mm with 500 points over 120mm
      const scrollDirection = evt.deltaY > 0 ? 1 : -1;
      const fractionalStep = cprScrollStepSizeRef.current * scrollDirection;

      // Accumulate fractional position
      const newIndex = currentCenterlineIndexRef.current + fractionalStep;

      // Clamp to bounds
      const clampedIndex = Math.max(0, Math.min(numCenterlinePoints - 1, newIndex));

      if (clampedIndex === currentCenterlineIndexRef.current) {
        return; // Already at boundary
      }

      currentCenterlineIndexRef.current = clampedIndex;

      // Get position and tangent at new centerline index (fractional index supported)
      const newPosition = getCenterlinePositionAtIndex(clampedIndex);
      const tangent = getCenterlineTangentAtIndex(clampedIndex);

      if (!newPosition || !tangent) {
        console.warn('⚠️ Failed to get centerline position or tangent at index', clampedIndex);
        return;
      }

      console.log(`📜 CPR scroll to centerline index ${clampedIndex.toFixed(2)}/${numCenterlinePoints - 1}`);

      // Update ONLY the axial viewport (cross-section)
      // Sagittal and coronal CPR views stay STATIC showing the full straightened vessel
      const axialVp = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
      if (!axialVp) return;

      const cameraDistance = 200;

      // Position camera along the tangent (perpendicular to axial slice)
      const newCameraPos = [
        newPosition[0] + tangent[0] * cameraDistance,
        newPosition[1] + tangent[1] * cameraDistance,
        newPosition[2] + tangent[2] * cameraDistance
      ] as Types.Point3;

      // Calculate viewUp perpendicular to tangent
      let viewUp: Types.Point3;
      const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const cross = [
        tangent[1] * reference[2] - tangent[2] * reference[1],
        tangent[2] * reference[0] - tangent[0] * reference[2],
        tangent[0] * reference[1] - tangent[1] * reference[0]
      ];

      const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
      if (crossLen > 0) {
        viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
      } else {
        viewUp = [0, 0, 1] as Types.Point3;
      }

      axialVp.setCamera({
        position: newCameraPos,
        focalPoint: newPosition,
        viewUp: viewUp,
        parallelScale: axialVp.getCamera().parallelScale,
      });

      axialVp.render();

      // Update fixed crosshair position
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      const fixedCrosshairTool = toolGroup?.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
      if (fixedCrosshairTool) {
        fixedCrosshairTool.setFixedPosition(newPosition, renderingEngineId);
      }

      // Manually trigger visibility updates for sphere and cusp tools
      const tGroup = ToolGroupManager.getToolGroup(toolGroupId);
      const sphereToolInstance = tGroup?.getToolInstance(SphereMarkerTool.toolName) as SphereMarkerTool;
      const cuspToolInstance = tGroup?.getToolInstance(CuspNadirTool.toolName) as CuspNadirTool;

      if (sphereToolInstance && typeof sphereToolInstance.updateVisibilityForSingleViewport === 'function') {
        sphereToolInstance.updateVisibilityForSingleViewport(axialVp, 0);
      }

      if (cuspToolInstance && typeof cuspToolInstance.updateVisibilityForSingleViewport === 'function') {
        cuspToolInstance.updateVisibilityForSingleViewport(axialVp, 0);
      }

      // Update CPR position indicator lines on sagittal/coronal views
      updateCPRPositionLines(clampedIndex);

      console.log('✅ Axial cross-section updated to centerline position', clampedIndex.toFixed(2));
      console.log('   (Sagittal/Coronal CPR views remain static)');
    };

    // Access axial viewport element directly from ref
    const setupTimeout = setTimeout(() => {
      axialElement = elementRefs.axial.current;

      if (!axialElement) {
        console.warn('⚠️ Axial viewport element ref is null');
        return;
      }

      console.log('🔧 Setting up CPR mode scroll handler (axial cross-section only)');
      console.log('   Number of centerline points:', numCenterlinePoints);
      console.log('   Starting at centerline index:', currentCenterlineIndexRef.current);

      // Add event listener with capture=true to intercept BEFORE Cornerstone's handlers
      axialElement.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    }, 600); // 600ms delay to ensure viewports are initialized

    return () => {
      clearTimeout(setupTimeout);
      if (axialElement) {
        console.log('🧹 Removing CPR mode scroll handler');
        axialElement.removeEventListener('wheel', handleWheel, { capture: true });
      }
    };
  }, [renderMode, renderingEngineRef.current, centerlineDataRef.current]);

  // ============================================================================
  // Drag Horizontal Line to Scroll (CPR Mode)
  // ============================================================================

  useEffect(() => {
    // Only enable in CPR mode
    if (renderMode !== 'cpr' || !renderingEngineRef.current || !centerlineDataRef.current) {
      return;
    }

    const renderingEngine = renderingEngineRef.current;
    const numCenterlinePoints = centerlineDataRef.current.position.length / 3;

    let isDragging = false;
    let dragStartY = 0;
    let dragStartIndex = 0;

    const handleMouseDown = (evt: MouseEvent, viewportId: string) => {
      const viewport = renderingEngine.getViewport(viewportId);
      if (!viewport) {
        console.log('⚠️ No viewport for', viewportId);
        return;
      }

      const canvas = viewport.getCanvas() as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const mouseY = evt.clientY - rect.top;

      // Check if mouse is near the horizontal line
      const positionRatio = cprPositionRatioRef.current;
      // IMPORTANT: Use rect.height (displayed size) not canvas.height (internal resolution)
      const lineY = positionRatio * rect.height;
      const hitDistance = 30; // 30 pixels hit area (increased for easier interaction)
      const distance = Math.abs(mouseY - lineY);

      if (distance < hitDistance) {
        isDragging = true;
        dragStartY = mouseY;
        dragStartIndex = currentCenterlineIndexRef.current;
        evt.preventDefault();
        evt.stopPropagation();
        evt.stopImmediatePropagation();
        canvas.style.cursor = 'ns-resize';
      }
    };

    const handleMouseMove = (evt: MouseEvent, viewportId: string) => {
      if (!isDragging) {
        // Update cursor when hovering near line
        const viewport = renderingEngine.getViewport(viewportId);
        if (!viewport) return;
        const canvas = viewport.getCanvas() as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        const mouseY = evt.clientY - rect.top;
        const positionRatio = cprPositionRatioRef.current;

        // IMPORTANT: Use rect.height (displayed size) not canvas.height (internal resolution)
        // Canvas might have 2x or 3x resolution due to device pixel ratio
        const lineY = positionRatio * rect.height;
        const hitDistance = 30; // 30 pixels hit area (increased for easier interaction)
        const distance = Math.abs(mouseY - lineY);

        if (distance < hitDistance) {
          if (canvas.style.cursor !== 'ns-resize') {
            canvas.style.cursor = 'ns-resize';
            canvas.style.setProperty('cursor', 'ns-resize', 'important');
          }
        } else {
          if (canvas.style.cursor === 'ns-resize') {
            canvas.style.cursor = '';
            canvas.style.removeProperty('cursor');
          }
        }
        return;
      }

      const viewport = renderingEngine.getViewport(viewportId);
      if (!viewport) return;
      const canvas = viewport.getCanvas() as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const mouseY = evt.clientY - rect.top;

      // Calculate delta in pixels, convert to centerline index
      const deltaY = mouseY - dragStartY;

      // Get total centerline length
      const positions = centerlineDataRef.current.position;
      let totalLength = 0;
      for (let i = 1; i < numCenterlinePoints; i++) {
        const dx = positions[i * 3] - positions[(i - 1) * 3];
        const dy = positions[i * 3 + 1] - positions[(i - 1) * 3 + 1];
        const dz = positions[i * 3 + 2] - positions[(i - 1) * 3 + 2];
        totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }

      // Convert pixel delta to mm, then to index delta
      // IMPORTANT: Use rect.height (displayed size) not canvas.height
      const deltaRatio = deltaY / rect.height;
      const deltaMM = deltaRatio * totalLength;
      const avgSegmentLength = totalLength / (numCenterlinePoints - 1);
      const deltaIndex = deltaMM / avgSegmentLength;

      const newIndex = Math.max(0, Math.min(numCenterlinePoints - 1, dragStartIndex + deltaIndex));

      if (newIndex !== currentCenterlineIndexRef.current) {
        currentCenterlineIndexRef.current = newIndex;

        // Update axial viewport
        const newPosition = getCenterlinePositionAtIndex(newIndex);
        const tangent = getCenterlineTangentAtIndex(newIndex);

        if (newPosition && tangent) {
          const axialVp = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
          if (axialVp) {
            const cameraDistance = 200;
            const newCameraPos = [
              newPosition[0] + tangent[0] * cameraDistance,
              newPosition[1] + tangent[1] * cameraDistance,
              newPosition[2] + tangent[2] * cameraDistance
            ] as Types.Point3;

            let viewUp: Types.Point3;
            const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
            const cross = [
              tangent[1] * reference[2] - tangent[2] * reference[1],
              tangent[2] * reference[0] - tangent[0] * reference[2],
              tangent[0] * reference[1] - tangent[1] * reference[0]
            ];
            const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
            if (crossLen > 0) {
              viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
            } else {
              viewUp = [0, 0, 1] as Types.Point3;
            }

            axialVp.setCamera({
              position: newCameraPos,
              focalPoint: newPosition,
              viewUp: viewUp,
              parallelScale: axialVp.getCamera().parallelScale,
            });
            axialVp.render();

            // Update crosshair position
            const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
            const fixedCrosshairTool = toolGroup?.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
            if (fixedCrosshairTool) {
              fixedCrosshairTool.setFixedPosition(newPosition, renderingEngineId);
            }

            // Update CPR position lines
            updateCPRPositionLines(newIndex);
          }
        }
      }

      evt.preventDefault();
      evt.stopPropagation();
    };

    const handleMouseUp = (evt: MouseEvent) => {
      if (isDragging) {
        isDragging = false;

        // Reset cursor for all CPR canvases
        ['sagittal', 'coronal'].forEach(vpId => {
          const vp = renderingEngine.getViewport(vpId);
          if (vp) {
            const canvas = vp.getCanvas() as HTMLCanvasElement;
            canvas.style.cursor = '';
          }
        });

        evt.preventDefault();
        evt.stopPropagation();
      }
    };

    // Add event listeners to sagittal and coronal viewports
    const sagittalElement = elementRefs.sagittal.current;
    const coronalElement = elementRefs.coronal.current;

    if (sagittalElement && coronalElement) {
      const sagittalMouseDown = (e: MouseEvent) => handleMouseDown(e, 'sagittal');
      const sagittalMouseMove = (e: MouseEvent) => handleMouseMove(e, 'sagittal');
      const coronalMouseDown = (e: MouseEvent) => handleMouseDown(e, 'coronal');
      const coronalMouseMove = (e: MouseEvent) => handleMouseMove(e, 'coronal');

      sagittalElement.addEventListener('mousedown', sagittalMouseDown, { capture: true });
      sagittalElement.addEventListener('mousemove', sagittalMouseMove, { capture: true });
      coronalElement.addEventListener('mousedown', coronalMouseDown, { capture: true });
      coronalElement.addEventListener('mousemove', coronalMouseMove, { capture: true });
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        sagittalElement.removeEventListener('mousedown', sagittalMouseDown, { capture: true } as any);
        sagittalElement.removeEventListener('mousemove', sagittalMouseMove, { capture: true } as any);
        coronalElement.removeEventListener('mousedown', coronalMouseDown, { capture: true } as any);
        coronalElement.removeEventListener('mousemove', coronalMouseMove, { capture: true } as any);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [renderMode, renderingEngineRef.current, centerlineDataRef.current]);

  // ============================================================================
  // Continuous Redraw CPR Position Lines
  // ============================================================================

  useEffect(() => {
    // Only enable in CPR mode
    if (renderMode !== 'cpr' || !renderingEngineRef.current || !centerlineDataRef.current) {
      return;
    }

    console.log('🔧 Starting continuous CPR position line redraw loop');

    let animationFrameId: number;
    let isRunning = true;

    // Continuous redraw function
    const redrawLoop = () => {
      if (!isRunning) return;

      const positionRatio = cprPositionRatioRef.current;
      const annulusRatio = cprAnnulusRatioRef.current;

      if (positionRatio !== null && positionRatio !== undefined) {
        // Redraw lines on both CPR viewports (with annulus reference line)
        drawCPRPositionLineOnCanvas('sagittal', positionRatio, annulusRatio);
        drawCPRPositionLineOnCanvas('coronal', positionRatio, annulusRatio);
      }

      // Continue loop
      animationFrameId = requestAnimationFrame(redrawLoop);
    };

    // Start the loop
    redrawLoop();

    return () => {
      console.log('🧹 Stopping CPR position line redraw loop');
      isRunning = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [renderMode, renderingEngineRef.current, centerlineDataRef.current]);

  // ============================================================================
  // Cleanup Annulus Reference Lines when leaving Measurements Stage
  // ============================================================================

  useEffect(() => {
    // Remove annulus lines when leaving measurements stage
    if (currentStage !== WorkflowStage.MEASUREMENTS && annulusLineActorsRef.current && renderingEngineRef.current) {
      console.log('🧹 Removing annulus reference lines (left measurements stage)');

      const renderingEngine = renderingEngineRef.current;
      const sagittalVp = renderingEngine.getViewport('sagittal');
      const coronalVp = renderingEngine.getViewport('coronal');

      if (sagittalVp && annulusLineActorsRef.current.sagittal) {
        try {
          sagittalVp.removeActor({ uid: 'annulus-line-sagittal' });
          sagittalVp.render();
        } catch (e) {
          console.warn('Failed to remove sagittal annulus line:', e);
        }
      }

      if (coronalVp && annulusLineActorsRef.current.coronal) {
        try {
          coronalVp.removeActor({ uid: 'annulus-line-coronal' });
          coronalVp.render();
        } catch (e) {
          console.warn('Failed to remove coronal annulus line:', e);
        }
      }

      annulusLineActorsRef.current = null;
      console.log('✅ Annulus reference lines removed');
    }
  }, [currentStage]);

  // ============================================================================
  // Cleanup: Disable Distance Measurement when leaving Measurements Stage
  // ============================================================================
  useEffect(() => {
    // Cleanup when leaving measurements stage
    if (currentStage !== WorkflowStage.MEASUREMENTS) {
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (toolGroup) {
        const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;

        if (fixedCrosshairTool) {
          // Disable distance measurement
          if (typeof fixedCrosshairTool.setAnnulusReference === 'function') {
            fixedCrosshairTool.setAnnulusReference(null);
            console.log('📏 Distance measurement disabled (left measurements stage)');
          }

          // Re-enable center dragging
          if (typeof fixedCrosshairTool.setCenterDraggingDisabled === 'function') {
            fixedCrosshairTool.setCenterDraggingDisabled(false);
            console.log('🔓 Center dragging re-enabled');
          }
        }
      }
    }
  }, [currentStage]); // Run when stage changes

  // ============================================================================
  // Crosshair Focal Point Synchronization
  // ============================================================================

  // DISABLED: Focal point locking is no longer needed with continuous centerline scrolling
  // The continuous scrolling in ANNULUS_DEFINITION properly updates the focal point along the centerline
  // This enforcement mechanism was causing drift warnings and jerky scrolling
  /*
  useEffect(() => {
    if (!renderingEngineRef.current || !lockedFocalPointRef.current || currentStage !== WorkflowStage.ANNULUS_DEFINITION) {
      return;
    }

    const renderingEngine = renderingEngineRef.current;
    const lockedFocalPoint = lockedFocalPointRef.current;
    const viewportIds = ['axial', 'sagittal', 'coronal'];

    console.log('🔒 Setting up focal point locking synchronizer');

    // Use requestAnimationFrame to continuously enforce the locked focal point
    let rafId: number;
    const enforceLock = () => {
      viewportIds.forEach(id => {
        try {
          const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
          if (viewport) {
            const camera = viewport.getCamera();
            const currentFocalPoint = camera.focalPoint;

            // Check if focal point has drifted
            const dx = currentFocalPoint[0] - lockedFocalPoint[0];
            const dy = currentFocalPoint[1] - lockedFocalPoint[1];
            const dz = currentFocalPoint[2] - lockedFocalPoint[2];
            const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

            if (distance > 0.1) { // Threshold to avoid floating point issues
              // Restore the locked focal point while preserving other camera properties
              viewport.setCamera({
                ...camera,
                focalPoint: lockedFocalPoint
              });
              console.log(`🔒 Enforced locked focal point on ${id} (drift: ${distance.toFixed(2)}mm)`);
            }
          }
        } catch (error) {
          // Viewport might not be ready yet
        }
      });

      // Continue the loop
      rafId = requestAnimationFrame(enforceLock);
    };

    // Start the enforcement loop
    rafId = requestAnimationFrame(enforceLock);

    console.log('✅ Focal point locking active');

    return () => {
      cancelAnimationFrame(rafId);
      console.log('🔓 Focal point locking deactivated');
    };
  }, [currentStage, lockedFocalPointRef.current, renderingEngineRef.current]);
  */

  // Preload adjacent phases for smooth cine playback
  const preloadAdjacentPhases = async () => {
    if (!phaseInfo || !phaseInfo.isMultiPhase || selectedPhase === null || !patientInfo) {
      return;
    }

    try {
      const currentPhase = selectedPhase;
      const nextPhase = (currentPhase + 1) % phaseInfo.totalPhases;
      const prevPhase = (currentPhase - 1 + phaseInfo.totalPhases) % phaseInfo.totalPhases;

      // Preload next and previous phases
      for (const phaseIndex of [nextPhase, prevPhase]) {
        if (!preloadedVolumesRef.current[phaseIndex]) {
          console.log(`🔄 Preloading phase ${phaseIndex + 1}...`);

          const { imageIds: phaseImageIds } = await createImageIdsAndCacheMetaData({
            StudyInstanceUID: patientInfo.studyInstanceUID!,
            SeriesInstanceUID: patientInfo.seriesInstanceUID!,
            wadoRsRoot: "http://127.0.0.1/orthanc/dicom-web",
            selectedPhase: phaseIndex,
          });

          const phaseVolumeId = `streamingImageVolume_phase${phaseIndex}_${Date.now()}`;

          const phaseVolume = await volumeLoader.createAndCacheVolume(phaseVolumeId, {
            imageIds: phaseImageIds,
          });
          await phaseVolume.load();

          preloadedVolumesRef.current[phaseIndex] = phaseVolumeId;
          console.log(`✅ Preloaded phase ${phaseIndex + 1}`);
        }
      }
    } catch (error) {
      console.warn('Phase preloading error:', error);
    }
  };

  // Preload adjacent phases when phase changes (only when not in preloading mode)
  useEffect(() => {
    if (phaseInfo && phaseInfo.isMultiPhase && selectedPhase !== null && !isPreloading && allPhasesLoadedRef.current) {
      preloadAdjacentPhases();
    }
  }, [selectedPhase, phaseInfo, isPreloading]);

  // Listen for camera modifications on 3D viewport to update orientation marker
  useEffect(() => {
    if (currentStage !== WorkflowStage.ROOT_DEFINITION) return;
    if (!elementRefs.volume3D?.current) return;

    const element = elementRefs.volume3D.current;

    const handleCameraModified = () => {
      updateCameraOrientation();
    };

    // Add event listener for camera modifications
    element.addEventListener(Enums.Events.CAMERA_MODIFIED, handleCameraModified);

    console.log('📹 Camera orientation tracking enabled for 3D viewport');

    return () => {
      element.removeEventListener(Enums.Events.CAMERA_MODIFIED, handleCameraModified);
    };
  }, [currentStage, elementRefs.volume3D]);

  // Trigger resize when entering annulus definition or measurements stage to adapt to custom layout
  useEffect(() => {
    if ((currentStage === WorkflowStage.ANNULUS_DEFINITION || currentStage === WorkflowStage.MEASUREMENTS) && renderingEngineRef.current) {
      console.log(`📐 ${currentStage} stage: Triggering resize for custom layout`);
      setTimeout(() => {
        if (renderingEngineRef.current) {
          const viewportIds = currentStage === WorkflowStage.MEASUREMENTS
            ? ['axial', 'sagittal', 'coronal', 'measurement1']
            : ['axial', 'sagittal', 'coronal'];
          manualResize(renderingEngineId, viewportIds);
          console.log('✅ Resize complete for custom layout');
        }
      }, 100);
    }
  }, [currentStage]);

  // Double-click handler for viewport maximize/restore
  const handleViewportDoubleClick = (viewportId: string) => {
    if (maximizedViewport === viewportId) {
      // Already maximized, restore to grid layout
      setMaximizedViewport(null);
      console.log(`↩️ Restoring viewport "${viewportId}" to grid layout`);
    } else {
      // Maximize this viewport
      setMaximizedViewport(viewportId);
      console.log(`🔍 Maximizing viewport "${viewportId}"`);
    }
  };

  // Calculate current camera orientation angles
  const calculateCameraOrientation = (camera: Types.ICamera) => {
    const { position, focalPoint, viewUp } = camera;

    // Calculate view direction vector
    const viewDir = [
      position[0] - focalPoint[0],
      position[1] - focalPoint[1],
      position[2] - focalPoint[2],
    ];

    // Normalize
    const length = Math.sqrt(viewDir[0] ** 2 + viewDir[1] ** 2 + viewDir[2] ** 2);
    viewDir[0] /= length;
    viewDir[1] /= length;
    viewDir[2] /= length;

    // Calculate angle around Z-axis (LAO/RAO angle)
    // atan2(x, -y) gives angle from posterior (-Y) axis
    // Since camera is at back looking forward, we need to negate Y
    const viewAngle = Math.atan2(viewDir[0], -viewDir[1]) * (180 / Math.PI);

    // Calculate tilt angle (cranial/caudal)
    const tiltAngle = Math.asin(viewDir[2]) * (180 / Math.PI);

    return { viewAngle, tiltAngle };
  };

  // Update camera orientation when camera changes
  const updateCameraOrientation = () => {
    if (!renderingEngineRef.current) return;

    const viewport = renderingEngineRef.current.getViewport('volume3D') as Types.IVolumeViewport;
    if (!viewport) return;

    const camera = viewport.getCamera();
    const orientation = calculateCameraOrientation(camera);
    setCameraOrientation(orientation);
  };

  // Initialize VTK Orientation Marker Widget with Human model
  const initializeOrientationWidget = async () => {
    if (!renderingEngineRef.current) return;
    if (orientationWidgetRef.current) return; // Already initialized

    const viewport = renderingEngineRef.current.getViewport('volume3D') as Types.IVolumeViewport;
    if (!viewport) return;

    try {
      console.log('🧑 Initializing human orientation marker from VTP file...');

      // Fetch and parse the Human.vtp file
      const response = await fetch(HumanVTP);
      const arrayBuffer = await response.arrayBuffer();

      const reader = vtkXMLPolyDataReader.newInstance();
      reader.parseAsArrayBuffer(arrayBuffer);

      // Create actor for the human model
      const mapper = vtkMapper.newInstance();
      mapper.setInputConnection(reader.getOutputPort());

      const actor = vtkActor.newInstance();
      actor.setMapper(mapper);

      // Rotate the human model 180° around Z-axis to face forward
      actor.rotateZ(180);

      // Get the render window using Cornerstone3D's internal structure
      const renderingEngine = viewport.getRenderingEngine() as any;

      // Debug: log available properties
      console.log('🔍 Rendering engine properties:', Object.keys(renderingEngine));

      // Get the viewport-specific render window for volume3D only
      let renderWindow;
      if (renderingEngine.getOffscreenMultiRenderWindow) {
        console.log('✅ Using getOffscreenMultiRenderWindow method for volume3D');
        const multiRenderWindow = renderingEngine.getOffscreenMultiRenderWindow('volume3D');
        renderWindow = multiRenderWindow.getRenderWindow();
      } else if (renderingEngine.offscreenMultiRenderWindow) {
        console.log('✅ Using offscreenMultiRenderWindow property');
        renderWindow = renderingEngine.offscreenMultiRenderWindow.getRenderWindow();
      } else {
        console.error('❌ Cannot find render window accessor method');
        console.log('Available methods:', Object.keys(renderingEngine).filter(k => k.includes('render') || k.includes('window') || k.includes('vtk')));
        return;
      }

      if (!renderWindow) {
        console.error('❌ Failed to get render window for volume3D');
        return;
      }

      // Get the renderer for the volume3D viewport specifically
      const renderer = (viewport as any).getRenderer();
      console.log('🎨 Got renderer for volume3D viewport only');

      // Create orientation marker widget bound ONLY to volume3D viewport
      // Using parentRenderer ensures it renders only in that specific viewport's renderer
      const orientationWidget = vtkOrientationMarkerWidget.newInstance({
        actor: actor,
        interactor: renderWindow.getInteractor(),
        parentRenderer: renderer, // CRITICAL: This binds it to volume3D renderer only
      });

      orientationWidget.setEnabled(true);
      orientationWidget.setViewportCorner(
        vtkOrientationMarkerWidget.Corners.BOTTOM_LEFT
      );
      orientationWidget.setViewportSize(0.15); // 15% of viewport
      orientationWidget.setMinPixelSize(100);
      orientationWidget.setMaxPixelSize(300);

      orientationWidgetRef.current = orientationWidget;

      console.log('✅ Human orientation marker initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize orientation marker:', error);
    }
  };

  // State to track if cropped volume is shown
  const [showCroppedVolume, setShowCroppedVolume] = useState(false);

  // Simple message: crop not yet implemented
  const cropVolumeByCenterline = async (radius: number) => {
    console.log('🔪 cropVolumeByCenterline called with radius:', radius);
    console.log('📊 centerlineDataRef.current:', centerlineDataRef.current);

    if (!centerlineDataRef.current?.position || centerlineDataRef.current.position.length < 2) {
      console.warn('⚠️ No centerline data available for cropping');
      alert('No centerline data available. Please complete steps 1-2 of the workflow first.');
      return;
    }

    const renderingEngine = renderingEngineRef.current;
    if (!renderingEngine) {
      console.error('❌ No rendering engine');
      return;
    }

    const viewport3D = renderingEngine.getViewport('volume3D');
    if (!viewport3D) {
      console.error('❌ No 3D viewport found');
      return;
    }

    console.log(`🔪 Applying centerline-based crop with ${radius}mm radius using VolumeCroppingTool`);
    console.log(`📍 Centerline has ${centerlineDataRef.current.position.length} points`);

    try {
      const centerlineFlat = centerlineDataRef.current.position;

      // Convert flat array to array of [x,y,z] points
      const centerlinePoints = [];
      for (let i = 0; i < centerlineFlat.length; i += 3) {
        centerlinePoints.push([
          centerlineFlat[i],
          centerlineFlat[i + 1],
          centerlineFlat[i + 2]
        ]);
      }

      console.log(`📍 Converted to ${centerlinePoints.length} 3D points`);

      // Calculate bounding box of centerline with radius padding
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      for (const point of centerlinePoints) {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        minZ = Math.min(minZ, point[2]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
        maxZ = Math.max(maxZ, point[2]);
      }

      // Add padding based on radius
      minX -= radius;
      minY -= radius;
      minZ -= radius;
      maxX += radius;
      maxY += radius;
      maxZ += radius;

      console.log(`📦 Bounding box: X[${minX.toFixed(1)}, ${maxX.toFixed(1)}] Y[${minY.toFixed(1)}, ${maxY.toFixed(1)}] Z[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`);

      // Use VolumeCroppingTool to set the crop box programmatically
      const toolGroup3D = ToolGroupManager.getToolGroup(`${toolGroupId}_3D`);
      if (toolGroup3D) {
        const croppingTool = toolGroup3D.getToolInstance(VolumeCroppingTool.toolName) as any;

        if (croppingTool) {
          console.log('🔍 Inspecting VolumeCroppingTool API:');
          console.log('  Available methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(croppingTool)));
          console.log('  Tool instance keys:', Object.keys(croppingTool));

          // Set the bounding box on the cropping tool
          // The tool uses the volume's bounding box and crop factors
          const volumeViewport = viewport3D as any;
          const volume = volumeViewport.getDefaultActor()?.actor;

          if (volume) {
            const volumeBounds = volume.getBounds();
            console.log('📦 Volume bounds:', volumeBounds);
            console.log(`   [${volumeBounds[0].toFixed(1)}, ${volumeBounds[1].toFixed(1)}] [${volumeBounds[2].toFixed(1)}, ${volumeBounds[3].toFixed(1)}] [${volumeBounds[4].toFixed(1)}, ${volumeBounds[5].toFixed(1)}]`);

            // Calculate crop box in world coordinates
            const cropBox = {
              xMin: minX, xMax: maxX,
              yMin: minY, yMax: maxY,
              zMin: minZ, zMax: maxZ
            };
            console.log('🎯 Target crop box:', cropBox);

            // Try different approaches to set the crop box

            // Approach 1: Direct method call if it exists
            if (typeof croppingTool.setCropBox === 'function') {
              console.log('📝 Trying setCropBox() method...');
              croppingTool.setCropBox(cropBox);
            }

            // Approach 2: Access annotation data
            else if (typeof croppingTool.getAnnotations === 'function') {
              console.log('📝 Trying annotation manipulation...');
              const annotations = croppingTool.getAnnotations();
              console.log('  Annotations:', annotations);

              if (annotations && annotations.length > 0) {
                const annotation = annotations[0];
                console.log('  Annotation data:', annotation.data);
                console.log('  Current handles:', annotation.data.handles);

                // Update handle positions to match our crop box
                annotation.data.handles = {
                  ...annotation.data.handles,
                  xMin: { worldPosition: [minX, (minY + maxY) / 2, (minZ + maxZ) / 2] },
                  xMax: { worldPosition: [maxX, (minY + maxY) / 2, (minZ + maxZ) / 2] },
                  yMin: { worldPosition: [(minX + maxX) / 2, minY, (minZ + maxZ) / 2] },
                  yMax: { worldPosition: [(minX + maxX) / 2, maxY, (minZ + maxZ) / 2] },
                  zMin: { worldPosition: [(minX + maxX) / 2, (minY + maxY) / 2, minZ] },
                  zMax: { worldPosition: [(minX + maxX) / 2, (minY + maxY) / 2, maxZ] },
                };
                console.log('  Updated handles:', annotation.data.handles);
              }
            }

            // Approach 3: Try to access internal crop data or mapper
            else {
              console.log('📝 Trying alternative approaches...');
              console.log('  Tool configuration:', croppingTool.configuration);

              // Try to access the volume actor and its mapper
              const actors = volumeViewport.getActors();
              console.log('  Viewport actors:', actors.length);

              if (actors.length > 0) {
                const volumeActor = actors[0].actor;
                const mapper = volumeActor.getMapper();
                console.log('  Mapper type:', mapper.getClassName());
                console.log('  Mapper methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(mapper)).filter(m => m.includes('Clip') || m.includes('Crop')));
              }
            }

            console.log('✅ Attempted to set VolumeCroppingTool crop box');
          }
        } else {
          console.warn('⚠️ VolumeCroppingTool not found in tool group');
        }
      }

      // Note: Vessel-only filter (150-300 HU) is already applied by default at viewport initialization

      /* OLD COMPLEX CYLINDRICAL CODE - commented out, using simple box instead
      for (let i = 0; i < centerlinePoints.length - 1; i += step) {
        const p1 = centerlinePoints[i];
        const p2 = centerlinePoints[Math.min(i + step, centerlinePoints.length - 1)];

        // Calculate direction vector
        const direction = [
          p2[0] - p1[0],
          p2[1] - p1[1],
          p2[2] - p1[2]
        ];

        // Normalize direction
        const length = Math.sqrt(direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2);
        if (length < 0.001) continue;

        const normalizedDir = direction.map(d => d / length);

        // Create perpendicular vectors for the cylindrical sides
        // We'll create 6 planes around each segment (hexagonal approximation)
        const angles = [0, 60, 120, 180, 240, 300];

        for (const angle of angles) {
          const rad = (angle * Math.PI) / 180;

          // Create perpendicular vector in the plane perpendicular to centerline
          let perpX = Math.cos(rad);
          let perpY = Math.sin(rad);
          let perpZ = 0;

          // Rotate to be perpendicular to direction vector
          // Use cross product to get perpendicular vectors
          const up = [0, 0, 1];
          const cross = [
            normalizedDir[1] * up[2] - normalizedDir[2] * up[1],
            normalizedDir[2] * up[0] - normalizedDir[0] * up[2],
            normalizedDir[0] * up[1] - normalizedDir[1] * up[0]
          ];

          const crossLength = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
          if (crossLength > 0.001) {
            const normalizedCross = cross.map(c => c / crossLength);

            // Position on the cylinder surface
            const pointOnCylinder = [
              p1[0] + normalizedCross[0] * radius * Math.cos(rad),
              p1[1] + normalizedCross[1] * radius * Math.cos(rad),
              p1[2] + normalizedCross[2] * radius * Math.sin(rad)
            ];

            // Normal pointing OUTWARD (away from centerline) to clip outside
            const normal = [
              pointOnCylinder[0] - p1[0],
              pointOnCylinder[1] - p1[1],
              pointOnCylinder[2] - p1[2]
            ];

            const normalLength = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2);
            if (normalLength > 0.001) {
              const normalizedNormal = normal.map(n => n / normalLength);

              // Create VTK plane
              const plane = vtkPlane.newInstance();
              plane.setOrigin(pointOnCylinder);
              plane.setNormal(normalizedNormal);

              // Add plane to mapper
              if (typeof mapper.addClippingPlane === 'function') {
                mapper.addClippingPlane(plane);
              }
            }
          }
        }
      }

      // Add end cap planes (at start and end of centerline)
      const startPoint = centerlinePoints[0];
      const endPoint = centerlinePoints[centerlinePoints.length - 1];

      // Start cap
      const startDir = [
        centerlinePoints[1][0] - startPoint[0],
        centerlinePoints[1][1] - startPoint[1],
        centerlinePoints[1][2] - startPoint[2]
      ];
      const startDirLength = Math.sqrt(startDir[0] ** 2 + startDir[1] ** 2 + startDir[2] ** 2);
      if (startDirLength > 0.001) {
        const startPlane = vtkPlane.newInstance();
        startPlane.setOrigin(startPoint);
        startPlane.setNormal(startDir.map(d => d / startDirLength));
        if (typeof mapper.addClippingPlane === 'function') {
          mapper.addClippingPlane(startPlane);
        }
      }

      // End cap
      const endIdx = centerlinePoints.length - 2;
      const endDir = [
        endPoint[0] - centerlinePoints[endIdx][0],
        endPoint[1] - centerlinePoints[endIdx][1],
        endPoint[2] - centerlinePoints[endIdx][2]
      ];
      const endDirLength = Math.sqrt(endDir[0] ** 2 + endDir[1] ** 2 + endDir[2] ** 2);
      if (endDirLength > 0.001) {
        const endPlane = vtkPlane.newInstance();
        endPlane.setOrigin(endPoint);
        endPlane.setNormal(endDir.map(d => d / endDirLength));
        if (typeof mapper.addClippingPlane === 'function') {
          mapper.addClippingPlane(endPlane);
        }
      }
      */

      viewport3D.render();
      console.log('✅ Centerline-based box crop applied');
    } catch (error) {
      console.error('❌ Error applying centerline crop:', error);
    }
  };

  // Restore original volume - remove clipping planes
  const restoreOriginalVolume = async () => {
    const renderingEngine = renderingEngineRef.current;
    if (!renderingEngine) return;

    const viewport3D = renderingEngine.getViewport('volume3D');
    if (!viewport3D) return;

    try {
      // Get the volume actor and remove all clipping planes
      const actors = viewport3D.getActors();
      if (actors.length > 0) {
        const volumeActor = actors[0].actor;
        const mapper = volumeActor.getMapper();

        if (typeof mapper.removeAllClippingPlanes === 'function') {
          mapper.removeAllClippingPlanes();
          viewport3D.render();
          console.log('✅ Removed all clipping planes - full volume restored');
        }
      }
    } catch (error) {
      console.error('❌ Error restoring volume:', error);
    }
  };

  // Apply HU range to 3D viewport for vessel/tissue visualization
  const apply3DVolumeRange = (lower: number, upper: number, mode: 'vessels' | 'all' | 'soft') => {
    if (!renderingEngineRef.current) return;

    const viewport = renderingEngineRef.current.getViewport('volume3D') as Types.IVolumeViewport;
    if (!viewport) return;

    setVolume3DRange({ lower, upper });

    try {
      if (mode === 'vessels') {
        // Use MAXIMUM_INTENSITY_BLEND mode for vessel visualization
        console.log('🎨 Applying MAXIMUM_INTENSITY_BLEND mode for vessels...');

        const actors = (viewport as any).getActors();
        if (actors && actors.length > 0) {
          const actorEntry = actors[0];
          const volumeActor = actorEntry.actor || actorEntry;
          const mapper = volumeActor.getMapper();

          if (mapper && typeof mapper.setBlendMode === 'function') {
            // VTK BlendMode constants from the link:
            // COMPOSITE_BLEND: 0
            // MAXIMUM_INTENSITY_BLEND: 1
            // MINIMUM_INTENSITY_BLEND: 2
            // AVERAGE_INTENSITY_BLEND: 3
            // ADDITIVE_INTENSITY_BLEND: 4
            // RADON_TRANSFORM_BLEND: 5

            mapper.setBlendMode(1); // MAXIMUM_INTENSITY_BLEND
            console.log('✅ Set blend mode to MAXIMUM_INTENSITY_BLEND (1)');
          }

          // Apply MIP with transparency (like original example)
          const property = volumeActor.getProperty();

          // Opacity: Less transparent, vessels more solid/visible
          const opacityFunction = vtkPiecewiseFunction.newInstance();
          opacityFunction.addPoint(-3024, 0.0);        // Air - transparent
          opacityFunction.addPoint(lower - 50, 0.0);   // Below vessels - transparent
          opacityFunction.addPoint(lower, 0.3);        // Vessel start - 30% opacity
          opacityFunction.addPoint((lower + upper) / 2, 0.6);  // Mid vessels - 60% opacity
          opacityFunction.addPoint(upper, 0.9);        // Bright vessels - 90% opacity
          opacityFunction.addPoint(500, 1.0);          // Bone - 100% opacity
          opacityFunction.addPoint(3000, 1.0);         // Metal - 100% opacity

          // Inverted grayscale - high HU (vessels) = dark/black, darker overall
          const colorFunction = vtkColorTransferFunction.newInstance();
          colorFunction.addRGBPoint(-3024, 1.0, 1.0, 1.0);      // Air - white
          colorFunction.addRGBPoint(0, 0.7, 0.7, 0.7);          // Soft tissue - lighter gray
          colorFunction.addRGBPoint(lower, 0.4, 0.4, 0.4);      // Vessel start - darker medium gray
          colorFunction.addRGBPoint((lower + upper) / 2, 0.15, 0.15, 0.15);  // Mid vessels - much darker
          colorFunction.addRGBPoint(upper, 0.05, 0.05, 0.05);   // Bright vessels - nearly black
          colorFunction.addRGBPoint(500, 0.0, 0.0, 0.0);        // Bone - black
          colorFunction.addRGBPoint(3000, 0.0, 0.0, 0.0);       // Metal - black

          property.setRGBTransferFunction(0, colorFunction);
          property.setScalarOpacity(0, opacityFunction);
        }

        viewport.render();
        console.log(`✅ Applied MAXIMUM_INTENSITY_BLEND mode for vessels`);

      } else if (mode === 'all') {
        // Use COMPOSITE blend mode (default) with CT-Cardiac preset
        console.log('🎨 Applying COMPOSITE blend mode for all structures...');

        const actors = (viewport as any).getActors();
        if (actors && actors.length > 0) {
          const actorEntry = actors[0];
          const volumeActor = actorEntry.actor || actorEntry;
          const mapper = volumeActor.getMapper();

          if (mapper && typeof mapper.setBlendMode === 'function') {
            // VTK BlendMode enum: COMPOSITE_BLEND = 0
            mapper.setBlendMode(0);
            console.log('✅ Set blend mode to COMPOSITE_BLEND (0)');
          }
        }

        viewport.setProperties({
          preset: 'CT-Cardiac',
        });
        viewport.render();
        console.log('✅ Applied CT-Cardiac preset with composite blend');
      } else {
        // Soft tissue mode using opacity transfer functions
        const actors = (viewport as any).getActors();
        if (!actors || actors.length === 0) {
          console.error('❌ No actors found in viewport');
          return;
        }

        const actorEntry = actors[0];
        const volumeActor = actorEntry.actor || actorEntry;

        if (!volumeActor.getProperty) {
          console.error('❌ Actor does not have getProperty method');
          return;
        }

        const property = volumeActor.getProperty();

        const opacityFunction = vtkPiecewiseFunction.newInstance();
        opacityFunction.addPoint(-1000, 0.0);
        opacityFunction.addPoint(lower, 0.0);
        opacityFunction.addPoint(lower + 50, 0.5);
        opacityFunction.addPoint(upper - 50, 0.8);
        opacityFunction.addPoint(upper, 0.0);
        opacityFunction.addPoint(3000, 0.0);

        const colorFunction = vtkColorTransferFunction.newInstance();
        colorFunction.addRGBPoint(lower, 0.3, 0.3, 0.3);
        colorFunction.addRGBPoint((lower + upper) / 2, 0.8, 0.7, 0.6);
        colorFunction.addRGBPoint(upper, 0.9, 0.8, 0.7);

        property.setRGBTransferFunction(0, colorFunction);
        property.setScalarOpacity(0, opacityFunction);
        viewport.render();

        console.log('✅ Applied soft tissue transfer function');
      }

      console.log(`🎨 Applied 3D volume range: ${lower} to ${upper} HU (mode: ${mode})`);
    } catch (error) {
      console.error('❌ Failed to apply volume range:', error);
    }
  };

  // Apply LAO/RAO projection angle to 3D viewport
  const applyProjectionAngle = (angle: number) => {
    setProjectionAngle(angle);

    if (!renderingEngineRef.current) return;

    const viewport = renderingEngineRef.current.getViewport('volume3D') as Types.IVolumeViewport;
    if (!viewport) return;

    const camera = viewport.getCamera();
    const { focalPoint } = camera;

    // Calculate distance from focal point
    const distance = Math.sqrt(
      Math.pow(camera.position[0] - focalPoint[0], 2) +
      Math.pow(camera.position[1] - focalPoint[1], 2) +
      Math.pow(camera.position[2] - focalPoint[2], 2)
    );

    // Convert angle to radians
    const angleRad = (angle * Math.PI) / 180;

    // LAO/RAO rotation around Z-axis (superior-inferior axis)
    // Positive angle = LAO (Left Anterior Oblique) - rotate counterclockwise
    // Negative angle = RAO (Right Anterior Oblique) - rotate clockwise
    // Start from posterior position (-Y, back view) and rotate

    const newPosition: Types.Point3 = [
      focalPoint[0] + distance * Math.sin(angleRad), // X component
      focalPoint[1] - distance * Math.cos(angleRad), // Y component (negative because starting from back)
      focalPoint[2], // Z stays same (no cranial/caudal tilt)
    ];

    viewport.setCamera({
      focalPoint: focalPoint,
      position: newPosition,
      viewUp: [0, 0, 1], // Head up
    });

    viewport.render();

    // Update orientation display
    setTimeout(updateCameraOrientation, 50);

    console.log(`📐 Applied ${angle > 0 ? 'LAO' : angle < 0 ? 'RAO' : 'AP'} ${Math.abs(angle)}° projection`);
  };

  return (
    <div className="w-full h-full relative">
      {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
            <div className="flex items-center gap-3 text-white">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <span>Loading DICOM Volume (Simple Pattern)...</span>
            </div>
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
            <div className="bg-red-900 border border-red-700 rounded-lg p-6 text-white max-w-lg">
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                ⚠️ DICOM Loading Error
              </h3>
              <p className="text-sm whitespace-pre-line mb-3">{error}</p>
              
              <div className="flex items-center justify-between">
                <p className="text-xs text-red-200">
                  Series: {patientInfo?.seriesInstanceUID || 'Not selected'}
                </p>
                <button
                  onClick={() => {
                    setError(null);
                    setTimeout(() => initializeMPRViewport(), 100);
                  }}
                  className="bg-red-700 hover:bg-red-600 px-3 py-1 rounded text-xs"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        )}
        
        {!patientInfo?.seriesInstanceUID && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
            <div className="text-center text-slate-400">
              <div className="text-4xl mb-4">🏥</div>
              <h3 className="text-lg font-medium mb-2">No Series Selected</h3>
              <p className="text-sm">Please select a patient and series to view MPR images.</p>
            </div>
          </div>
        )}
        
        {/* MPR views - Unified approach with conditional top row */}
        <div className="relative w-full h-full bg-slate-900">
          {!maximizedViewport && (
            <div className={currentStage === WorkflowStage.MEASUREMENTS ? "flex flex-col h-full gap-1" : "h-full"}>
              {/* Top row for MEASUREMENTS stage only */}
              {currentStage === WorkflowStage.MEASUREMENTS && (
                <div className="flex gap-1 h-1/3">
                  <div className="relative bg-black border border-slate-700 w-1/2 overflow-hidden">
                    <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                      3D View
                    </div>
                    <div
                      ref={elementRefs.measurement1}
                      className="w-full h-full"
                      onDoubleClick={() => handleViewportDoubleClick('measurement1')}
                    />
                  </div>
                  <div className="relative bg-slate-800 border border-slate-700 w-1/2 overflow-hidden">
                    <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                      Reserved
                    </div>
                    <div
                      ref={elementRefs.measurement2}
                      className="w-full h-full flex items-center justify-center text-slate-500"
                    >
                      <span className="text-sm">Reserved for future use</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Main viewport grid - shared by all stages */}
              <div
                className={`grid gap-1 ${
                  currentStage === WorkflowStage.MEASUREMENTS ? 'h-2/3 grid-cols-3' :
                  currentStage === WorkflowStage.ROOT_DEFINITION ? 'h-full grid-cols-2 grid-rows-2' :
                  'h-full grid-cols-3'
                }`}
              >
              {/* Axial */}
              <div className="relative bg-black border border-slate-700">
              <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded flex items-center gap-2">
                <span>Axial</span>
                {currentStage === WorkflowStage.MEASUREMENTS && onRenderModeChange && (
                  <select
                    value={renderMode}
                    onChange={(e) => onRenderModeChange(e.target.value as 'mpr' | 'cpr')}
                    className="text-[10px] bg-slate-800 text-white border border-slate-600 rounded px-1.5 py-0.5 cursor-pointer hover:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="mpr">Curved</option>
                    <option value="cpr">Straight</option>
                  </select>
                )}
              </div>
              <div
                ref={elementRefs.axial}
                className="w-full h-full"
                onDoubleClick={() => handleViewportDoubleClick('axial')}
              />
              {renderAnnotationOverlayElements('axial')}
            </div>

            {/* Sagittal */}
              <div className="relative bg-black border border-slate-700">
                <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded flex items-center gap-2">
                  <span>Sagittal</span>
                  {currentStage === WorkflowStage.MEASUREMENTS && onRenderModeChange && (
                    <select
                      value={renderMode}
                      onChange={(e) => onRenderModeChange(e.target.value as 'mpr' | 'cpr')}
                      className="text-[10px] bg-slate-800 text-white border border-slate-600 rounded px-1.5 py-0.5 cursor-pointer hover:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="mpr">Curved</option>
                      <option value="cpr">Straight</option>
                    </select>
                  )}
                </div>
                <div
                  ref={elementRefs.sagittal}
                  className="w-full h-full"
                  onDoubleClick={() => handleViewportDoubleClick('sagittal')}
                />
                {renderAnnotationOverlayElements('sagittal')}
              </div>

              {/* Coronal */}
              <div className="relative bg-black border border-slate-700">
                <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                  Coronal
                </div>
                <div
                  ref={elementRefs.coronal}
                  className="w-full h-full"
                  onDoubleClick={() => handleViewportDoubleClick('coronal')}
                />
                {renderAnnotationOverlayElements('coronal')}
              </div>

              {/* volume3D for ROOT_DEFINITION */}
              {currentStage === WorkflowStage.ROOT_DEFINITION && (
                <div className="relative bg-black border border-slate-700">
                  <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                    3D View
                  </div>
                  <div
                    ref={elementRefs.volume3D}
                    className="w-full h-full"
                    onDoubleClick={() => handleViewportDoubleClick('volume3D')}
                  />
                </div>
              )}
              </div>
            </div>
          )}

          {/* Maximized viewports */}
          {maximizedViewport && (
            <>
          {maximizedViewport === 'axial' && (
            <div className={`relative bg-black border border-slate-700 ${
              maximizedViewport === 'axial' ? 'w-full h-full' : ''
            }`} style={{ order: 1 }}>
              <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                Axial {maximizedViewport === 'axial' && '(Maximized - Double-click to restore)'}
              </div>
              <div
                ref={elementRefs.axial}
                className="w-full h-full"
                style={{ minHeight: '300px' }}
                onDoubleClick={() => handleViewportDoubleClick('axial')}
              />
            {renderAnnotationOverlayElements('axial')}

            {/* Custom labels for line annotations */}
            {(() => {
              const viewport = renderingEngineRef.current?.getViewport('axial');
              if (!viewport) return null;

              const annotations = cornerstoneTools.annotation.state.getAllAnnotations();
              const lineAnnotations = annotations.filter((ann: any) =>
                (ann?.metadata?.toolName === 'AxialLine' || ann?.metadata?.toolName === 'MPRLongAxisLine') &&
                ann?.data?.handles?.points?.length === 2 &&
                annotationLabels[ann.annotationUID] &&
                // Only show labels for annotations in current renderMode
                (!ann?.metadata?.renderMode || ann.metadata.renderMode === renderMode)
              );


              return lineAnnotations.map((annotation: any) => {
                const label = annotationLabels[annotation.annotationUID];
                if (!label) return null;

                // Check if annotation should be visible in this viewport
                // AxialLine: only in axial viewport
                // MPRLongAxisLine: only in sagittal/coronal viewports (handled in those sections)
                if (annotation.metadata?.toolName === 'AxialLine') {
                  // AxialLine should only show in axial
                } else if (annotation.metadata?.toolName === 'MPRLongAxisLine') {
                  // MPRLongAxisLine should NOT show in axial
                  return null;
                }

                // Get the midpoint of the line
                const p1 = annotation.data.handles.points[0];
                const p2 = annotation.data.handles.points[1];
                const midpoint: Types.Point3 = [
                  (p1[0] + p2[0]) / 2,
                  (p1[1] + p2[1]) / 2,
                  (p1[2] + p2[2]) / 2
                ];

                // Check visibility based on camera plane (like polygon overlays)
                const camera = viewport.getCamera();
                const { viewPlaneNormal, focalPoint } = camera;

                const vectorToPoint = [
                  midpoint[0] - focalPoint[0],
                  midpoint[1] - focalPoint[1],
                  midpoint[2] - focalPoint[2]
                ];

                const distanceToPlane = Math.abs(
                  vectorToPoint[0] * viewPlaneNormal[0] +
                  vectorToPoint[1] * viewPlaneNormal[1] +
                  vectorToPoint[2] * viewPlaneNormal[2]
                );

                const slabThickness = (viewport as any).getSlabThickness?.() || 0.1;
                const visibilityThreshold = slabThickness / 2;

                if (distanceToPlane > visibilityThreshold) {
                  return null;
                }

                // Convert to canvas coordinates
                const canvasPoint = viewport.worldToCanvas(midpoint) as Types.Point2;
                const viewportElement = getViewportElementById('axial');
                const displayPoint = canvasToDisplayPoint(viewport, viewportElement, canvasPoint);

                // Check if point is visible
                const canvas = viewport.canvas;
                if (canvasPoint[0] < -50 || canvasPoint[0] > canvas.width + 50 ||
                    canvasPoint[1] < -50 || canvasPoint[1] > canvas.height + 50) {
                  return null;
                }

                return (
                  <div
                    key={annotation.annotationUID}
                    className="absolute z-50"
                    style={{
                      left: `${displayPoint[0]}px`,
                      top: `${displayPoint[1] - 30}px`, // Position above the line
                      transform: 'translateX(-50%)'
                    }}
                  >
                    <div
                      style={{
                        color: label.color,
                        fontSize: '15px',
                        fontFamily: 'Arial, sans-serif',
                        fontWeight: 'bold',
                        textShadow: '1px 1px 3px rgba(0, 0, 0, 1), -1px -1px 3px rgba(0, 0, 0, 1)',
                        whiteSpace: 'nowrap',
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        border: `1px solid ${label.color}`,
                        cursor: 'pointer'
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setViewportContextMenu(null);
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          annotationUID: annotation.annotationUID,
                          viewportId: 'axial'
                        });
                      }}
                    >
                      {label.text}
                    </div>
                  </div>
                );
              });
            })()}

            {/* Render axis lines for polygon annotations */}
            {(() => {
              const viewport = renderingEngineRef.current?.getViewport('axial');
              if (!viewport) return null;

              const annotations = cornerstoneTools.annotation.state.getAllAnnotations();
              const polygonAnnotations = annotations.filter((ann: any) =>
                ann?.metadata?.toolName === 'SmoothPolygon' &&
                ann?.data?.contour?.closed &&
                ann?.metadata?.axesMeasurements
              );

              return polygonAnnotations.map((annotation: any, idx: number) => {
                const axes = annotation.metadata.axesMeasurements;
                if (!axes) return null;

                // Check if polygon is in current slice (same logic as overlay visibility)
                const firstPoint = annotation.data?.handles?.points?.[0] || annotation.data?.contour?.polyline?.[0];
                if (!firstPoint) return null;

                const camera = viewport.getCamera();
                const { viewPlaneNormal, focalPoint } = camera;

                const vectorToPoint = [
                  firstPoint[0] - focalPoint[0],
                  firstPoint[1] - focalPoint[1],
                  firstPoint[2] - focalPoint[2]
                ];

                const distanceToPlane = Math.abs(
                  vectorToPoint[0] * viewPlaneNormal[0] +
                  vectorToPoint[1] * viewPlaneNormal[1] +
                  vectorToPoint[2] * viewPlaneNormal[2]
                );

                const slabThickness = (viewport as any).getSlabThickness?.() || 0.1;
                const visibilityThreshold = slabThickness / 2;

                // Only render axis lines if polygon is in current slice
                if (distanceToPlane > visibilityThreshold) {
                  return null;
                }

                // Convert world coordinates to display coordinates
                const longAxisP1Display = canvasToDisplayPoint(
                  viewport,
                  getViewportElementById('axial'),
                  viewport.worldToCanvas(axes.longAxisP1) as Types.Point2
                );
                const longAxisP2Display = canvasToDisplayPoint(
                  viewport,
                  getViewportElementById('axial'),
                  viewport.worldToCanvas(axes.longAxisP2) as Types.Point2
                );
                const shortAxisP1Display = canvasToDisplayPoint(
                  viewport,
                  getViewportElementById('axial'),
                  viewport.worldToCanvas(axes.shortAxisP1) as Types.Point2
                );
                const shortAxisP2Display = canvasToDisplayPoint(
                  viewport,
                  getViewportElementById('axial'),
                  viewport.worldToCanvas(axes.shortAxisP2) as Types.Point2
                );

                // Find the text overlay for this annotation
                const textOverlay = annotationOverlays.find(o => o.annotationUID === annotation.annotationUID);

                const firstPointCanvas = viewport.worldToCanvas(firstPoint) as Types.Point2;
                const firstPointDisplay = canvasToDisplayPoint(
                  viewport,
                  getViewportElementById('axial'),
                  firstPointCanvas
                );

                return (
                  <svg
                    key={`${annotation.annotationUID}-${axisLinesKey}`}
                    className="absolute top-0 left-0 pointer-events-none"
                    style={{ width: '100%', height: '100%' }}
                  >
                    {/* Connector line from text to polygon (yellow dashed) */}
                    {textOverlay && firstPointCanvas && (
                      <line
                        x1={textOverlay.x}
                        y1={textOverlay.y}
                        x2={firstPointDisplay[0]}
                        y2={firstPointDisplay[1]}
                        stroke="#ffff00"
                        strokeWidth="1"
                        strokeDasharray="3,3"
                        opacity="0.6"
                      />
                    )}

                    {/* Long axis line (red) */}
                    <line
                      x1={longAxisP1Display[0]}
                      y1={longAxisP1Display[1]}
                      x2={longAxisP2Display[0]}
                      y2={longAxisP2Display[1]}
                      stroke="#ff0000"
                      strokeWidth="2"
                      strokeDasharray="5,5"
                    />

                    {/* Short axis line (cyan) */}
                    <line
                      x1={shortAxisP1Display[0]}
                      y1={shortAxisP1Display[1]}
                      x2={shortAxisP2Display[0]}
                      y2={shortAxisP2Display[1]}
                      stroke="#00ffff"
                      strokeWidth="2"
                      strokeDasharray="5,5"
                    />
                  </svg>
                );
              });
            })()}
          </div>
          )}

          {/* Sagittal View */}
          {(!maximizedViewport || maximizedViewport === 'sagittal') && (
            <div className={`relative bg-black border border-slate-700 ${maximizedViewport === 'sagittal' ? 'w-full h-full' : ''}`} style={{ order: 3 }}>
              <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                Sagittal {maximizedViewport === 'sagittal' && '(Maximized - Double-click to restore)'}
              </div>
              <div
                ref={elementRefs.sagittal}
                className="w-full h-full"
                style={{ minHeight: '300px' }}
                onDoubleClick={() => handleViewportDoubleClick('sagittal')}
              />
              {renderAnnotationOverlayElements('sagittal')}

            {/* Custom labels for line annotations (Sagittal) */}
            {(() => {
              const viewport = renderingEngineRef.current?.getViewport('sagittal');
              if (!viewport) return null;

              const annotations = cornerstoneTools.annotation.state.getAllAnnotations();
              // Sagittal only shows MPRLongAxisLine (not AxialLine)
              const lineAnnotations = annotations.filter((ann: any) =>
                ann?.metadata?.toolName === 'MPRLongAxisLine' &&
                ann?.data?.handles?.points?.length === 2 &&
                annotationLabels[ann.annotationUID] &&
                // Only show labels for annotations in current renderMode
                (!ann?.metadata?.renderMode || ann.metadata.renderMode === renderMode)
              );

              return lineAnnotations.map((annotation: any) => {
                const label = annotationLabels[annotation.annotationUID];
                if (!label) return null;

                // Get the midpoint of the line
                const p1 = annotation.data.handles.points[0];
                const p2 = annotation.data.handles.points[1];
                const midpoint: Types.Point3 = [
                  (p1[0] + p2[0]) / 2,
                  (p1[1] + p2[1]) / 2,
                  (p1[2] + p2[2]) / 2
                ];

                // MPRLongAxisLine labels always show in sagittal/coronal (no depth check needed)
                // They span the full volume

                // Convert to canvas coordinates
                const canvasPoint = viewport.worldToCanvas(midpoint) as Types.Point2;
                const viewportElement = getViewportElementById('sagittal');
                const displayPoint = canvasToDisplayPoint(viewport, viewportElement, canvasPoint);

                // Check if point is visible
                const canvas = viewport.canvas;
                if (canvasPoint[0] < -50 || canvasPoint[0] > canvas.width + 50 ||
                    canvasPoint[1] < -50 || canvasPoint[1] > canvas.height + 50) {
                  return null;
                }

                return (
                  <div
                    key={annotation.annotationUID}
                    className="absolute z-50"
                    style={{
                      left: `${displayPoint[0]}px`,
                      top: `${displayPoint[1] - 30}px`,
                      transform: 'translateX(-50%)'
                    }}
                  >
                    <div
                      style={{
                        color: label.color,
                        fontSize: '15px',
                        fontFamily: 'Arial, sans-serif',
                        fontWeight: 'bold',
                        textShadow: '1px 1px 3px rgba(0, 0, 0, 1), -1px -1px 3px rgba(0, 0, 0, 1)',
                        whiteSpace: 'nowrap',
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        border: `1px solid ${label.color}`,
                        cursor: 'pointer'
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setViewportContextMenu(null);
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          annotationUID: annotation.annotationUID,
                          viewportId: 'sagittal'
                        });
                      }}
                    >
                      {label.text}
                    </div>
                  </div>
                );
              });
            })()}

            {/* CPR Height Indicator Lines (Sagittal) */}
            {cprHeightIndicators.filter(ind => ind.viewportId === 'sagittal').length > 0 && elementRefs.sagittal.current && (() => {
              const rect = elementRefs.sagittal.current.getBoundingClientRect();
              const viewportWidth = rect.width;

              return (
                <svg
                  className="absolute top-0 left-0 pointer-events-none"
                  style={{ width: '100%', height: '100%', zIndex: 20 }}
                >
                  {cprHeightIndicators
                    .filter(ind => ind.viewportId === 'sagittal')
                    .map((indicator, index) => {
                      // Calculate actual pixel position from the right
                      const xPosition = viewportWidth - (50 + index * 40);

                      return (
                        <g key={indicator.id}>
                          {/* Vertical line from annulus to clicked position */}
                          <line
                            x1={xPosition}
                            y1={indicator.y1}
                            x2={xPosition}
                            y2={indicator.y2}
                            stroke="#ffff00"
                            strokeWidth="2"
                          />

                          {/* Arrow markers at both ends - pointing down/up */}
                          {/* Top arrow (pointing down) */}
                          <polygon
                            points={`${xPosition - 5},${indicator.y1} ${xPosition + 5},${indicator.y1} ${xPosition},${indicator.y1 + 8}`}
                            fill="#ffff00"
                          />
                          {/* Bottom arrow (pointing up) */}
                          <polygon
                            points={`${xPosition - 5},${indicator.y2} ${xPosition + 5},${indicator.y2} ${xPosition},${indicator.y2 - 8}`}
                            fill="#ffff00"
                          />

                          {/* Label showing height at midpoint */}
                          <text
                            x={xPosition - 8}
                            y={(indicator.y1 + indicator.y2) / 2}
                            fill="#ffff00"
                            fontSize="13"
                            fontWeight="bold"
                            textAnchor="end"
                            dominantBaseline="middle"
                            style={{
                              paintOrder: 'stroke',
                              stroke: 'black',
                              strokeWidth: '3px',
                              strokeLinejoin: 'round'
                            }}
                          >
                            {Math.abs(indicator.height).toFixed(2)} mm
                          </text>
                        </g>
                      );
                    })}
                </svg>
              );
            })()}
          </div>
          )}

          {/* Coronal View */}
          {(!maximizedViewport || maximizedViewport === 'coronal') && (
            <div className={`relative bg-black border border-slate-700 ${maximizedViewport === 'coronal' ? 'w-full h-full' : ''}`} style={{ order: 2 }}>
              <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                Coronal {maximizedViewport === 'coronal' && '(Maximized - Double-click to restore)'}
              </div>
              <div
                ref={elementRefs.coronal}
                className="w-full h-full"
                style={{ minHeight: '300px' }}
                onDoubleClick={() => handleViewportDoubleClick('coronal')}
              />
              {renderAnnotationOverlayElements('coronal')}

            {/* Custom labels for line annotations (Coronal) */}
            {(() => {
              const viewport = renderingEngineRef.current?.getViewport('coronal');
              if (!viewport) return null;

              const annotations = cornerstoneTools.annotation.state.getAllAnnotations();
              // Coronal only shows MPRLongAxisLine (not AxialLine)
              const lineAnnotations = annotations.filter((ann: any) =>
                ann?.metadata?.toolName === 'MPRLongAxisLine' &&
                ann?.data?.handles?.points?.length === 2 &&
                annotationLabels[ann.annotationUID] &&
                // Only show labels for annotations in current renderMode
                (!ann?.metadata?.renderMode || ann.metadata.renderMode === renderMode)
              );

              return lineAnnotations.map((annotation: any) => {
                const label = annotationLabels[annotation.annotationUID];
                if (!label) return null;

                // Get the midpoint of the line
                const p1 = annotation.data.handles.points[0];
                const p2 = annotation.data.handles.points[1];
                const midpoint: Types.Point3 = [
                  (p1[0] + p2[0]) / 2,
                  (p1[1] + p2[1]) / 2,
                  (p1[2] + p2[2]) / 2
                ];

                // MPRLongAxisLine labels always show in sagittal/coronal (no depth check needed)
                // They span the full volume

                // Convert to canvas coordinates
                const canvasPoint = viewport.worldToCanvas(midpoint) as Types.Point2;
                const viewportElement = getViewportElementById('coronal');
                const displayPoint = canvasToDisplayPoint(viewport, viewportElement, canvasPoint);

                // Check if point is visible
                const canvas = viewport.canvas;
                if (canvasPoint[0] < -50 || canvasPoint[0] > canvas.width + 50 ||
                    canvasPoint[1] < -50 || canvasPoint[1] > canvas.height + 50) {
                  return null;
                }

                return (
                  <div
                    key={annotation.annotationUID}
                    className="absolute z-50"
                    style={{
                      left: `${displayPoint[0]}px`,
                      top: `${displayPoint[1] - 30}px`,
                      transform: 'translateX(-50%)'
                    }}
                  >
                    <div
                      style={{
                        color: label.color,
                        fontSize: '15px',
                        fontFamily: 'Arial, sans-serif',
                        fontWeight: 'bold',
                        textShadow: '1px 1px 3px rgba(0, 0, 0, 1), -1px -1px 3px rgba(0, 0, 0, 1)',
                        whiteSpace: 'nowrap',
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        border: `1px solid ${label.color}`,
                        cursor: 'pointer'
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setViewportContextMenu(null);
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          annotationUID: annotation.annotationUID,
                          viewportId: 'coronal'
                        });
                      }}
                    >
                      {label.text}
                    </div>
                  </div>
                );
              });
            })()}

            {/* CPR Height Indicator Lines (Coronal) */}
            {cprHeightIndicators.filter(ind => ind.viewportId === 'coronal').length > 0 && elementRefs.coronal.current && (() => {
              const rect = elementRefs.coronal.current.getBoundingClientRect();
              const viewportWidth = rect.width;

              return (
                <svg
                  className="absolute top-0 left-0 pointer-events-none"
                  style={{ width: '100%', height: '100%', zIndex: 20 }}
                >
                  {cprHeightIndicators
                    .filter(ind => ind.viewportId === 'coronal')
                    .map((indicator, index) => {
                      // Calculate actual pixel position from the right
                      const xPosition = viewportWidth - (50 + index * 40);

                      return (
                        <g key={indicator.id}>
                          {/* Vertical line from annulus to clicked position */}
                          <line
                            x1={xPosition}
                            y1={indicator.y1}
                            x2={xPosition}
                            y2={indicator.y2}
                            stroke="#ffff00"
                            strokeWidth="2"
                          />

                          {/* Arrow markers at both ends - pointing down/up */}
                          {/* Top arrow (pointing down) */}
                          <polygon
                            points={`${xPosition - 5},${indicator.y1} ${xPosition + 5},${indicator.y1} ${xPosition},${indicator.y1 + 8}`}
                            fill="#ffff00"
                          />
                          {/* Bottom arrow (pointing up) */}
                          <polygon
                            points={`${xPosition - 5},${indicator.y2} ${xPosition + 5},${indicator.y2} ${xPosition},${indicator.y2 - 8}`}
                            fill="#ffff00"
                          />

                          {/* Label showing height at midpoint */}
                          <text
                            x={xPosition - 8}
                            y={(indicator.y1 + indicator.y2) / 2}
                            fill="#ffff00"
                            fontSize="13"
                            fontWeight="bold"
                            textAnchor="end"
                            dominantBaseline="middle"
                            style={{
                              paintOrder: 'stroke',
                              stroke: 'black',
                              strokeWidth: '3px',
                              strokeLinejoin: 'round'
                            }}
                          >
                            {Math.abs(indicator.height).toFixed(2)} mm
                          </text>
                        </g>
                      );
                    })}
                </svg>
              );
            })()}
          </div>
          )}
            </>
          )}
        </div>

        {labelModal && labelModal.visible && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            onClick={() => setLabelModal(null)}
          >
            <div
              className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl p-6 min-w-[400px]"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-white text-xl font-bold mb-4 flex items-center gap-2">
                <FaTag />
                {labelModal.currentLabel ? 'Edit Label' : 'Add Label'}
              </h2>

              <div className="space-y-4">
                {/* Text Input */}
                <div>
                  <label className="block text-white text-sm font-medium mb-2">
                    Label Text
                  </label>
                  <input
                    type="text"
                    value={labelModal.currentLabel}
                    onChange={(e) => setLabelModal({ ...labelModal, currentLabel: e.target.value })}
                    placeholder="e.g., Annulus, LVOT, Sinus dimension"
                    className="w-full px-3 py-2 bg-slate-700 text-white border border-slate-600 rounded focus:outline-none focus:border-blue-500"
                    autoFocus
                  />
                </div>

                {/* Color Picker */}
                <div>
                  <label className="block text-white text-sm font-medium mb-2">
                    Label Color
                  </label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={labelModal.currentColor}
                      onChange={(e) => setLabelModal({ ...labelModal, currentColor: e.target.value })}
                      className="w-16 h-10 bg-slate-700 border border-slate-600 rounded cursor-pointer"
                    />
                    <span className="text-white text-sm">{labelModal.currentColor}</span>
                  </div>
                  {/* Preset colors */}
                  <div className="flex gap-2 mt-2">
                    {['#ffff00', '#ff0000', '#00ff00', '#00ffff', '#ff00ff', '#ffffff'].map(color => (
                      <button
                        key={color}
                        onClick={() => setLabelModal({ ...labelModal, currentColor: color })}
                        className="w-8 h-8 rounded border-2 border-slate-600 hover:border-white transition-colors"
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex gap-3 justify-end mt-6">
                  <button
                    onClick={() => setLabelModal(null)}
                    className="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (labelModal.currentLabel.trim()) {
                        // Save to state for backward compatibility
                        setAnnotationLabels(prev => ({
                          ...prev,
                          [labelModal.annotationUID]: {
                            text: labelModal.currentLabel.trim(),
                            color: labelModal.currentColor
                          }
                        }));

                        // Save to annotation metadata (same system used by workflow)
                        const annotations = cornerstoneTools.annotation.state.getAllAnnotations();
                        const annotation = annotations.find((ann: any) => ann.annotationUID === labelModal.annotationUID);
                        if (annotation) {
                          // Save to customLabel in metadata (used by both workflow and manual labels)
                          if (!annotation.metadata) annotation.metadata = {};
                          annotation.metadata.customLabel = {
                            text: labelModal.currentLabel.trim(),
                            color: labelModal.currentColor
                          };

                          // Invalidate to trigger re-render
                          annotation.invalidated = true;
                          renderingEngineRef.current?.render();
                        }
                      }
                      setLabelModal(null);
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Global Context Menu */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={(() => {
              if (contextMenu.annotationUID === 'cpr-position-line' && contextMenu.cprLineData) {
                return [
                  {
                    label: `Height: ${Math.abs(contextMenu.cprLineData.distanceFromAnnulus).toFixed(2)} mm`,
                    icon: <FaRuler />,
                    onClick: () => {
                      const data = contextMenu.cprLineData;
                      const viewport = renderingEngineRef.current?.getViewport(data.viewportId);
                      if (viewport) {
                        const canvas = viewport.getCanvas() as HTMLCanvasElement;
                        const element = data.viewportId === 'sagittal' ? elementRefs.sagittal.current : elementRefs.coronal.current;
                        if (element && canvas) {
                          const rect = element.getBoundingClientRect();
                          const canvasHeight = canvas.height;
                          const displayHeight = rect.height;
                          const y1Display = (data.annulusYPixel / canvasHeight) * displayHeight;
                          const y2Display = (data.clickedYPixel / canvasHeight) * displayHeight;

                          const newIndicator = {
                            id: `height-${Date.now()}`,
                            viewportId: data.viewportId,
                            y1: y1Display,
                            y2: y2Display,
                            height: data.distanceFromAnnulus,
                          };
                          setCprHeightIndicators((prev) => [...prev, newIndicator]);
                        }
                      }
                    },
                  },
                ];
              }

              if (contextMenu.annotationUID) {
                const annotations = cornerstoneTools.annotation.state.getAllAnnotations();
                const annotation = annotations.find((ann: any) => ann.annotationUID === contextMenu.annotationUID);
                const existingLabel = annotation?.metadata?.customLabel;
                const stateLabel = annotationLabels[contextMenu.annotationUID];

                return [
                  {
                    label: stateLabel?.text || existingLabel?.text ? 'Edit Label' : 'Add Label',
                    icon: <FaTag />,
                    onClick: () => {
                      setLabelModal({
                        visible: true,
                        annotationUID: contextMenu.annotationUID,
                        currentLabel: stateLabel?.text || existingLabel?.text || '',
                        currentColor: stateLabel?.color || existingLabel?.color || '#ffff00',
                      });
                    },
                  },
                  {
                    label: 'Delete Annotation',
                    icon: <FaTrash />,
                    onClick: () => {
                      deleteAnnotation(contextMenu.annotationUID);
                    },
                  },
                ];
              }

              return [];
            })()}
            onClose={() => setContextMenu(null)}
          />
        )}
        {viewportContextMenu && (
          <ContextMenu
            x={viewportContextMenu.x}
            y={viewportContextMenu.y}
            items={getViewportMenuItems(viewportContextMenu.viewportId)}
            onClose={() => setViewportContextMenu(null)}
          />
        )}

        {/* Workflow Confirmation Button - Show when measurement is complete but not confirmed */}
        {workflowControlled && measurementReadyForConfirm && currentWorkflowStep && onConfirmMeasurement && (
          <div className="absolute top-4 right-4 z-50">
            <button
              onClick={() => {
                if (currentMeasurementData && onMeasurementComplete) {
                  // Call the measurement complete callback with stored data
                  onMeasurementComplete(
                    currentWorkflowStep.id,
                    currentMeasurementData.annotationUID,
                    currentMeasurementData.measuredValue
                  );
                }
                // Reset state
                setMeasurementReadyForConfirm(false);
                setCurrentMeasurementData(null);
                // Call confirm callback to advance workflow
                onConfirmMeasurement();
              }}
              className="flex items-center gap-3 px-6 py-4 bg-green-600 hover:bg-green-700 text-white rounded-lg shadow-2xl transition-all duration-200 hover:scale-105 border-2 border-green-400"
            >
              <FaCheck className="text-2xl" />
              <div className="text-left">
                <div className="font-bold text-lg">Confirm Measurement</div>
                <div className="text-xs text-green-200">Click to advance to next step</div>
              </div>
            </button>
          </div>
        )}
      </div>
    );
  };

export default ProperMPRViewport;
