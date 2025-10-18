import React from 'react';
import { FaCheck, FaCog } from 'react-icons/fa';
import { WorkflowStage } from '../types/WorkflowTypes';
import patientIcon from '../assets/patient-icon\'.png';
import rootIcon from '../assets/root-icon.png';
import valveIcon from '../assets/valve-transparent-icon.png';
import measurementIcon from '../assets/measure-icon.png';
import reportIcon from '../assets/report-icon.png'; 

interface LeftSidebarStepsProps {
  currentStage: WorkflowStage;
  completedStages: {
    [WorkflowStage.PATIENT_SELECTION]: boolean;
    [WorkflowStage.ROOT_DEFINITION]: boolean;
    [WorkflowStage.ANNULUS_DEFINITION]: boolean;
    [WorkflowStage.MEASUREMENTS]: boolean;
    [WorkflowStage.REPORT]: boolean;
  };
  onStageClick: (stage: WorkflowStage) => void;
  canAdvanceToStage: (stage: WorkflowStage) => boolean;
  onSettingsClick: () => void;
}

const LeftSidebarSteps: React.FC<LeftSidebarStepsProps> = ({
  currentStage,
  completedStages,
  onStageClick,
  canAdvanceToStage,
  onSettingsClick
}) => {
  const stages = [
    { stage: WorkflowStage.PATIENT_SELECTION, iconSrc: patientIcon, label: '1' },
    { stage: WorkflowStage.ROOT_DEFINITION, iconSrc: rootIcon, label: '2' },
    { stage: WorkflowStage.ANNULUS_DEFINITION, iconSrc: valveIcon, label: '3' },
    { stage: WorkflowStage.MEASUREMENTS, iconSrc: measurementIcon, label: '4' },
    { stage: WorkflowStage.REPORT, iconSrc: reportIcon, label: '5' },
  ];

  const getStageStatus = (stage: WorkflowStage) => {
    if (currentStage === stage) return 'current';
    if (completedStages[stage]) return 'completed';
    if (canAdvanceToStage(stage)) return 'available';
    return 'locked';
  };

  const getStageColors = (status: string) => {
    switch (status) {
      case 'current':
        return 'bg-blue-600 text-white border-blue-400';
      case 'completed':
        return 'bg-green-600 text-white border-green-400';
      case 'available':
        return 'bg-slate-700 text-slate-200 border-slate-600 hover:bg-slate-600 cursor-pointer';
      case 'locked':
        return 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed';
      default:
        return 'bg-slate-700 text-slate-200 border-slate-600';
    }
  };

  return (
    <div className="w-20 bg-slate-900 border-r border-slate-700 flex flex-col items-center py-4 justify-between">
      {/* Workflow stages */}
      <div className="flex flex-col items-center gap-4">
        {stages.map(({ stage, iconSrc, label }) => {
          const status = getStageStatus(stage);
          const colors = getStageColors(status);
          const isClickable = status !== 'locked';

          return (
            <div
              key={stage}
              className={`relative w-14 h-14 rounded-lg border-2 flex items-center justify-center transition-all duration-200 ${colors}`}
              onClick={() => isClickable && onStageClick(stage)}
              title={stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
            >
              {/* Step number */}
              <div className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-slate-900 border-2 border-current flex items-center justify-center text-xs font-bold">
                {label}
              </div>

              {/* Icon */}
              <img
                src={iconSrc}
                alt={stage}
                className="max-w-6 max-h-6 object-contain"
              />

              {/* Completion checkmark badge on top-right */}
              {status === 'completed' && (
                <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-green-500 border-2 border-slate-900 flex items-center justify-center">
                  <FaCheck className="text-white text-[10px]" />
                </div>
              )}

              {/* Current stage indicator */}
              {status === 'current' && (
                <div className="absolute -right-1 top-1/2 transform translate-x-full -translate-y-1/2 w-0 h-0 border-t-4 border-t-transparent border-b-4 border-b-transparent border-l-4 border-l-blue-600"></div>
              )}
            </div>
          );
        })}
      </div>

      {/* Settings button at bottom */}
      <button
        onClick={onSettingsClick}
        className="w-14 h-14 rounded-lg border-2 border-slate-600 bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center transition-all duration-200 cursor-pointer"
        title="Settings"
      >
        <FaCog className="text-2xl" />
      </button>
    </div>
  );
};

export default LeftSidebarSteps;
