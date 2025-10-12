import React, { useState, useEffect, useRef } from 'react';
import { FaHeart, FaSpinner, FaCheck, FaTimes, FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { Series } from '../services/DicomWebService';
import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import createImageIdsAndCacheMetaData from '../lib/createImageIdsAndCacheMetaData';
import { initializeCornerstone } from '../utils/cornerstoneInit';

const { ToolGroupManager, WindowLevelTool, ZoomTool, Enums: csToolsEnums } = cornerstoneTools;

interface PhaseInfo {
  phaseIndex: number;
  phaseId: string | number;
  phaseName: string;
  phasePercent: number | null;
  imageCount: number;
  imageIds: string[];
  sliceThickness?: number;
  pixelSpacing?: [number, number];
}

interface MultiPhaseModalProps {
  studyInstanceUID: string;
  series: Series;
  wadoRsRoot: string;
  onPhaseSelected: (phaseIndex: number) => void;
  onSkip: () => void;
  onClose: () => void;
}

const MultiPhaseModal: React.FC<MultiPhaseModalProps> = ({
  studyInstanceUID,
  series,
  wadoRsRoot,
  onPhaseSelected,
  onSkip,
  onClose
}) => {
  const [phases, setPhases] = useState<PhaseInfo[]>([]);
  const [selectedPhaseIndex, setSelectedPhaseIndex] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [currentSliceIndices, setCurrentSliceIndices] = useState<number[]>([]);

  const viewportGridRef = useRef<HTMLDivElement>(null);
  const renderingEngineRef = useRef<cornerstone.Types.IRenderingEngine | null>(null);
  const viewportIdsRef = useRef<string[]>([]);
  const phasesRef = useRef<PhaseInfo[]>([]);
  const sliceIndicesRef = useRef<number[]>([]);
  const toolGroupRef = useRef<cornerstoneTools.Types.IToolGroup | null>(null);

  useEffect(() => {
    initializeAndLoadPhases();

    return () => {
      // Cleanup
      if (toolGroupRef.current) {
        try {
          ToolGroupManager.destroyToolGroup('PHASE_SELECTION_TOOL_GROUP');
        } catch (e) {
          console.warn('Failed to destroy tool group:', e);
        }
      }
      if (renderingEngineRef.current) {
        try {
          renderingEngineRef.current.destroy();
        } catch (e) {
          console.warn('Failed to destroy rendering engine:', e);
        }
      }
    };
  }, [series]);

  const initializeAndLoadPhases = async () => {
    setIsLoading(true);
    setLoadingProgress(0);

    try {
      // Step 0: Ensure Cornerstone is initialized (0-5% progress)
      await initializeCornerstone();
      setLoadingProgress(5);

      // Step 1: Load metadata and detect phases (5-30% progress)
      const { imageIds, phaseInfo } = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: studyInstanceUID,
        SeriesInstanceUID: series.SeriesInstanceUID,
        wadoRsRoot: wadoRsRoot
      });

      setLoadingProgress(30);

      console.log('📊 Phase info received:', phaseInfo);

      if (!phaseInfo.isMultiPhase || phaseInfo.totalPhases <= 1) {
        console.warn('⚠️ No multiple phases detected in this series');
        setIsLoading(false);
        setPhases([]);
        return;
      }

      // Step 2: Prepare phase info (30-50% progress)
      // We need to get imageIds for each phase separately
      const detectedPhases: PhaseInfo[] = [];

      for (let index = 0; index < phaseInfo.phases.length; index++) {
        const phase = phaseInfo.phases[index];

        // Load imageIds for this specific phase
        console.log(`📦 Loading imageIds for phase ${index}: ${phase.phaseName}`);
        const { imageIds: phaseImageIds } = await createImageIdsAndCacheMetaData({
          StudyInstanceUID: studyInstanceUID,
          SeriesInstanceUID: series.SeriesInstanceUID,
          wadoRsRoot: wadoRsRoot,
          selectedPhase: index  // Select this specific phase
        });

        console.log(`   Got ${phaseImageIds.length} imageIds for phase ${index}`);

        // Get metadata from first image of this phase
        const firstImageId = phaseImageIds[0];
        let sliceThickness = 1.0;
        let pixelSpacing: [number, number] = [1.0, 1.0];

        try {
          // Wait a bit for metadata to be cached
          await new Promise(resolve => setTimeout(resolve, 50));

          const metadata = cornerstone.metaData.get('imagePlaneModule', firstImageId);
          if (metadata) {
            sliceThickness = metadata.sliceThickness || metadata.spacingBetweenSlices || 1.0;
            pixelSpacing = metadata.pixelSpacing || [1.0, 1.0];
          } else {
            console.warn(`⚠️ No metadata for phase ${index}, using defaults`);
          }
        } catch (e) {
          console.warn(`Could not get metadata for phase ${index}:`, e);
        }

        // Determine if systolic (0-40%)
        const isSystolic = phase.phasePercent !== null && phase.phasePercent <= 40;
        const displayName = isSystolic ? `${phase.phaseName} ⭐` : phase.phaseName;

        detectedPhases.push({
          phaseIndex: index,
          phaseId: phase.phaseId,
          phaseName: displayName,
          phasePercent: phase.phasePercent,
          imageCount: phaseImageIds.length,
          imageIds: phaseImageIds,
          sliceThickness,
          pixelSpacing
        });
      }

      // Sort: systolic phases first
      detectedPhases.sort((a, b) => {
        const aIsSystolic = a.phaseName.includes('⭐') ? 1 : 0;
        const bIsSystolic = b.phaseName.includes('⭐') ? 1 : 0;
        return bIsSystolic - aIsSystolic;
      });

      setPhases(detectedPhases);
      phasesRef.current = detectedPhases; // Store in ref for scroll handler
      setLoadingProgress(50);

      // Initialize slice indices (middle slice for each phase)
      const initialIndices = detectedPhases.map(p => Math.floor(p.imageCount / 2));
      setCurrentSliceIndices(initialIndices);
      sliceIndicesRef.current = initialIndices; // Store in ref for scroll handler

      // Step 3: Setup viewports (50-100% progress)
      await setupViewports(detectedPhases);
      setLoadingProgress(100);

      setIsLoading(false);
    } catch (error) {
      console.error('Failed to load phases:', error);
      setIsLoading(false);
    }
  };

  const setupViewports = async (phasesToSetup: PhaseInfo[]) => {
    if (!viewportGridRef.current) {
      console.error('❌ Viewport grid ref not available');
      return;
    }

    try {
      const renderingEngineId = 'PHASE_SELECTION_ENGINE';

      if (renderingEngineRef.current) {
        try {
          renderingEngineRef.current.destroy();
        } catch (e) {
          console.warn('Failed to destroy previous rendering engine:', e);
        }
      }

      console.log('🎨 Creating rendering engine...');
      const renderingEngine = new cornerstone.RenderingEngine(renderingEngineId);
      renderingEngineRef.current = renderingEngine;

      viewportIdsRef.current = [];
      phasesToSetup.forEach((phase, index) => {
        viewportIdsRef.current.push(`phase-viewport-${index}`);
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Enable viewports
      phasesToSetup.forEach((phase, index) => {
        const viewportElement = document.getElementById(`phase-viewport-${index}`);
        if (!viewportElement) {
          console.error(`❌ Viewport element ${index} not found`);
          return;
        }

        const viewportId = `phase-viewport-${index}`;

        try {
          renderingEngine.enableElement({
            viewportId: viewportId,
            type: cornerstone.Enums.ViewportType.STACK,
            element: viewportElement,
            defaultOptions: {
              background: [0, 0, 0] as cornerstone.Types.Point3
            }
          });
          console.log(`✅ Enabled viewport ${index}`);
        } catch (error) {
          console.error(`❌ Failed to enable viewport ${index}:`, error);
        }
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Set stack images for each viewport
      for (let index = 0; index < phasesToSetup.length; index++) {
        const phase = phasesToSetup[index];
        const viewportId = viewportIdsRef.current[index];
        const imageIds = phase.imageIds;

        if (!imageIds || imageIds.length === 0) {
          console.error(`❌ No image IDs for phase ${index}`);
          continue;
        }

        try {
          const viewport = renderingEngine.getViewport(viewportId) as cornerstone.Types.IStackViewport;
          if (!viewport) {
            console.error(`❌ Could not get viewport ${index}`);
            continue;
          }

          const middleSlice = Math.floor(imageIds.length / 2);

          await viewport.setStack(imageIds, middleSlice);

          // Set cardiac CTA window/level: W/L = 600/300
          // voiRange: lower = level - window/2, upper = level + window/2
          viewport.setProperties({
            voiRange: {
              lower: 300 - 600 / 2,    // 300 - 300 = 0
              upper: 300 + 600 / 2     // 300 + 300 = 600
            }
          });

          viewport.render();

          const appliedProps = viewport.getProperties();
          console.log(`✅ Viewport ${index} rendered with slice ${middleSlice + 1}/${imageIds.length}`);
          console.log(`   VOI Range: ${appliedProps.voiRange?.lower} to ${appliedProps.voiRange?.upper}`);
        } catch (error) {
          console.error(`❌ Failed to setup viewport ${index}:`, error);
        }
      }

      // Setup tool group for interactive windowing and zoom
      const toolGroupId = 'PHASE_SELECTION_TOOL_GROUP';

      // Register tools globally first (if not already registered)
      try {
        cornerstoneTools.addTool(WindowLevelTool);
        cornerstoneTools.addTool(ZoomTool);
        console.log('✅ Tools registered globally');
      } catch (e) {
        // Tools might already be registered, which is fine
        console.log('ℹ️ Tools already registered');
      }

      // Destroy existing tool group if it exists
      let toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (toolGroup) {
        ToolGroupManager.destroyToolGroup(toolGroupId);
      }

      // Create new tool group
      toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
      toolGroupRef.current = toolGroup;

      // Add tools to the tool group
      toolGroup.addTool(WindowLevelTool.toolName);
      toolGroup.addTool(ZoomTool.toolName);

      // Set WindowLevelTool active on right mouse button
      toolGroup.setToolActive(WindowLevelTool.toolName, {
        bindings: [
          {
            mouseButton: csToolsEnums.MouseBindings.Secondary, // Right mouse button
          },
        ],
      });

      // Set ZoomTool active on middle mouse button
      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [
          {
            mouseButton: csToolsEnums.MouseBindings.Auxiliary, // Middle mouse button
          },
        ],
      });

      // Add all viewports to the tool group
      viewportIdsRef.current.forEach(viewportId => {
        toolGroup!.addViewport(viewportId, renderingEngineId);
      });

      console.log('🛠️ Tool group configured: Right-click for W/L, Middle-click for Zoom');

      // Add mouse wheel scroll handlers AFTER all viewports are set up
      phasesToSetup.forEach((phase, index) => {
        const viewportElement = document.getElementById(`phase-viewport-${index}`);
        if (viewportElement) {
          // Remove any existing listeners first
          const existingListener = (viewportElement as any).__wheelListener;
          if (existingListener) {
            viewportElement.removeEventListener('wheel', existingListener);
          }

          // Create new listener and store reference
          const wheelListener = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY > 0 ? 1 : -1;
            handleSliceScroll(index, delta);
          };

          (viewportElement as any).__wheelListener = wheelListener;
          viewportElement.addEventListener('wheel', wheelListener, { passive: false });

          console.log(`🖱️ Mouse wheel attached to viewport ${index}`);
        }
      });

      console.log('🎉 All viewports setup complete');
    } catch (error) {
      console.error('❌ Failed to setup viewports:', error);
      throw error;
    }
  };

  const handleSliceScroll = (phaseIndex: number, delta: number) => {
    // Use refs instead of state to avoid stale closure
    const currentPhases = phasesRef.current;
    const currentIndices = sliceIndicesRef.current;

    if (!currentPhases || phaseIndex >= currentPhases.length || phaseIndex < 0) {
      console.warn(`Invalid scroll: phaseIndex=${phaseIndex}, phases.length=${currentPhases?.length}`);
      return;
    }

    const phase = currentPhases[phaseIndex];
    if (!phase || !phase.imageIds || phase.imageIds.length === 0) {
      console.warn(`Invalid phase data for index ${phaseIndex}`);
      return;
    }

    const maxSlice = phase.imageIds.length - 1;
    const currentSlice = currentIndices[phaseIndex] || 0;
    const newSlice = Math.max(0, Math.min(maxSlice, currentSlice + delta));

    console.log(`🔄 Scroll phase ${phaseIndex}: ${currentSlice} → ${newSlice} (delta: ${delta}, max: ${maxSlice})`);

    if (newSlice !== currentSlice) {
      // Update ref immediately
      sliceIndicesRef.current[phaseIndex] = newSlice;

      // Update state for UI
      setCurrentSliceIndices(prev => {
        const newIndices = [...prev];
        newIndices[phaseIndex] = newSlice;
        return newIndices;
      });

      // Update viewport
      const viewportId = viewportIdsRef.current[phaseIndex];
      if (renderingEngineRef.current && viewportId) {
        try {
          const viewport = renderingEngineRef.current.getViewport(viewportId) as cornerstone.Types.IStackViewport;
          if (viewport) {
            viewport.setImageIdIndex(newSlice);
            viewport.render();
            console.log(`✅ Viewport ${phaseIndex} now showing slice ${newSlice + 1}/${maxSlice + 1}`);
          } else {
            console.error(`❌ Viewport ${phaseIndex} is null`);
          }
        } catch (error) {
          console.error(`❌ Failed to scroll slice for phase ${phaseIndex}:`, error);
        }
      } else {
        console.error(`❌ Rendering engine or viewportId missing for phase ${phaseIndex}`);
      }
    } else {
      console.log(`   Already at slice ${currentSlice} (no change)`);
    }
  };

  const handleConfirm = () => {
    if (phases[selectedPhaseIndex]) {
      onPhaseSelected(phases[selectedPhaseIndex].phaseIndex);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-90"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 border-2 border-blue-500 rounded-xl shadow-2xl max-w-7xl w-full mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 p-6 border-b border-slate-700 flex-shrink-0">
          <div className="bg-blue-500 p-3 rounded-full">
            <FaHeart className="text-white text-2xl" />
          </div>
          <div className="flex-1">
            <h2 className="text-white text-2xl font-bold">Cardiac Phase Selection for TAVI</h2>
            <p className="text-blue-300 text-sm">
              ⭐ Systolic phases (0-40%) are recommended for TAVI planning
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl"
          >
            <FaTimes />
          </button>
        </div>

        {/* Loading State */}
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12">
            <FaSpinner className="text-blue-500 text-5xl animate-spin mb-6" />
            <span className="text-white text-xl mb-4">Loading cardiac phases...</span>
            <div className="w-96 bg-slate-700 rounded-full h-3 overflow-hidden">
              <div
                className="bg-blue-500 h-full transition-all duration-300"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <span className="text-slate-400 text-sm mt-2">{Math.round(loadingProgress)}%</span>
          </div>
        ) : phases.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12">
            <p className="text-slate-400 text-lg mb-4">No multiple phases detected in this series</p>
            <button
              onClick={onSkip}
              className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
            >
              Continue with Series
            </button>
          </div>
        ) : (
          <>
            {/* Viewport Grid */}
            <div
              ref={viewportGridRef}
              className="flex-1 overflow-y-auto p-6"
              style={{
                display: 'grid',
                gridTemplateColumns: phases.length <= 2 ? `repeat(${phases.length}, 1fr)` : 'repeat(3, 1fr)',
                gap: '1rem',
                minHeight: '400px'
              }}
            >
              {phases.map((phase, index) => {
                const isSelected = selectedPhaseIndex === index;
                const currentSlice = currentSliceIndices[index] || 0;
                const totalSlices = phase.imageCount;

                return (
                  <div
                    key={`phase-${phase.phaseIndex}`}
                    className={`relative border-4 rounded-lg overflow-hidden cursor-pointer transition-all ${
                      isSelected
                        ? 'border-blue-500 shadow-xl shadow-blue-500/50'
                        : 'border-slate-600 hover:border-slate-500'
                    }`}
                    style={{ height: '320px' }}
                  >
                    {/* Viewport container */}
                    <div
                      id={`phase-viewport-${index}`}
                      className="absolute inset-0 bg-black"
                      style={{ zIndex: 0 }}
                      onClick={() => setSelectedPhaseIndex(index)}
                    />

                    {/* Overlay Info */}
                    <div className="absolute top-2 left-2 right-2 flex justify-between items-start pointer-events-none" style={{ zIndex: 20 }}>
                      <div className="bg-black/80 rounded px-2 py-1 text-white text-sm font-semibold">
                        {phase.phaseName}
                      </div>
                      <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded">
                        {phase.imageCount} imgs
                      </span>
                    </div>

                    {/* Selection Indicator */}
                    {isSelected && (
                      <div className="absolute top-2 right-2 pointer-events-none" style={{ zIndex: 20 }}>
                        <div className="bg-blue-500 rounded-full p-2">
                          <FaCheck className="text-white text-lg" />
                        </div>
                      </div>
                    )}

                    {/* Slice Controls */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-3 pointer-events-none" style={{ zIndex: 20 }}>
                      <div className="flex items-center justify-between mb-2 pointer-events-auto">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSliceScroll(index, -1);
                          }}
                          className="bg-slate-700/80 hover:bg-slate-600 p-2 rounded transition-colors"
                        >
                          <FaChevronLeft className="text-white" />
                        </button>

                        <div className="text-white text-sm font-mono">
                          Slice {currentSlice + 1} / {totalSlices}
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSliceScroll(index, 1);
                          }}
                          className="bg-slate-700/80 hover:bg-slate-600 p-2 rounded transition-colors"
                        >
                          <FaChevronRight className="text-white" />
                        </button>
                      </div>

                      {/* Phase Info */}
                      <div className="text-xs text-slate-300 space-y-1 pointer-events-auto">
                        {phase.phasePercent !== null && (
                          <div className="flex justify-between">
                            <span>Cardiac Phase:</span>
                            <span className="font-mono">{phase.phasePercent}%</span>
                          </div>
                        )}
                        {phase.sliceThickness && (
                          <div className="flex justify-between">
                            <span>Slice Thickness:</span>
                            <span className="font-mono">{phase.sliceThickness.toFixed(2)} mm</span>
                          </div>
                        )}
                        {phase.pixelSpacing && (
                          <div className="flex justify-between">
                            <span>Pixel Spacing:</span>
                            <span className="font-mono">
                              {phase.pixelSpacing[0].toFixed(2)} × {phase.pixelSpacing[1].toFixed(2)} mm
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 p-6 border-t border-slate-700 flex-shrink-0">
              <button
                onClick={onSkip}
                className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors font-medium flex items-center gap-2"
              >
                <FaTimes />
                Use First Phase
              </button>
              <button
                onClick={handleConfirm}
                disabled={selectedPhaseIndex === null}
                className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
              >
                <FaCheck />
                Use Selected Phase ({phases[selectedPhaseIndex]?.phaseName})
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default MultiPhaseModal;
