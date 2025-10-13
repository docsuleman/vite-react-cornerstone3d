import React, { useState, useEffect } from 'react';
import { FaUser, FaStethoscope, FaEye, FaRuler, FaCog, FaChevronRight, FaCheck, FaExclamationTriangle, FaCircle, FaTrash, FaFileAlt, FaCrosshairs, FaAdjust, FaSearchPlus, FaHandPaper, FaDotCircle, FaDrawPolygon, FaSquare, FaDraftingCompass } from 'react-icons/fa';
import appIcon from '../assets/app-icon.png';
import PatientSearch from './PatientSearch';
import LeftSidebarSteps from './LeftSidebarSteps';
import MultiPhaseModal from './MultiPhaseModal';
// import HybridCPRViewport from './HybridCPRViewport'; // Disabled - ImageCPRMapper not suitable for data extraction
import CornerstoneCPRViewport from './CornerstoneCPRViewport';
import TriViewCPRViewport from './TriViewCPRViewport'; // Pure VTK.js CPR with working rotation
import TrueCPRViewport from './TrueCPRViewport'; // Fixed volume loading with voxelManager approach
import ProperMPRViewport from './ProperMPRViewport';
import MeasurementWorkflowPanel from './MeasurementWorkflowPanel';
import MeasurementReportPage from './MeasurementReportPage';
import { useWorkflowState } from '../hooks/useWorkflowState';
import { WorkflowStage, RootPointType } from '../types/WorkflowTypes';
import { Study, Series, dicomWebService } from '../services/DicomWebService';
import { getWorkflowManager } from '../utils/MeasurementWorkflowManager';
import { MeasurementStep } from '../types/MeasurementWorkflowTypes';
import * as cornerstoneTools from '@cornerstonejs/tools';
import createImageIdsAndCacheMetaData from '../lib/createImageIdsAndCacheMetaData';

interface TAVIAppProps {
  // Props for integrating with existing Cornerstone3D setup
}

const TAVIApp: React.FC<TAVIAppProps> = () => {
  const [showPatientSearch, setShowPatientSearch] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [viewType, setViewType] = useState<'mpr' | 'cpr'>('mpr'); // Toggle between MPR and CPR views
  const [deleteWarningModal, setDeleteWarningModal] = useState<{
    visible: boolean;
    targetStage: WorkflowStage;
  } | null>(null);

  // Multi-phase detection state
  const [showPhaseModal, setShowPhaseModal] = useState(false);
  const [pendingStudy, setPendingStudy] = useState<Study | null>(null);
  const [availableSeries, setAvailableSeries] = useState<Series[]>([]);

  const { state, actions, canAdvanceToStage, getCurrentStageProgress, getStageTitle } = useWorkflowState();

  // Toolbar state management
  const [activeTool, setActiveTool] = useState<string>('SphereMarker');
  const [requestedTool, setRequestedTool] = useState<string>('SphereMarker');
  const [windowLevelPreset, setWindowLevelPreset] = useState<string>('cardiac');

  // Measurement workflow manager
  const [workflowManager] = useState(() => getWorkflowManager());
  const [workflowSteps, setWorkflowSteps] = useState<MeasurementStep[]>([]);
  const [currentWorkflowStep, setCurrentWorkflowStep] = useState<MeasurementStep | null>(null);


  useEffect(() => {
    // Initialize the workflow with patient selection
    if (state.currentStage === WorkflowStage.PATIENT_SELECTION && !state.patientInfo) {
      setShowPatientSearch(true);
    }
  }, [state.currentStage, state.patientInfo]);

  // Initialize measurement workflow when entering MEASUREMENTS stage
  useEffect(() => {
    if (state.currentStage === WorkflowStage.MEASUREMENTS && !state.measurementWorkflowActive) {
      console.log('🎯 Initializing measurement workflow');

      workflowManager.reset();
      const workflow = workflowManager.loadWorkflow();
      setWorkflowSteps(workflow.measurements);

      const firstStep = workflowManager.setCurrentStepIndex(0);
      setCurrentWorkflowStep(firstStep);

      actions.startMeasurementWorkflow();
      actions.setMeasurementStepIndex(0);

      if (firstStep) {
        const initialTool = workflowManager.getToolNameForStep(firstStep);
        setRequestedTool(initialTool);
        setActiveTool(initialTool);
      }
    }
  }, [state.currentStage, state.measurementWorkflowActive, workflowManager, actions]);

  useEffect(() => {
    if (state.currentStage !== WorkflowStage.MEASUREMENTS || !currentWorkflowStep) {
      return;
    }

    const stepIndex = workflowSteps.findIndex(step => step.id === currentWorkflowStep.id);
    if (stepIndex !== -1 && state.currentMeasurementStepIndex !== stepIndex) {
      actions.setMeasurementStepIndex(stepIndex);
    }

    const desiredTool = workflowManager.getToolNameForStep(currentWorkflowStep);
    if (desiredTool) {
      setRequestedTool(desiredTool);
      setActiveTool(desiredTool);
    }
  }, [
    state.currentStage,
    currentWorkflowStep,
    workflowSteps,
    state.currentMeasurementStepIndex,
    actions,
    workflowManager
  ]);

  useEffect(() => {
    if (state.currentStage !== WorkflowStage.MEASUREMENTS || workflowSteps.length === 0) {
      return;
    }

    const desiredIndex = Math.min(
      Math.max(state.currentMeasurementStepIndex ?? 0, 0),
      workflowSteps.length - 1
    );
    const desiredStep = workflowSteps[desiredIndex];

    if (!desiredStep) {
      return;
    }

    if (!currentWorkflowStep || currentWorkflowStep.id !== desiredStep.id) {
      setCurrentWorkflowStep(desiredStep);
      const managerStep = workflowManager.setCurrentStepIndex(desiredIndex) ?? desiredStep;
      const tool = workflowManager.getToolNameForStep(managerStep);
      setRequestedTool(tool);
      setActiveTool(tool);
    }
  }, [
    state.currentStage,
    workflowSteps,
    state.currentMeasurementStepIndex,
    currentWorkflowStep,
    workflowManager
  ]);

  // Auto-activate centerline tool in ROOT_DEFINITION stage
  useEffect(() => {
    if (state.currentStage === WorkflowStage.ROOT_DEFINITION) {
      setRequestedTool('SphereMarker');
      setActiveTool('SphereMarker');
    } else if (state.currentStage === WorkflowStage.ANNULUS_DEFINITION) {
      setRequestedTool('CuspNadir');
      setActiveTool('CuspNadir');
    }
  }, [state.currentStage]);

  const handlePatientSelected = async (study: Study, series: Series) => {
    setShowPatientSearch(false);

    try {
      // Check if the SELECTED series has multiple phases within it
      // by using the phase detection from createImageIdsAndCacheMetaData
      console.log(`🔍 Checking for multiple phases in series ${series.SeriesInstanceUID}`);

      // Temporarily load metadata to detect phases
      const { phaseInfo } = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: study.StudyInstanceUID,
        SeriesInstanceUID: series.SeriesInstanceUID,
        wadoRsRoot: dicomWebService.getWadoRsRoot()
      });

      console.log(`📊 Phase detection result:`, phaseInfo);

      // If this series has multiple phases, show phase selection modal
      if (phaseInfo.isMultiPhase && phaseInfo.totalPhases > 1) {
        console.log(`✨ Found ${phaseInfo.totalPhases} phases in series - showing phase modal`);
        setPendingStudy(study);
        // Store the series with phase info
        setAvailableSeries([series]); // Just one series, but with multiple phases inside
        setShowPhaseModal(true);
      } else {
        // Single phase - proceed directly
        console.log(`➡️ Single phase detected - proceeding directly`);
        proceedWithSeries(study, series);
      }
    } catch (error) {
      console.error('Failed to detect cardiac phases:', error);
      // Fallback: proceed with the selected series
      proceedWithSeries(study, series);
    }
  };

  const proceedWithSeries = (study: Study, series: Series) => {
    actions.setPatientInfo({
      patientID: study.PatientID,
      patientName: study.PatientName,
      studyInstanceUID: study.StudyInstanceUID,
      seriesInstanceUID: series.SeriesInstanceUID,
    });

    actions.setStage(WorkflowStage.ROOT_DEFINITION);
  };

  const handlePhaseSelected = (series: Series) => {
    if (pendingStudy) {
      proceedWithSeries(pendingStudy, series);
    }
    setShowPhaseModal(false);
    setPendingStudy(null);
    setAvailableSeries([]);
  };

  const handlePhaseSkip = () => {
    if (pendingStudy && availableSeries.length > 0) {
      // Use the first series as default
      proceedWithSeries(pendingStudy, availableSeries[0]);
    }
    setShowPhaseModal(false);
    setPendingStudy(null);
    setAvailableSeries([]);
  };

  const handleStageChange = (stage: WorkflowStage) => {
    if (canAdvanceToStage(stage)) {
      // Check if transitioning to ANNULUS_DEFINITION with existing measurement annotations
      if (stage === WorkflowStage.ANNULUS_DEFINITION && state.currentStage === WorkflowStage.MEASUREMENTS) {
        // Show warning modal
        setDeleteWarningModal({
          visible: true,
          targetStage: stage
        });
      } else {
        actions.setStage(stage);
      }
    }
  };

  const confirmStageChange = () => {
    if (deleteWarningModal) {
      actions.setStage(deleteWarningModal.targetStage);
      setDeleteWarningModal(null);
    }
  };

  // Handle activating a measurement step
  const handleActivateMeasurementStep = (step: MeasurementStep) => {
    setCurrentWorkflowStep(step);

    // Update the workflow state's current step index
    const stepIndex = workflowSteps.findIndex(s => s.id === step.id);
    if (stepIndex !== -1) {
      actions.setMeasurementStepIndex(stepIndex);
      const managerStep = workflowManager.setCurrentStepIndex(stepIndex); // Also update workflow manager for consistency
      if (managerStep) {
        setCurrentWorkflowStep(managerStep);
        const nextTool = workflowManager.getToolNameForStep(managerStep);
        setRequestedTool(nextTool);
        setActiveTool(nextTool);
      }
    }

    // The ProperMPRViewport will receive this step and auto-activate the tool
  };

  // Handle completing a measurement step
  const handleCompleteMeasurementStep = () => {
    const currentStep = workflowManager.getCurrentStep();
    if (!currentStep) return;

    // Mark step complete (for now without annotation UID - will be added by viewport)
    workflowManager.completeCurrentStep('temp-uid'); // Placeholder
    actions.completeMeasurementStep(currentStep.id, 'temp-uid');

    // Move to next step
    const nextStep = workflowManager.getCurrentStep();
    setCurrentWorkflowStep(nextStep);
    if (nextStep) {
      const tool = workflowManager.getToolNameForStep(nextStep);
      setRequestedTool(tool);
      setActiveTool(tool);
    }

    if (!nextStep) {
      actions.markStageComplete(WorkflowStage.MEASUREMENTS);
    }
  };

  // Handle toolbar button clicks
  const handleToolClick = (toolName: string) => {
    setRequestedTool(toolName);
    setActiveTool(toolName);
  };

  // Handle crop Apply button
  const handleApplyCrop = () => {
    try {
      // Get RectangleROI annotations from Cornerstone Tools
      const { annotation } = cornerstoneTools;
      const annotationManager = annotation.state.getAnnotationManager();
      const rectangleAnnotations = annotationManager.getAnnotations('RectangleROI');

      if (!rectangleAnnotations || rectangleAnnotations.length === 0) {
        console.warn('⚠️ No crop box found. Please draw a rectangle ROI first.');
        actions.addWarning('No crop box found. Please draw a rectangle ROI on the viewport first.');
        return;
      }

      // Use the most recent annotation
      const cropAnnotation = rectangleAnnotations[rectangleAnnotations.length - 1];
      const points = cropAnnotation.data.handles.points;

      if (!points || points.length < 4) {
        console.error('❌ Invalid crop annotation');
        return;
      }

      // Calculate bounding box in world coordinates
      const xCoords = points.map(p => p[0]);
      const yCoords = points.map(p => p[1]);
      const zCoords = points.map(p => p[2]);

      const worldBounds: [number, number, number, number, number, number] = [
        Math.min(...xCoords),
        Math.max(...xCoords),
        Math.min(...yCoords),
        Math.max(...yCoords),
        Math.min(...zCoords),
        Math.max(...zCoords)
      ];

      // TODO: Convert world bounds to voxel space
      // For now, use world bounds for both (will be refined when 3D viewport integration is complete)
      const volumeCropInfo = {
        bounds: worldBounds,
        worldBounds: worldBounds,
        appliedAt: WorkflowStage.ROOT_DEFINITION,
        timestamp: Date.now()
      };

      actions.setVolumeCrop(volumeCropInfo);
      console.log('✅ Crop applied:', volumeCropInfo);
      console.log('📦 Crop bounds (world):', worldBounds);
    } catch (error) {
      console.error('❌ Failed to apply crop:', error);
      actions.addError('Failed to apply crop. Please try again.');
    }
  };

  // Handle crop Reset button
  const handleResetCrop = () => {
    try {
      // Clear crop from workflow state
      actions.clearVolumeCrop();

      // Remove all RectangleROI annotations
      const { annotation } = cornerstoneTools;
      const annotationManager = annotation.state.getAnnotationManager();
      const rectangleAnnotations = annotationManager.getAnnotations('RectangleROI');

      if (rectangleAnnotations && rectangleAnnotations.length > 0) {
        rectangleAnnotations.forEach(ann => {
          annotationManager.removeAnnotation(ann.annotationUID);
        });
      }

      console.log('🔄 Crop reset - all crop boxes cleared');

      // TODO: Optionally initialize a default cardiac crop box
      // This would create a ~150x150x150mm box centered on the volume
    } catch (error) {
      console.error('❌ Failed to reset crop:', error);
      actions.addError('Failed to reset crop.');
    }
  };

  const getStageIcon = (stage: WorkflowStage) => {
    switch (stage) {
      case WorkflowStage.PATIENT_SELECTION:
        return <FaUser className="text-lg" />;
      case WorkflowStage.ROOT_DEFINITION:
        return <FaStethoscope className="text-lg" />;
      case WorkflowStage.ANNULUS_DEFINITION:
        return <FaCog className="text-lg" />;
      case WorkflowStage.MEASUREMENTS:
        return <FaRuler className="text-lg" />;
      case WorkflowStage.REPORT:
        return <FaFileAlt className="text-lg" />;
      default:
        return <FaCog className="text-lg" />;
    }
  };

  const getStageStatus = (stage: WorkflowStage) => {
    if (state.currentStage === stage) {
      return 'current';
    } else if (state.isStageComplete[stage]) {
      return 'completed';
    } else if (canAdvanceToStage(stage)) {
      return 'available';
    } else {
      return 'locked';
    }
  };

  const getStageColor = (status: string) => {
    switch (status) {
      case 'current':
        return 'bg-blue-600 text-white border-blue-500';
      case 'completed':
        return 'bg-green-600 text-white border-green-500';
      case 'available':
        return 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600';
      case 'locked':
        return 'bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed';
      default:
        return 'bg-gray-700 text-gray-200 border-gray-600';
    }
  };

  const renderWorkflowHeader = () => (
    <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white border-b border-slate-700 flex-shrink-0">
      {/* Main Header */}
      <div className="px-6 py-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-white p-2 rounded-lg">
              <img src={appIcon} alt="QuanTAVI" className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">QuanTAVI</h1>
              <p className="text-slate-300 text-xs">Quantitative TAVI Planning · by Dr. Suleman</p>
            </div>
          </div>

          {state.patientInfo && (
            <div className="bg-slate-700 rounded-lg px-3 py-2 text-right">
              <div className="font-semibold text-base">{state.patientInfo.patientName || 'Unknown Patient'}</div>
              <div className="text-slate-300 text-xs">ID: {state.patientInfo.patientID || 'Unknown ID'}</div>
            </div>
          )}
        </div>
      </div>

      {/* Workflow Progress - FIXED HEIGHT to prevent viewport shifting */}
      <div className="px-6 pb-3">
        <div className="grid grid-cols-5 gap-2">
          {Object.values(WorkflowStage).map((stage, index) => {
            const status = getStageStatus(stage);
            const progress = state.currentStage === stage ? getCurrentStageProgress() : 0;
            
            return (
              <div key={stage} className="relative">
                <div
                  className={`p-2 rounded-lg border-2 transition-all duration-200 cursor-pointer ${getStageColor(status)} min-h-[70px] flex flex-col`}
                  onClick={() => handleStageChange(stage)}
                >
                  {/* Stage Header */}
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1">
                      <div className="text-sm">{getStageIcon(stage)}</div>
                      <span className="text-xs font-semibold">Step {index + 1}</span>
                    </div>
                    {status === 'completed' && <FaCheck className="text-white text-xs" />}
                    {status === 'locked' && <FaExclamationTriangle className="text-gray-400 text-xs" />}
                  </div>

                  {/* Stage Title - SINGLE LINE with ellipsis */}
                  <div className="text-xs font-medium leading-tight truncate" title={getStageTitle(stage)}>
                    {getStageTitle(stage)}
                  </div>

                  {/* Progress Bar */}
                  {status === 'current' && progress > 0 && (
                    <div className="mt-auto pt-1 w-full bg-blue-800 rounded-full h-1">
                      <div
                        className="bg-white h-1 rounded-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </div>

                {/* Arrow */}
                {index < Object.values(WorkflowStage).length - 1 && (
                  <div className="absolute top-1/2 -right-1 transform -translate-y-1/2 z-10">
                    <FaChevronRight className="text-slate-600 text-xs" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderToolPanel = () => (
    <div className="w-80 bg-slate-900 text-white border-l border-slate-700 flex flex-col min-h-0 overflow-y-auto">
      {/* Logo and App Name */}
      <div className="p-6 border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-white p-2 rounded-lg">
            <img src={appIcon} alt="QuanTAVI" className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">QuanTAVI</h1>
            <p className="text-slate-400 text-xs">TAVI Planning</p>
          </div>
        </div>

        {/* Patient Information */}
        {state.patientInfo && (
          <div className="inline-flex items-center gap-2 bg-slate-800/70 border border-slate-700/70 rounded px-2 py-1.5">
            <span className="text-[11px] font-medium text-slate-100 truncate max-w-[140px]">
              {state.patientInfo.patientName || 'Unknown Patient'}
            </span>
            <span className="text-[10px] text-slate-400 whitespace-nowrap">
              ID: {state.patientInfo.patientID || 'Unknown ID'}
            </span>
          </div>
        )}
      </div>

      {/* Toolbar */}
      {state.patientInfo && (state.currentStage === WorkflowStage.ROOT_DEFINITION ||
                              state.currentStage === WorkflowStage.ANNULUS_DEFINITION ||
                              state.currentStage === WorkflowStage.MEASUREMENTS) && (
        <div className="px-3 py-2 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Tools</h4>
            <div className="flex items-center gap-1.5">
              <label htmlFor="wl-preset" className="text-[10px] text-slate-400 uppercase tracking-wide">W/L</label>
              <select
                id="wl-preset"
                value={windowLevelPreset}
                onChange={(e) => setWindowLevelPreset(e.target.value)}
                className="bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="cardiac">Cardiac (-180/220)</option>
                <option value="soft-tissue">Soft Tissue (40/400)</option>
                <option value="lung">Lung (-500/1500)</option>
                <option value="bone">Bone (400/1800)</option>
                <option value="angio">Angio (300/600)</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-5 gap-1">
            <button
              onClick={() => handleToolClick('Crosshairs')}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${
                activeTool === 'Crosshairs'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
              title="Crosshairs"
            >
              <FaCrosshairs className="text-sm" />
            </button>
            <button
              onClick={() => handleToolClick('WindowLevel')}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${
                activeTool === 'WindowLevel'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
              title="Window/Level"
            >
              <FaAdjust className="text-sm" />
            </button>
            <button
              onClick={() => handleToolClick('Zoom')}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${
                activeTool === 'Zoom'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
              title="Zoom"
            >
              <FaSearchPlus className="text-sm" />
            </button>
            <button
              onClick={() => handleToolClick('Pan')}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${
                activeTool === 'Pan'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
              title="Pan"
            >
              <FaHandPaper className="text-sm" />
            </button>
            {state.currentStage === WorkflowStage.ROOT_DEFINITION && (
              <button
                onClick={() => handleToolClick('SphereMarker')}
                className={`p-1.5 rounded transition-colors flex items-center justify-center ${
                  activeTool === 'SphereMarker'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
                title="Centerline Tool"
              >
                <FaDotCircle className="text-sm" />
              </button>
            )}
            {state.currentStage === WorkflowStage.ANNULUS_DEFINITION && (
              <button
                onClick={() => handleToolClick('CuspNadir')}
                className={`p-1.5 rounded transition-colors flex items-center justify-center ${
                  activeTool === 'CuspNadir'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
                title="Cusp Nadir"
              >
                <FaDotCircle className="text-sm" />
              </button>
            )}
            {state.currentStage === WorkflowStage.MEASUREMENTS && (
              <>
                <button
                  onClick={() => handleToolClick('SmoothPolygon')}
                  className={`p-1.5 rounded transition-colors flex items-center justify-center ${
                    activeTool === 'SmoothPolygon'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                  title="Polygon"
                >
                  <FaDrawPolygon className="text-sm" />
                </button>
                <button
                  onClick={() => handleToolClick('Angle')}
                  className={`p-1.5 rounded transition-colors flex items-center justify-center ${
                    activeTool === 'Angle'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                  title="Angle"
                >
                  <FaDraftingCompass className="text-sm" />
                </button>
                <button
                  onClick={() => handleToolClick('AxialLine')}
                  className={`p-1.5 rounded transition-colors flex items-center justify-center ${
                    activeTool === 'AxialLine'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                  title="Length"
                >
                  <FaRuler className="text-sm" />
                </button>
              </>
            )}
          </div>
        </div>
      )}



      {/* Tools Section - Replace with Measurement Workflow Panel for MEASUREMENTS stage */}
      {state.currentStage === WorkflowStage.MEASUREMENTS ? (
        <MeasurementWorkflowPanel
          steps={workflowSteps}
          currentStepIndex={state.currentMeasurementStepIndex}
          completedStepIds={state.completedMeasurementSteps}
          annulusArea={state.measurements.annulus?.area}
          onActivateStep={handleActivateMeasurementStep}
          onCompleteStep={handleCompleteMeasurementStep}
        />
      ) : (
        <div className="flex-1 p-6 overflow-y-auto">
          <div className="space-y-3">
            {state.currentStage === WorkflowStage.ROOT_DEFINITION && (
              <div className="text-slate-300 text-sm">
                <p className="mb-2">Click on the viewport to place centerline points.</p>
                <p className="text-xs text-slate-400 mt-2">
                  • Place at least 3 points along the aorta<br/>
                  • First: LV outflow tract<br/>
                  • Middle: Aortic valve<br/>
                  • Last: Ascending aorta
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Errors and Warnings */}
      {(state.errors.length > 0 || state.warnings.length > 0) && (
        <div className="border-t border-slate-700 p-6">
          {state.errors.length > 0 && (
            <div className="mb-3">
              <h5 className="text-red-400 font-semibold mb-2">Errors</h5>
              <div className="space-y-1">
                {state.errors.map((error, index) => (
                  <div key={index} className="text-red-300 text-sm bg-red-900/20 p-2 rounded">{error}</div>
                ))}
              </div>
            </div>
          )}
          
          {state.warnings.length > 0 && (
            <div>
              <h5 className="text-yellow-400 font-semibold mb-2">Warnings</h5>
              <div className="space-y-1">
                {state.warnings.map((warning, index) => (
                  <div key={index} className="text-yellow-300 text-sm bg-yellow-900/20 p-2 rounded">{warning}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderViewportArea = () => (
    <div className="flex-1 bg-black min-h-0">
      {state.currentStage === WorkflowStage.PATIENT_SELECTION ? (
        <div className="h-full flex items-center justify-center">
          <div className="text-center text-gray-400">
            <div className="bg-slate-800 p-8 rounded-2xl max-w-md mx-auto">
              <FaUser className="text-6xl mb-6 mx-auto text-blue-500" />
              <h3 className="text-2xl mb-4 text-white">Select Patient</h3>
              <p className="text-slate-300 mb-6">Choose a patient and series to begin TAVI planning</p>
              <button
                onClick={() => setShowPatientSearch(true)}
                className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
              >
                Search Patients
              </button>
            </div>
          </div>
        </div>
      ) : state.currentStage === WorkflowStage.REPORT && state.patientInfo ? (
        <div className="flex-1 bg-white overflow-hidden">
          <MeasurementReportPage
            patientInfo={state.patientInfo}
            measurements={state.measurements}
            completedSteps={workflowSteps.filter(step => state.completedMeasurementSteps.includes(step.id))}
            onClose={() => actions.setStage(WorkflowStage.MEASUREMENTS)}
          />
        </div>
      ) : (state.currentStage === WorkflowStage.ROOT_DEFINITION ||
            state.currentStage === WorkflowStage.ANNULUS_DEFINITION ||
            state.currentStage === WorkflowStage.MEASUREMENTS) && state.patientInfo ? (
        <ProperMPRViewport
            renderMode={viewType}
            onRenderModeChange={setViewType}
            patientInfo={state.patientInfo}
            currentStage={state.currentStage}
            existingSpheres={state.rootPoints.map((point) => ({
              id: point.id,
              pos: point.position as [number, number, number],
              // Color based on anatomical type, not index (important for refinement points)
              color: point.type === RootPointType.AORTIC_VALVE ? 'red' : 'yellow'
            }))}
            currentWorkflowStep={currentWorkflowStep}
            workflowControlled={state.currentStage === WorkflowStage.MEASUREMENTS && state.measurementWorkflowActive}
            annularPlane={state.annularPlane ? {
              center: state.annularPlane.center as [number, number, number],
              normal: state.annularPlane.normal as [number, number, number]
            } : undefined}
            annulusArea={state.measurements.annulus?.area}
            centerlineData={state.centerline}
            onActiveToolChange={setActiveTool}
            requestedTool={requestedTool}
            windowLevelPreset={windowLevelPreset}
            initializeCropBox={state.currentStage === WorkflowStage.ROOT_DEFINITION}
            onMeasurementComplete={(stepId, annotationUID, measuredValue) => {
              // Complete the step in workflow manager and state
              workflowManager.completeCurrentStep(annotationUID, measuredValue);
              actions.completeMeasurementStep(stepId, annotationUID, measuredValue);

              // Move to next step
              const nextStep = workflowManager.getCurrentStep();
              setCurrentWorkflowStep(nextStep);

              if (!nextStep) {
                actions.markStageComplete(WorkflowStage.MEASUREMENTS);
              }
            }}
            onConfirmMeasurement={() => {
              // This is called when user clicks tick button on viewport
              // The onMeasurementComplete callback above has already been called
            }}
            onImageLoaded={(imageData) => {
              console.log('DICOM images loaded for stage:', state.currentStage);
            }}
            onSpherePositionsUpdate={(spheres) => {
              if (spheres.length >= 3) {
                // Clear existing root points first
                actions.clearRootPoints();

                // CRITICAL: Assign proper anatomical types
                // When exactly 3 spheres: LV_OUTFLOW, AORTIC_VALVE, ASCENDING_AORTA
                // When more than 3: First and last keep their types, middle is valve, rest are EXTENDED
                spheres.forEach((sphere, index) => {
                  let type: string;

                  if (spheres.length === 3) {
                    // First 3 spheres: assign specific anatomical types
                    if (index === 0) {
                      type = RootPointType.LV_OUTFLOW;
                    } else if (index === 1) {
                      type = RootPointType.AORTIC_VALVE;
                    } else {
                      type = RootPointType.ASCENDING_AORTA;
                    }
                  } else {
                    // More than 3 spheres: first, middle, last are anatomical, rest are extended
                    const middleIndex = Math.floor(spheres.length / 2);
                    if (index === 0) {
                      type = RootPointType.LV_OUTFLOW;
                    } else if (index === middleIndex) {
                      type = RootPointType.AORTIC_VALVE;
                    } else if (index === spheres.length - 1) {
                      type = RootPointType.ASCENDING_AORTA;
                    } else {
                      type = RootPointType.EXTENDED;
                    }
                  }

                  const rootPoint = {
                    id: sphere.id,
                    position: sphere.pos,
                    type: type,
                    timestamp: Date.now()
                  };
                  actions.addRootPoint(rootPoint);
                });

                // Mark ROOT_DEFINITION stage as complete when we have 3+ points
                actions.markStageComplete(WorkflowStage.ROOT_DEFINITION);
              }
            }}
            onCuspDotsUpdate={async (dots) => {
              if (dots.length === 3) {
                console.log('3 cusp nadir dots placed in MPR, updating annulus points');

                // Clear existing annulus points first
                actions.clearAnnulusPoints();

                // Map cusp dots to annulus points with proper type conversion
                const cuspTypeMapping = {
                  'left': 'left_coronary_cusp',
                  'right': 'right_coronary_cusp',
                  'non-coronary': 'non_coronary_cusp'
                };

                const annulusPoints: any[] = [];

                dots.forEach((dot) => {
                  const annulusPoint = {
                    id: dot.id,
                    position: dot.pos,
                    type: cuspTypeMapping[dot.cuspType] || dot.cuspType,
                    timestamp: Date.now()
                  };
                  actions.addAnnulusPoint(annulusPoint);
                  annulusPoints.push(annulusPoint);
                });

                // Calculate annular plane and measurements from the 3 cusp points
                try {
                  const { AnnulusCalculator } = await import('../utils/AnnulusCalculator');
                  const annularPlane = AnnulusCalculator.calculateAnnularPlane(annulusPoints);
                  actions.setAnnularPlane(annularPlane);

                  // Calculate initial annulus measurements
                  const area = AnnulusCalculator.calculateAnnulusArea(annulusPoints);
                  const perimeter = AnnulusCalculator.calculateAnnulusPerimeter(annulusPoints);
                  const diameter = AnnulusCalculator.calculateAnnulusDiameter(annulusPoints);

                  const annulusMeasurements = {
                    area: area,
                    perimeter: perimeter,
                    areaDerivedDiameter: Math.sqrt(4 * area / Math.PI), // Diameter from area
                    perimeterDerivedDiameter: perimeter / Math.PI, // Diameter from perimeter
                    polygonPoints: annulusPoints.map(p => p.position),
                    timestamp: Date.now()
                  };

                  actions.updateMeasurement({ annulus: annulusMeasurements });

                  // Modify centerline to be perpendicular to annular plane
                  const { CenterlineModifier } = await import('../utils/CenterlineModifier');
                  const modifiedCenterline = CenterlineModifier.modifyCenterlineWithAnnulusPlane(
                    state.rootPoints.map(p => ({ x: p.position[0], y: p.position[1], z: p.position[2], type: p.type })),
                    annularPlane
                  );

                  // Update centerline data in workflow state
                  const centerlineData = {
                    position: new Float32Array(modifiedCenterline.flatMap(p => [p.x, p.y, p.z])),
                    orientation: new Float32Array(modifiedCenterline.length * 3), // Will be calculated as needed
                    length: modifiedCenterline.length,
                    generatedFrom: state.rootPoints
                  };

                  actions.setCenterline(centerlineData);

                  console.log('📐 Annular plane calculated from MPR:', annularPlane);
                  console.log('📏 Annulus measurements calculated:', annulusMeasurements);
                  console.log('🔄 Centerline modified to be perpendicular to annular plane (MPR):', {
                    originalPoints: modifiedCenterline.length,
                    storedLength: centerlineData.length,
                    positionArrayLength: centerlineData.position.length
                  });
                  console.log('✅ Annulus definition complete with 3 cusp nadir points');
                } catch (error) {
                  console.error('Failed to calculate annular plane:', error);
                  actions.addError('Failed to calculate annular plane from cusp points');
                }
              }
            }}
          />
      ) : (
        <div className="h-full flex items-center justify-center">
          <div className="text-center text-gray-400">
            <div className="bg-slate-800 p-8 rounded-2xl max-w-md mx-auto">
              <div className="text-6xl mb-6 text-blue-500">{getStageIcon(state.currentStage)}</div>
              <h3 className="text-2xl mb-4 text-white">{getStageTitle(state.currentStage)}</h3>
              {!state.patientInfo ? (
                <p className="text-slate-300">Please select a patient to begin the TAVI planning workflow.</p>
              ) : (
                <p className="text-slate-300">Medical imaging viewport ready for this stage</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-screen bg-slate-900 flex">
      {/* Left narrow sidebar with step indicators */}
      <LeftSidebarSteps
        currentStage={state.currentStage}
        completedStages={state.isStageComplete}
        onStageClick={handleStageChange}
        canAdvanceToStage={canAdvanceToStage}
      />

      {/* Main content area: viewports + right sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {renderViewportArea()}
        {renderToolPanel()}
      </div>

      {showPatientSearch && (
        <PatientSearch
          onSeriesSelected={handlePatientSelected}
          onClose={() => setShowPatientSearch(false)}
        />
      )}

      {/* Multi-Phase Selection Modal */}
      {showPhaseModal && pendingStudy && availableSeries.length > 0 && (
        <MultiPhaseModal
          studyInstanceUID={pendingStudy.StudyInstanceUID}
          series={availableSeries[0]}
          wadoRsRoot={dicomWebService.getWadoRsRoot()}
          onPhaseSelected={(phaseIndex) => {
            // When phase is selected, proceed with the series and phase index
            if (pendingStudy && availableSeries[0]) {
              console.log(`✅ User selected phase ${phaseIndex}`);
              proceedWithSeries(pendingStudy, availableSeries[0]);
              // TODO: Store selected phase index in workflow state
            }
            setShowPhaseModal(false);
            setPendingStudy(null);
            setAvailableSeries([]);
          }}
          onSkip={handlePhaseSkip}
          onClose={() => {
            setShowPhaseModal(false);
            setPendingStudy(null);
            setAvailableSeries([]);
          }}
        />
      )}

      {/* Measurement Report */}
      {showReport && state.patientInfo && (
        <MeasurementReportPage
          patientInfo={state.patientInfo}
          measurements={state.measurements}
          completedSteps={workflowSteps.filter(step => state.completedMeasurementSteps.includes(step.id))}
          onClose={() => setShowReport(false)}
        />
      )}

      {/* Warning Modal for Annotation Deletion */}
      {deleteWarningModal && deleteWarningModal.visible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70"
             onClick={() => setDeleteWarningModal(null)}>
          <div className="bg-slate-800 border-2 border-red-500 rounded-lg shadow-2xl p-8 max-w-md"
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-4 mb-6">
              <div className="bg-red-500 p-3 rounded-full">
                <FaTrash className="text-white text-2xl" />
              </div>
              <div>
                <h2 className="text-white text-2xl font-bold">Warning</h2>
                <p className="text-red-300 text-sm">This action cannot be undone</p>
              </div>
            </div>

            <div className="mb-6">
              <p className="text-white text-lg mb-3">
                Proceeding to <span className="font-bold text-blue-400">Annulus Definition</span> will permanently delete all measurement annotations including:
              </p>
              <ul className="text-slate-300 text-sm space-y-2 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-1">•</span>
                  <span>All polygon measurements with labels</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-1">•</span>
                  <span>All line measurements with labels</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-1">•</span>
                  <span>All measurement overlays and statistics</span>
                </li>
              </ul>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setDeleteWarningModal(null)}
                className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={confirmStageChange}
                className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
              >
                <FaTrash />
                Delete & Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TAVIApp;
