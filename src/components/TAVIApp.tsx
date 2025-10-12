import React, { useState, useEffect } from 'react';
import { FaUser, FaStethoscope, FaEye, FaRuler, FaCog, FaChevronRight, FaCheck, FaExclamationTriangle, FaCircle, FaTrash, FaFileAlt } from 'react-icons/fa';
import appIcon from '../assets/app-icon.png';
import PatientSearch from './PatientSearch';
// import HybridCPRViewport from './HybridCPRViewport'; // Disabled - ImageCPRMapper not suitable for data extraction
import CornerstoneCPRViewport from './CornerstoneCPRViewport';
import TriViewCPRViewport from './TriViewCPRViewport'; // Pure VTK.js CPR with working rotation
import TrueCPRViewport from './TrueCPRViewport'; // Fixed volume loading with voxelManager approach
import ProperMPRViewport from './ProperMPRViewport';
import MeasurementWorkflowPanel from './MeasurementWorkflowPanel';
import MeasurementReportPage from './MeasurementReportPage';
import { useWorkflowState } from '../hooks/useWorkflowState';
import { WorkflowStage, RootPointType } from '../types/WorkflowTypes';
import { Study, Series } from '../services/DicomWebService';
import { getWorkflowManager } from '../utils/MeasurementWorkflowManager';
import { MeasurementStep } from '../types/MeasurementWorkflowTypes';

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
  const { state, actions, canAdvanceToStage, getCurrentStageProgress, getStageTitle } = useWorkflowState();

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
      const workflow = workflowManager.loadWorkflow();
      setWorkflowSteps(workflow.measurements);

      const firstStep = workflowManager.getCurrentStep();
      setCurrentWorkflowStep(firstStep);

      actions.startMeasurementWorkflow();
    }
  }, [state.currentStage, state.measurementWorkflowActive, workflowManager, actions]);

  const handlePatientSelected = (study: Study, series: Series) => {
    actions.setPatientInfo({
      patientID: study.PatientID,
      patientName: study.PatientName,
      studyInstanceUID: study.StudyInstanceUID,
      seriesInstanceUID: series.SeriesInstanceUID,
    });

    setShowPatientSearch(false);
    actions.setStage(WorkflowStage.ROOT_DEFINITION);
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
      workflowManager.setCurrentStepIndex(stepIndex); // Also update workflow manager for consistency
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

    if (!nextStep) {
      actions.markStageComplete(WorkflowStage.MEASUREMENTS);
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
    <div className="w-80 bg-slate-900 text-white border-r border-slate-700 flex flex-col min-h-0">
      {/* Current Stage Info */}
      <div className="p-6 border-b border-slate-700">
        <div className="flex items-center gap-3 mb-4">
          {getStageIcon(state.currentStage)}
          <h3 className="text-xl font-semibold">{getStageTitle(state.currentStage)}</h3>
        </div>
        
        {state.currentStage === WorkflowStage.ROOT_DEFINITION && (
          <div className="space-y-3">
            <p className="text-slate-300 text-sm">
              Place 3 spheres to define the aortic root:
            </p>
            <div className="space-y-2">
              <div className={`flex items-center gap-3 p-2 rounded ${state.rootPoints.some(p => p.type === 'lv_outflow') ? 'bg-green-900/30 text-green-300' : 'bg-slate-800 text-slate-400'}`}>
                <FaCircle className="text-green-500 text-xs" />
                <span className="text-sm">1. LV Outflow Tract</span>
              </div>
              <div className={`flex items-center gap-3 p-2 rounded ${state.rootPoints.some(p => p.type === 'aortic_valve') ? 'bg-red-900/30 text-red-300' : 'bg-slate-800 text-slate-400'}`}>
                <FaCircle className="text-red-500 text-xs" />
                <span className="text-sm">2. Aortic Valve Level</span>
              </div>
              <div className={`flex items-center gap-3 p-2 rounded ${state.rootPoints.some(p => p.type === 'ascending_aorta') ? 'bg-yellow-900/30 text-yellow-300' : 'bg-slate-800 text-slate-400'}`}>
                <FaCircle className="text-yellow-500 text-xs" />
                <span className="text-sm">3. Ascending Aorta</span>
              </div>
            </div>
          </div>
        )}

        {state.currentStage === WorkflowStage.ANNULUS_DEFINITION && (
          <div className="space-y-3">
            <p className="text-slate-300 text-sm">
              Mark the nadir of each cusp:
            </p>
            <div className="space-y-2">
              <div className={`flex items-center gap-3 p-2 rounded ${state.annulusPoints.some(p => p.type === 'right_coronary_cusp') ? 'bg-green-900/30 text-green-300' : 'bg-slate-800 text-slate-400'}`}>
                <FaCircle className="text-green-500 text-xs" />
                <span className="text-sm">Right Coronary Cusp</span>
              </div>
              <div className={`flex items-center gap-3 p-2 rounded ${state.annulusPoints.some(p => p.type === 'left_coronary_cusp') ? 'bg-red-900/30 text-red-300' : 'bg-slate-800 text-slate-400'}`}>
                <FaCircle className="text-red-500 text-xs" />
                <span className="text-sm">Left Coronary Cusp</span>
              </div>
              <div className={`flex items-center gap-3 p-2 rounded ${state.annulusPoints.some(p => p.type === 'non_coronary_cusp') ? 'bg-yellow-900/30 text-yellow-300' : 'bg-slate-800 text-slate-400'}`}>
                <FaCircle className="text-yellow-500 text-xs" />
                <span className="text-sm">Non-Coronary Cusp</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* View Type Selector - Only show during MEASUREMENTS stage */}
      {state.patientInfo && state.currentStage === WorkflowStage.MEASUREMENTS && state.rootPoints.length >= 3 && (
        <div className="px-6 py-4 border-b border-slate-700">
          <h4 className="text-sm font-semibold mb-2 text-slate-300">Viewport Mode</h4>
          <div className="flex gap-2">
            <button
              onClick={() => setViewType('mpr')}
              className={`flex-1 px-3 py-2 text-sm rounded transition-colors ${
                viewType === 'mpr'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              <div className="font-medium">Standard MPR</div>
              <div className="text-xs opacity-75">Multiplanar</div>
            </button>
            <button
              onClick={() => setViewType('cpr')}
              className={`flex-1 px-3 py-2 text-sm rounded transition-colors ${
                viewType === 'cpr'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              <div className="font-medium">CPR View</div>
              <div className="text-xs opacity-75">Straightened</div>
            </button>
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
              </div>
            )}
          </div>
        </div>
      )}

      {/* Measurements Panel */}
      {Object.keys(state.measurements).length > 0 && (
        <div className="border-t border-slate-700 p-6">
          <div className="flex justify-between items-center mb-4">
            <h4 className="text-lg font-semibold text-slate-200">Measurements</h4>
            {state.completedMeasurementSteps.length > 0 && (
              <button
                onClick={() => setShowReport(true)}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm flex items-center gap-2 transition-colors"
              >
                <FaFileAlt />
                View Report
              </button>
            )}
          </div>

          {state.measurements.annulus && (
            <div className="bg-slate-800 rounded-lg p-4">
              <h5 className="font-semibold text-blue-400 mb-3">Annulus Measurements</h5>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-slate-700 p-2 rounded">
                  <div className="text-slate-400">Area</div>
                  <div className="font-medium">{state.measurements.annulus.area.toFixed(1)} mm²</div>
                </div>
                <div className="bg-slate-700 p-2 rounded">
                  <div className="text-slate-400">Perimeter</div>
                  <div className="font-medium">{state.measurements.annulus.perimeter.toFixed(1)} mm</div>
                </div>
                <div className="bg-slate-700 p-2 rounded">
                  <div className="text-slate-400">Area Ø</div>
                  <div className="font-medium">{state.measurements.annulus.areaDerivedDiameter.toFixed(1)} mm</div>
                </div>
                <div className="bg-slate-700 p-2 rounded">
                  <div className="text-slate-400">Perim Ø</div>
                  <div className="font-medium">{state.measurements.annulus.perimeterDerivedDiameter.toFixed(1)} mm</div>
                </div>
              </div>
            </div>
          )}
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
      ) : (state.currentStage === WorkflowStage.ROOT_DEFINITION ||
            state.currentStage === WorkflowStage.ANNULUS_DEFINITION ||
            state.currentStage === WorkflowStage.MEASUREMENTS) && state.patientInfo ? (
        <ProperMPRViewport
            renderMode={viewType}
            patientInfo={state.patientInfo}
            currentStage={state.currentStage}
            existingSpheres={state.rootPoints.map((point, index) => ({
              id: point.id,
              pos: point.position as [number, number, number],
              color: index === 0 ? 'yellow' : index === 1 ? 'red' : 'green'
            }))}
            currentWorkflowStep={currentWorkflowStep}
            workflowControlled={state.currentStage === WorkflowStage.MEASUREMENTS && state.measurementWorkflowActive}
            annularPlane={state.annularPlane ? {
              center: state.annularPlane.center as [number, number, number],
              normal: state.annularPlane.normal as [number, number, number]
            } : undefined}
            annulusArea={state.measurements.annulus?.area}
            centerlineData={state.centerline}
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
                console.log(`${spheres.length} spheres placed, updating root points`);

                // Clear existing root points first
                actions.clearRootPoints();

                // Map spheres to root points with anatomical types for first 3, extended for rest
                const rootPointTypes = [RootPointType.LV_OUTFLOW, RootPointType.AORTIC_VALVE, RootPointType.ASCENDING_AORTA];

                spheres.forEach((sphere, index) => {
                  const rootPoint = {
                    id: sphere.id,
                    position: sphere.pos,
                    type: index < 3 ? rootPointTypes[index] : RootPointType.EXTENDED,
                    timestamp: Date.now()
                  };
                  actions.addRootPoint(rootPoint);
                });

                console.log(`Root definition updated with ${spheres.length} points`);
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
    <div className="h-screen bg-slate-900 flex flex-col">
      {renderWorkflowHeader()}
      
      <div className="flex-1 flex overflow-hidden">
        {renderToolPanel()}
        {renderViewportArea()}
      </div>

      {showPatientSearch && (
        <PatientSearch
          onSeriesSelected={handlePatientSelected}
          onClose={() => setShowPatientSearch(false)}
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