import { useReducer, useCallback } from 'react';
import {
  WorkflowState,
  WorkflowStage,
  WorkflowAction,
  WORKFLOW_ACTIONS,
  RootPoint,
  AnnulusPoint,
  RootPointType,
  AnnulusPointType,
  CenterlineData,
  AnnularPlane,
  TAVIMeasurements
} from '../types/WorkflowTypes';

const initialState: WorkflowState = {
  currentStage: WorkflowStage.PATIENT_SELECTION,
  rootPoints: [],
  annulusPoints: [],
  measurements: {},
  isStageComplete: {
    [WorkflowStage.PATIENT_SELECTION]: false,
    [WorkflowStage.ROOT_DEFINITION]: false,
    [WorkflowStage.ANNULUS_DEFINITION]: false,
    [WorkflowStage.MEASUREMENTS]: false,
  },
  errors: [],
  warnings: [],
};

function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  switch (action.type) {
    case WORKFLOW_ACTIONS.SET_STAGE:
      return {
        ...state,
        currentStage: action.payload,
      };

    case WORKFLOW_ACTIONS.SET_PATIENT_INFO:
      return {
        ...state,
        patientInfo: action.payload,
        isStageComplete: {
          ...state.isStageComplete,
          [WorkflowStage.PATIENT_SELECTION]: true,
        },
      };

    case WORKFLOW_ACTIONS.ADD_ROOT_POINT:
      const newRootPoint: RootPoint = action.payload;
      const existingRootPointIndex = state.rootPoints.findIndex(
        p => p.type === newRootPoint.type
      );
      
      let updatedRootPoints: RootPoint[];
      if (existingRootPointIndex >= 0) {
        // Replace existing point of same type
        updatedRootPoints = [...state.rootPoints];
        updatedRootPoints[existingRootPointIndex] = newRootPoint;
      } else {
        // Add new point
        updatedRootPoints = [...state.rootPoints, newRootPoint];
      }

      // Complete when we have at least 3 points
      const rootDefinitionComplete = updatedRootPoints.length >= 3;

      return {
        ...state,
        rootPoints: updatedRootPoints,
        isStageComplete: {
          ...state.isStageComplete,
          [WorkflowStage.ROOT_DEFINITION]: rootDefinitionComplete,
        },
      };

    case WORKFLOW_ACTIONS.REMOVE_ROOT_POINT:
      return {
        ...state,
        rootPoints: state.rootPoints.filter(p => p.id !== action.payload),
        isStageComplete: {
          ...state.isStageComplete,
          [WorkflowStage.ROOT_DEFINITION]: false,
        },
      };

    case WORKFLOW_ACTIONS.CLEAR_ROOT_POINTS:
      return {
        ...state,
        rootPoints: [],
        centerline: undefined,
        isStageComplete: {
          ...state.isStageComplete,
          [WorkflowStage.ROOT_DEFINITION]: false,
        },
      };

    case WORKFLOW_ACTIONS.SET_CENTERLINE:
      return {
        ...state,
        centerline: action.payload,
      };

    case WORKFLOW_ACTIONS.ADD_ANNULUS_POINT:
      const newAnnulusPoint: AnnulusPoint = action.payload;
      const existingAnnulusPointIndex = state.annulusPoints.findIndex(
        p => p.type === newAnnulusPoint.type
      );
      
      let updatedAnnulusPoints: AnnulusPoint[];
      if (existingAnnulusPointIndex >= 0) {
        // Replace existing point of same type
        updatedAnnulusPoints = [...state.annulusPoints];
        updatedAnnulusPoints[existingAnnulusPointIndex] = newAnnulusPoint;
      } else {
        // Add new point
        updatedAnnulusPoints = [...state.annulusPoints, newAnnulusPoint];
      }

      const annulusDefinitionComplete = updatedAnnulusPoints.length === 3 &&
        updatedAnnulusPoints.some(p => p.type === AnnulusPointType.RIGHT_CORONARY_CUSP) &&
        updatedAnnulusPoints.some(p => p.type === AnnulusPointType.LEFT_CORONARY_CUSP) &&
        updatedAnnulusPoints.some(p => p.type === AnnulusPointType.NON_CORONARY_CUSP);

      return {
        ...state,
        annulusPoints: updatedAnnulusPoints,
        isStageComplete: {
          ...state.isStageComplete,
          [WorkflowStage.ANNULUS_DEFINITION]: annulusDefinitionComplete,
        },
      };

    case WORKFLOW_ACTIONS.REMOVE_ANNULUS_POINT:
      return {
        ...state,
        annulusPoints: state.annulusPoints.filter(p => p.id !== action.payload),
        annularPlane: undefined,
        isStageComplete: {
          ...state.isStageComplete,
          [WorkflowStage.ANNULUS_DEFINITION]: false,
        },
      };

    case WORKFLOW_ACTIONS.CLEAR_ANNULUS_POINTS:
      return {
        ...state,
        annulusPoints: [],
        annularPlane: undefined,
        isStageComplete: {
          ...state.isStageComplete,
          [WorkflowStage.ANNULUS_DEFINITION]: false,
        },
      };

    case WORKFLOW_ACTIONS.SET_ANNULAR_PLANE:
      return {
        ...state,
        annularPlane: action.payload,
      };

    case WORKFLOW_ACTIONS.SET_MEASUREMENTS:
      return {
        ...state,
        measurements: action.payload,
        isStageComplete: {
          ...state.isStageComplete,
          [WorkflowStage.MEASUREMENTS]: Object.keys(action.payload).length > 0,
        },
      };

    case WORKFLOW_ACTIONS.UPDATE_MEASUREMENT:
      return {
        ...state,
        measurements: {
          ...state.measurements,
          ...action.payload,
        },
      };

    case WORKFLOW_ACTIONS.ADD_ERROR:
      return {
        ...state,
        errors: [...state.errors, action.payload],
      };

    case WORKFLOW_ACTIONS.ADD_WARNING:
      return {
        ...state,
        warnings: [...state.warnings, action.payload],
      };

    case WORKFLOW_ACTIONS.CLEAR_ERRORS:
      return {
        ...state,
        errors: [],
      };

    case WORKFLOW_ACTIONS.CLEAR_WARNINGS:
      return {
        ...state,
        warnings: [],
      };

    case WORKFLOW_ACTIONS.MARK_STAGE_COMPLETE:
      return {
        ...state,
        isStageComplete: {
          ...state.isStageComplete,
          [action.payload]: true,
        },
      };

    case WORKFLOW_ACTIONS.RESET_WORKFLOW:
      return {
        ...initialState,
        currentStage: WorkflowStage.PATIENT_SELECTION,
      };

    default:
      return state;
  }
}

export function useWorkflowState() {
  const [state, dispatch] = useReducer(workflowReducer, initialState);

  const actions = {
    setStage: useCallback((stage: WorkflowStage) => {
      dispatch({ type: WORKFLOW_ACTIONS.SET_STAGE, payload: stage });
    }, []),

    setPatientInfo: useCallback((patientInfo: any) => {
      dispatch({ type: WORKFLOW_ACTIONS.SET_PATIENT_INFO, payload: patientInfo });
    }, []),

    addRootPoint: useCallback((point: RootPoint) => {
      dispatch({ type: WORKFLOW_ACTIONS.ADD_ROOT_POINT, payload: point });
    }, []),

    removeRootPoint: useCallback((pointId: string) => {
      dispatch({ type: WORKFLOW_ACTIONS.REMOVE_ROOT_POINT, payload: pointId });
    }, []),

    clearRootPoints: useCallback(() => {
      dispatch({ type: WORKFLOW_ACTIONS.CLEAR_ROOT_POINTS });
    }, []),

    setCenterline: useCallback((centerline: CenterlineData) => {
      dispatch({ type: WORKFLOW_ACTIONS.SET_CENTERLINE, payload: centerline });
    }, []),

    addAnnulusPoint: useCallback((point: AnnulusPoint) => {
      dispatch({ type: WORKFLOW_ACTIONS.ADD_ANNULUS_POINT, payload: point });
    }, []),

    removeAnnulusPoint: useCallback((pointId: string) => {
      dispatch({ type: WORKFLOW_ACTIONS.REMOVE_ANNULUS_POINT, payload: pointId });
    }, []),

    clearAnnulusPoints: useCallback(() => {
      dispatch({ type: WORKFLOW_ACTIONS.CLEAR_ANNULUS_POINTS });
    }, []),

    setAnnularPlane: useCallback((plane: AnnularPlane) => {
      dispatch({ type: WORKFLOW_ACTIONS.SET_ANNULAR_PLANE, payload: plane });
    }, []),

    setMeasurements: useCallback((measurements: TAVIMeasurements) => {
      dispatch({ type: WORKFLOW_ACTIONS.SET_MEASUREMENTS, payload: measurements });
    }, []),

    updateMeasurement: useCallback((measurement: Partial<TAVIMeasurements>) => {
      dispatch({ type: WORKFLOW_ACTIONS.UPDATE_MEASUREMENT, payload: measurement });
    }, []),

    addError: useCallback((error: string) => {
      dispatch({ type: WORKFLOW_ACTIONS.ADD_ERROR, payload: error });
    }, []),

    addWarning: useCallback((warning: string) => {
      dispatch({ type: WORKFLOW_ACTIONS.ADD_WARNING, payload: warning });
    }, []),

    clearErrors: useCallback(() => {
      dispatch({ type: WORKFLOW_ACTIONS.CLEAR_ERRORS });
    }, []),

    clearWarnings: useCallback(() => {
      dispatch({ type: WORKFLOW_ACTIONS.CLEAR_WARNINGS });
    }, []),

    markStageComplete: useCallback((stage: WorkflowStage) => {
      dispatch({ type: WORKFLOW_ACTIONS.MARK_STAGE_COMPLETE, payload: stage });
    }, []),

    resetWorkflow: useCallback(() => {
      dispatch({ type: WORKFLOW_ACTIONS.RESET_WORKFLOW });
    }, []),
  };

  const getters = {
    canAdvanceToStage: useCallback((targetStage: WorkflowStage): boolean => {
      switch (targetStage) {
        case WorkflowStage.ROOT_DEFINITION:
          return state.isStageComplete[WorkflowStage.PATIENT_SELECTION];
        case WorkflowStage.ANNULUS_DEFINITION:
          return state.isStageComplete[WorkflowStage.ROOT_DEFINITION];
        case WorkflowStage.MEASUREMENTS:
          return state.isStageComplete[WorkflowStage.ANNULUS_DEFINITION];
        default:
          return true;
      }
    }, [state.isStageComplete]),

    getCurrentStageProgress: useCallback((): number => {
      switch (state.currentStage) {
        case WorkflowStage.ROOT_DEFINITION:
          return state.rootPoints.length >= 3 ? 100 : (state.rootPoints.length / 3) * 100;
        case WorkflowStage.ANNULUS_DEFINITION:
          return Math.min(state.annulusPoints.length / 3, 1) * 100;
        case WorkflowStage.MEASUREMENTS:
          const measurementCount = Object.keys(state.measurements).length;
          return Math.min(measurementCount / 5, 1) * 100; // Assuming 5 key measurements
        default:
          return state.isStageComplete[state.currentStage] ? 100 : 0;
      }
    }, [state.currentStage, state.rootPoints.length, state.annulusPoints.length, state.measurements, state.isStageComplete]),

    getStageTitle: useCallback((stage: WorkflowStage): string => {
      switch (stage) {
        case WorkflowStage.PATIENT_SELECTION:
          return "Patient Selection";
        case WorkflowStage.ROOT_DEFINITION:
          return "Aortic Root Definition";
        case WorkflowStage.ANNULUS_DEFINITION:
          return "Annulus Definition";
        case WorkflowStage.MEASUREMENTS:
          return "TAVI Measurements";
        default:
          return "Unknown Stage";
      }
    }, []),
  };

  return {
    state,
    actions,
    ...getters,
  };
}