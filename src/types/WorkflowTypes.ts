import { Vector3 } from '@kitware/vtk.js/types';

export enum WorkflowStage {
  PATIENT_SELECTION = 'patient_selection',
  ROOT_DEFINITION = 'root_definition',
  ANNULUS_DEFINITION = 'annulus_definition',
  MEASUREMENTS = 'measurements'
}

export enum RootPointType {
  LV_OUTFLOW = 'lv_outflow',
  AORTIC_VALVE = 'aortic_valve',
  ASCENDING_AORTA = 'ascending_aorta',
  EXTENDED = 'extended'
}

export enum AnnulusPointType {
  RIGHT_CORONARY_CUSP = 'right_coronary_cusp',
  LEFT_CORONARY_CUSP = 'left_coronary_cusp',
  NON_CORONARY_CUSP = 'non_coronary_cusp'
}

export interface RootPoint {
  id: string;
  type: RootPointType;
  position: Vector3;
  timestamp: number;
}

export interface AnnulusPoint {
  id: string;
  type: AnnulusPointType;
  position: Vector3;
  timestamp: number;
}

export interface CenterlineData {
  position: Float32Array;
  orientation: Float32Array;
  length: number;
  generatedFrom: RootPoint[];
}

export interface AnnularPlane {
  center: Vector3;
  normal: Vector3;
  points: AnnulusPoint[];
  confidence: number;
}

export interface AnnulusMeasurements {
  area: number;
  perimeter: number;
  areaDerivedDiameter: number;
  perimeterDerivedDiameter: number;
  polygonPoints: Vector3[];
  timestamp: number;
}

export interface PolygonMeasurements {
  area: number;
  perimeter: number;
  areaDerivedDiameter: number;
  perimeterDerivedDiameter: number;
  polygonPoints: Vector3[];
  timestamp: number;
}

export interface TAVIMeasurements {
  // Existing annulus measurements
  annulus?: AnnulusMeasurements;

  // Workflow-driven measurements
  lvot?: PolygonMeasurements;
  sovMeasurements?: {
    left: number;      // SOV-L line length
    right: number;     // SOV-R line length
    nonCoronary: number; // SOV-N line length
  };
  stj?: PolygonMeasurements;
  ascendingAorta?: PolygonMeasurements;

  // Long axis measurements
  coronaryHeights?: {
    leftCoronary: number;   // LCA height
    rightCoronary: number;  // RCA height
  };
  leafletLengths?: {
    left: number;   // Left leaflet spline length
    right: number;  // Right leaflet spline length
  };
  stjHeight?: number;
  membranousSeptum?: number;

  // Optional measurements
  sinusDistances?: {
    lcaSinus: number;  // LCA-Sinus distance
    rcaSinus: number;  // RCA-Sinus distance
  };

  // Legacy fields for backward compatibility
  sinusHeights?: {
    left: number;
    right: number;
    nonCoronary: number;
  };
  lvotDiameter?: number;
  aorticRootDimensions?: {
    sinotubularJunction: number;
    aorticRoot: number;
  };
}

export interface WorkflowState {
  currentStage: WorkflowStage;
  patientInfo?: {
    patientID: string;
    patientName: string;
    studyInstanceUID: string;
    seriesInstanceUID: string;
  };
  rootPoints: RootPoint[];
  centerline?: CenterlineData;
  annulusPoints: AnnulusPoint[];
  annularPlane?: AnnularPlane;
  measurements: TAVIMeasurements;
  isStageComplete: {
    [WorkflowStage.PATIENT_SELECTION]: boolean;
    [WorkflowStage.ROOT_DEFINITION]: boolean;
    [WorkflowStage.ANNULUS_DEFINITION]: boolean;
    [WorkflowStage.MEASUREMENTS]: boolean;
  };
  // Measurement workflow state
  measurementWorkflowActive: boolean;
  currentMeasurementStepIndex: number;
  completedMeasurementSteps: string[]; // Array of completed step IDs
  errors: string[];
  warnings: string[];
}

export interface WorkflowAction {
  type: string;
  payload?: any;
}

export const WORKFLOW_ACTIONS = {
  SET_STAGE: 'SET_STAGE',
  SET_PATIENT_INFO: 'SET_PATIENT_INFO',
  ADD_ROOT_POINT: 'ADD_ROOT_POINT',
  REMOVE_ROOT_POINT: 'REMOVE_ROOT_POINT',
  CLEAR_ROOT_POINTS: 'CLEAR_ROOT_POINTS',
  SET_CENTERLINE: 'SET_CENTERLINE',
  ADD_ANNULUS_POINT: 'ADD_ANNULUS_POINT',
  REMOVE_ANNULUS_POINT: 'REMOVE_ANNULUS_POINT',
  CLEAR_ANNULUS_POINTS: 'CLEAR_ANNULUS_POINTS',
  SET_ANNULAR_PLANE: 'SET_ANNULAR_PLANE',
  SET_MEASUREMENTS: 'SET_MEASUREMENTS',
  UPDATE_MEASUREMENT: 'UPDATE_MEASUREMENT',
  ADD_ERROR: 'ADD_ERROR',
  ADD_WARNING: 'ADD_WARNING',
  CLEAR_ERRORS: 'CLEAR_ERRORS',
  CLEAR_WARNINGS: 'CLEAR_WARNINGS',
  RESET_WORKFLOW: 'RESET_WORKFLOW',
  MARK_STAGE_COMPLETE: 'MARK_STAGE_COMPLETE',
  // Measurement workflow actions
  START_MEASUREMENT_WORKFLOW: 'START_MEASUREMENT_WORKFLOW',
  SET_MEASUREMENT_STEP_INDEX: 'SET_MEASUREMENT_STEP_INDEX',
  NEXT_MEASUREMENT_STEP: 'NEXT_MEASUREMENT_STEP',
  COMPLETE_MEASUREMENT_STEP: 'COMPLETE_MEASUREMENT_STEP',
  RESET_MEASUREMENT_WORKFLOW: 'RESET_MEASUREMENT_WORKFLOW',
} as const;