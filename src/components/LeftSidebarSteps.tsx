import React from 'react';
import { FaUser, FaStethoscope, FaCog, FaRuler, FaFileAlt, FaCheck, FaLock } from 'react-icons/fa';
import { WorkflowStage } from '../types/WorkflowTypes';

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
}

const LeftSidebarSteps: React.FC<LeftSidebarStepsProps> = ({
  currentStage,
  completedStages,
  onStageClick,
  canAdvanceToStage
}) => {
  const stages = [
    { stage: WorkflowStage.PATIENT_SELECTION, icon: FaUser, label: '1' },
    { stage: WorkflowStage.ROOT_DEFINITION, icon: FaStethoscope, label: '2' },
    { stage: WorkflowStage.ANNULUS_DEFINITION, icon: FaCog, label: '3' },
    { stage: WorkflowStage.MEASUREMENTS, icon: FaRuler, label: '4' },
    { stage: WorkflowStage.REPORT, icon: FaFileAlt, label: '5' },
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
            title={stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
          >
            {/* Step number */}
            <div className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-slate-900 border-2 border-current flex items-center justify-center text-xs font-bold">
              {label}
            </div>

            {/* Icon or status indicator */}
            {status === 'completed' ? (
              <FaCheck className="text-xl" />
            ) : status === 'locked' ? (
              <FaLock className="text-sm" />
            ) : (
              <Icon className="text-xl" />
            )}

            {/* Current stage indicator */}
            {status === 'current' && (
              <div className="absolute -right-1 top-1/2 transform translate-x-full -translate-y-1/2 w-0 h-0 border-t-4 border-t-transparent border-b-4 border-b-transparent border-l-4 border-l-blue-600"></div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default LeftSidebarSteps;
