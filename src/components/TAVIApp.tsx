import React, { useState, useEffect } from 'react';
import { FaUser, FaStethoscope, FaEye, FaRuler, FaCog, FaChevronRight, FaCheck, FaExclamationTriangle, FaCircle } from 'react-icons/fa';
import PatientSearch from './PatientSearch';
// import HybridCPRViewport from './HybridCPRViewport'; // Disabled - ImageCPRMapper not suitable for data extraction
import CornerstoneCPRViewport from './CornerstoneCPRViewport';
// import TriViewCPRViewport from './TriViewCPRViewport'; // Replaced with pure Cornerstone3D CPR approach
import TrueCPRViewport from './TrueCPRViewport'; // Fixed volume loading with voxelManager approach
import ProperMPRViewport from './ProperMPRViewport';
import { useWorkflowState } from '../hooks/useWorkflowState';
import { WorkflowStage, RootPointType } from '../types/WorkflowTypes';
import { Study, Series } from '../services/DicomWebService';

interface TAVIAppProps {
  // Props for integrating with existing Cornerstone3D setup
}

const TAVIApp: React.FC<TAVIAppProps> = () => {
  const [showPatientSearch, setShowPatientSearch] = useState(false);
  const { state, actions, canAdvanceToStage, getCurrentStageProgress, getStageTitle } = useWorkflowState();

  useEffect(() => {
    // Initialize the workflow with patient selection
    if (state.currentStage === WorkflowStage.PATIENT_SELECTION && !state.patientInfo) {
      setShowPatientSearch(true);
    }
  }, [state.currentStage, state.patientInfo]);

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
      actions.setStage(stage);
    }
  };

  const getStageIcon = (stage: WorkflowStage) => {
    switch (stage) {
      case WorkflowStage.PATIENT_SELECTION:
        return <FaUser className="text-lg" />;
      case WorkflowStage.ROOT_DEFINITION:
        return <FaStethoscope className="text-lg" />;
      case WorkflowStage.CPR_ANALYSIS:
        return <FaEye className="text-lg" />;
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
    <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white border-b border-slate-700">
      {/* Main Header */}
      <div className="px-6 py-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="bg-blue-600 p-3 rounded-xl">
              <FaStethoscope className="text-2xl text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">TAVI Planning Workstation</h1>
              <p className="text-slate-300 text-sm mt-1">Transcatheter Aortic Valve Implantation</p>
            </div>
          </div>
          
          {state.patientInfo && (
            <div className="bg-slate-700 rounded-lg px-4 py-3 text-right">
              <div className="font-semibold text-lg">{state.patientInfo.patientName || 'Unknown Patient'}</div>
              <div className="text-slate-300 text-sm">ID: {state.patientInfo.patientID || 'Unknown ID'}</div>
            </div>
          )}
        </div>
      </div>

      {/* Workflow Progress */}
      <div className="px-6 pb-4">
        <div className="grid grid-cols-5 gap-3">
          {Object.values(WorkflowStage).map((stage, index) => {
            const status = getStageStatus(stage);
            const progress = state.currentStage === stage ? getCurrentStageProgress() : 0;
            
            return (
              <div key={stage} className="relative">
                <div
                  className={`p-4 rounded-lg border-2 transition-all duration-200 cursor-pointer ${getStageColor(status)}`}
                  onClick={() => handleStageChange(stage)}
                >
                  {/* Stage Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {getStageIcon(stage)}
                      <span className="text-xs font-semibold">Step {index + 1}</span>
                    </div>
                    {status === 'completed' && <FaCheck className="text-white" />}
                    {status === 'locked' && <FaExclamationTriangle className="text-gray-400" />}
                  </div>
                  
                  {/* Stage Title */}
                  <div className="text-sm font-medium leading-tight">
                    {getStageTitle(stage)}
                  </div>
                  
                  {/* Progress Bar */}
                  {status === 'current' && progress > 0 && (
                    <div className="mt-2 w-full bg-blue-800 rounded-full h-1.5">
                      <div 
                        className="bg-white h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </div>
                
                {/* Arrow */}
                {index < Object.values(WorkflowStage).length - 1 && (
                  <div className="absolute top-1/2 -right-1.5 transform -translate-y-1/2 z-10">
                    <FaChevronRight className="text-slate-600 text-sm" />
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

      {/* Tools Section */}
      <div className="flex-1 p-6 overflow-y-auto">
        <h4 className="text-lg font-semibold mb-4 text-slate-200">Available Tools</h4>
        
        <div className="space-y-3">
          {state.currentStage === WorkflowStage.ROOT_DEFINITION && (
            <button className="w-full p-4 bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-3 transition-colors text-left">
              <FaCircle className="text-white text-sm" />
              <div>
                <div className="font-medium">Sphere Marker Tool</div>
                <div className="text-xs text-blue-200">Mark anatomical landmarks</div>
              </div>
            </button>
          )}
          
          {state.currentStage === WorkflowStage.ANNULUS_DEFINITION && (
            <>
              <button className="w-full p-4 bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-3 transition-colors text-left">
                <FaCircle className="text-white text-sm" />
                <div>
                  <div className="font-medium">Annulus Sphere Tool</div>
                  <div className="text-xs text-blue-200">Mark cusp nadir points</div>
                </div>
              </button>
              <button className="w-full p-4 bg-purple-600 hover:bg-purple-700 rounded-lg flex items-center gap-3 transition-colors text-left">
                <FaRuler className="text-white" />
                <div>
                  <div className="font-medium">Polygon Measurement</div>
                  <div className="text-xs text-purple-200">Trace annulus outline</div>
                </div>
              </button>
            </>
          )}
          
          {state.currentStage === WorkflowStage.MEASUREMENTS && (
            <>
              <button className="w-full p-4 bg-green-600 hover:bg-green-700 rounded-lg flex items-center gap-3 transition-colors text-left">
                <FaRuler className="text-white" />
                <div>
                  <div className="font-medium">Length Tool</div>
                  <div className="text-xs text-green-200">Measure distances</div>
                </div>
              </button>
              <button className="w-full p-4 bg-yellow-600 hover:bg-yellow-700 rounded-lg flex items-center gap-3 transition-colors text-left">
                <FaRuler className="text-white" />
                <div>
                  <div className="font-medium">Angle Tool</div>
                  <div className="text-xs text-yellow-200">Measure angles</div>
                </div>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Measurements Panel */}
      {Object.keys(state.measurements).length > 0 && (
        <div className="border-t border-slate-700 p-6">
          <h4 className="text-lg font-semibold mb-4 text-slate-200">Measurements</h4>
          
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
      ) : state.currentStage === WorkflowStage.CPR_ANALYSIS && state.rootPoints.length >= 3 ? (
        <div className="h-full flex flex-col">
          {/* CPR Header */}
          <div className="bg-slate-800 border-b border-slate-700 p-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">CPR Analysis - Real Aortic Root Extraction</h3>
                <p className="text-sm text-slate-400">Hybrid approach: real DICOM data + simple rendering from {state.rootPoints.length} defined points</p>
              </div>
              <button
                onClick={() => {
                  actions.markStageComplete(WorkflowStage.CPR_ANALYSIS);
                  handleStageChange(WorkflowStage.ANNULUS_DEFINITION);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
              >
                Proceed to Annulus Definition
              </button>
            </div>
          </div>
          
          {/* CPR Viewport Container */}
          <div className="flex-1 relative bg-black">
            <TrueCPRViewport
              patientInfo={state.patientInfo}
              rootPoints={state.rootPoints.map(point => ({
                x: point.position[0],
                y: point.position[1],
                z: point.position[2]
              }))}
              stage="analysis"
              width={800}
              height={600}
              backgroundColor={[0, 0, 0]}
            />
            
            {/* Root Points Info Overlay */}
            <div className="absolute top-4 right-4 bg-slate-800/90 backdrop-blur-sm p-4 rounded-lg">
              <h4 className="text-sm font-medium text-white mb-2">Root Points</h4>
              <div className="space-y-1">
                {state.rootPoints.map((point, index) => (
                  <div key={point.id} className="text-xs text-slate-300">
                    <span className="font-medium">{point.type.replace('_', ' ')}</span>
                    <div className="text-slate-400">
                      ({point.position[0].toFixed(1)}, {point.position[1].toFixed(1)}, {point.position[2].toFixed(1)})
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : state.currentStage === WorkflowStage.ANNULUS_DEFINITION && state.patientInfo && state.rootPoints.length >= 3 ? (
        <TrueCPRViewport
          patientInfo={state.patientInfo}
          rootPoints={state.rootPoints.map(point => ({
            x: point.position[0],
            y: point.position[1],
            z: point.position[2]
          }))}
          stage="annulus_definition"
          onCuspDotsUpdate={(dots) => {
            // Defer state updates to avoid React warning about updating during render
            setTimeout(async () => {
              console.log('🎯 Cusp dots updated, count:', dots.length);
              // TODO: Temporarily disabled annulus plane calculation to debug dot positioning
              if (false && dots.length === 3) {
                console.log('3 cusp nadir dots placed in CPR, updating annulus points');
                
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
                
                console.log('📐 Annular plane calculated:', annularPlane);
                console.log('📏 Annulus measurements calculated:', annulusMeasurements);
                console.log('🔄 Centerline modified to be perpendicular to annular plane:', {
                  originalPoints: modifiedCenterline.length,
                  storedLength: centerlineData.length,
                  positionArrayLength: centerlineData.position.length,
                  firstPoint: { x: centerlineData.position[0], y: centerlineData.position[1], z: centerlineData.position[2] },
                  lastPoint: { 
                    x: centerlineData.position[centerlineData.position.length - 3], 
                    y: centerlineData.position[centerlineData.position.length - 2], 
                    z: centerlineData.position[centerlineData.position.length - 1] 
                  }
                });
                console.log('✅ Annulus definition complete with 3 cusp nadir points');
              } catch (error) {
                console.error('Failed to calculate annular plane:', error);
                actions.addError('Failed to calculate annular plane from cusp points');
              }
              }
            }, 0);
          }}
        />
      ) : (state.currentStage === WorkflowStage.ROOT_DEFINITION || 
            state.currentStage === WorkflowStage.MEASUREMENTS) && state.patientInfo ? (
        <ProperMPRViewport
          patientInfo={state.patientInfo}
          currentStage={state.currentStage}
          onImageLoaded={(imageData) => {
            console.log('DICOM images loaded for stage:', state.currentStage);
          }}
          onSpherePositionsUpdate={(spheres) => {
            if (spheres.length === 3) {
              console.log('3 spheres placed, updating root points');
              
              // Clear existing root points first
              actions.clearRootPoints();
              
              // Map spheres to root points with anatomical types
              const rootPointTypes = [RootPointType.LV_OUTFLOW, RootPointType.AORTIC_VALVE, RootPointType.ASCENDING_AORTA];
              
              spheres.forEach((sphere, index) => {
                const rootPoint = {
                  id: sphere.id,
                  position: sphere.pos,
                  type: rootPointTypes[index],
                  timestamp: Date.now()
                };
                actions.addRootPoint(rootPoint);
              });
              
              console.log('Root definition complete, can now advance to CPR Analysis');
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
              {state.currentStage === WorkflowStage.CPR_ANALYSIS && state.rootPoints.length < 3 ? (
                <p className="text-slate-300">Please complete the Root Definition stage first by placing 3 anatomical markers.</p>
              ) : !state.patientInfo ? (
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
    </div>
  );
};

export default TAVIApp;