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

export interface TAVIMeasurements {
  annulus?: AnnulusMeasurements;
  coronaryHeights?: {
    leftCoronary: number;
    rightCoronary: number;
  };
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
} as const;