import React, { useState } from 'react';
import { FaCog, FaTimes, FaPlus, FaTrash, FaEdit, FaSave, FaFileImport, FaFileExport, FaLock, FaSignOutAlt } from 'react-icons/fa';
import { getWorkflowManager } from '../utils/MeasurementWorkflowManager';
import { MeasurementWorkflow, MeasurementStep, MeasurementType, MeasurementSection, MeasurementLevel } from '../types/MeasurementWorkflowTypes';
import ChangePasswordPage from './ChangePasswordPage';

interface SettingsPageProps {
  onClose: () => void;
  onLogout?: () => void;
  onChangePassword?: (currentPassword: string, newPassword: string) => Promise<void>;
  currentUserEmail?: string;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ onClose, onLogout, onChangePassword, currentUserEmail }) => {
  const [activeTab, setActiveTab] = useState<'general' | 'workflows' | 'appearance' | 'security'>('workflows');
  const [workflowManager] = useState(() => getWorkflowManager());
  const [workflows, setWorkflows] = useState(workflowManager.getAvailableWorkflows());
  const [editingWorkflow, setEditingWorkflow] = useState<MeasurementWorkflow | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  const tabs = [
    { id: 'general' as const, name: 'General', icon: FaCog },
    { id: 'workflows' as const, name: 'Workflow Generation', icon: FaFileImport },
    { id: 'security' as const, name: 'Security', icon: FaLock },
    { id: 'appearance' as const, name: 'Appearance', icon: FaEdit },
  ];

  const handleCreateNewWorkflow = () => {
    const newWorkflow: MeasurementWorkflow = {
      workflowVersion: '1.0',
      workflowName: 'New Workflow',
      measurements: []
    };
    setEditingWorkflow(newWorkflow);
    setIsCreatingNew(true);
  };

  const handleSaveWorkflow = () => {
    if (!editingWorkflow) return;

    // Generate ID from name (lowercase, replace spaces with hyphens)
    const workflowId = editingWorkflow.workflowName.toLowerCase().replace(/\s+/g, '-');

    // Register the workflow
    workflowManager.registerWorkflow(workflowId, editingWorkflow);

    // Refresh workflows list
    setWorkflows(workflowManager.getAvailableWorkflows());

    // Close editor
    setEditingWorkflow(null);
    setIsCreatingNew(false);
  };

  const handleEditWorkflow = (workflowId: string) => {
    const workflow = workflowManager.loadWorkflow(workflowId);
    setEditingWorkflow(JSON.parse(JSON.stringify(workflow))); // Deep copy
    setIsCreatingNew(false);
  };

  const handleDeleteWorkflow = (workflowId: string) => {
    if (confirm('Are you sure you want to delete this workflow?')) {
      workflowManager.unregisterWorkflow(workflowId);
      setWorkflows(workflowManager.getAvailableWorkflows());
    }
  };

  const handleAddStep = () => {
    if (!editingWorkflow) return;

    const newStep: MeasurementStep = {
      id: `step-${editingWorkflow.measurements.length + 1}`,
      name: 'New Measurement',
      type: MeasurementType.POLYGON,
      section: MeasurementSection.AXIAL,
      level: MeasurementLevel.ANNULUS,
      offsetFromAnnulus: 0,
      required: true,
      autoLabel: 'New'
    };

    setEditingWorkflow({
      ...editingWorkflow,
      measurements: [...editingWorkflow.measurements, newStep]
    });
  };

  const handleRemoveStep = (index: number) => {
    if (!editingWorkflow) return;

    setEditingWorkflow({
      ...editingWorkflow,
      measurements: editingWorkflow.measurements.filter((_, i) => i !== index)
    });
  };

  const handleUpdateStep = (index: number, field: keyof MeasurementStep, value: any) => {
    if (!editingWorkflow) return;

    const updatedMeasurements = [...editingWorkflow.measurements];
    updatedMeasurements[index] = {
      ...updatedMeasurements[index],
      [field]: value
    };

    setEditingWorkflow({
      ...editingWorkflow,
      measurements: updatedMeasurements
    });
  };

  const handleExportWorkflow = (workflowId: string) => {
    const workflow = workflowManager.loadWorkflow(workflowId);
    const json = JSON.stringify(workflow, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workflowId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportWorkflow = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const workflow = JSON.parse(json) as MeasurementWorkflow;

        // Validate required fields
        if (!workflow.workflowName || !workflow.workflowVersion || !workflow.measurements) {
          alert('Invalid workflow file format');
          return;
        }

        setEditingWorkflow(workflow);
        setIsCreatingNew(true);
      } catch (error) {
        alert('Error parsing workflow file');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-lg shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <FaCog className="text-blue-500" />
            Settings
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <FaTimes className="text-slate-400 text-xl" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 py-3 border-b border-slate-700 flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <tab.icon />
              {tab.name}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'general' && (
            <div className="text-white">
              <h3 className="text-lg font-semibold mb-4">General Settings</h3>
              <p className="text-slate-400">General settings coming soon...</p>
            </div>
          )}

          {activeTab === 'workflows' && !editingWorkflow && (
            <div className="text-white">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold">Workflow Management</h3>
                  <p className="text-sm text-slate-400 mt-1">Create and manage measurement workflows</p>
                </div>
                <div className="flex gap-2">
                  <label className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-medium text-sm cursor-pointer flex items-center gap-2 transition-colors">
                    <FaFileImport />
                    Import
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleImportWorkflow}
                      className="hidden"
                    />
                  </label>
                  <button
                    onClick={handleCreateNewWorkflow}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors"
                  >
                    <FaPlus />
                    Create New Workflow
                  </button>
                </div>
              </div>

              {/* Workflows List */}
              <div className="grid gap-4">
                {workflows.map((workflow) => (
                  <div
                    key={workflow.id}
                    className="bg-slate-800 rounded-lg p-4 border border-slate-700"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-semibold text-white">{workflow.name}</h4>
                        <p className="text-sm text-slate-400 mt-1">Version {workflow.version}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleExportWorkflow(workflow.id)}
                          className="p-2 hover:bg-slate-700 rounded transition-colors"
                          title="Export"
                        >
                          <FaFileExport className="text-slate-400" />
                        </button>
                        <button
                          onClick={() => handleEditWorkflow(workflow.id)}
                          className="p-2 hover:bg-slate-700 rounded transition-colors"
                          title="Edit"
                        >
                          <FaEdit className="text-blue-400" />
                        </button>
                        <button
                          onClick={() => handleDeleteWorkflow(workflow.id)}
                          className="p-2 hover:bg-slate-700 rounded transition-colors"
                          title="Delete"
                        >
                          <FaTrash className="text-red-400" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'workflows' && editingWorkflow && (
            <div className="text-white">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold">
                  {isCreatingNew ? 'Create New Workflow' : 'Edit Workflow'}
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingWorkflow(null);
                      setIsCreatingNew(false);
                    }}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveWorkflow}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors"
                  >
                    <FaSave />
                    Save Workflow
                  </button>
                </div>
              </div>

              {/* Workflow Details */}
              <div className="bg-slate-800 rounded-lg p-4 mb-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Workflow Name
                    </label>
                    <input
                      type="text"
                      value={editingWorkflow.workflowName}
                      onChange={(e) => setEditingWorkflow({ ...editingWorkflow, workflowName: e.target.value })}
                      className="w-full bg-slate-700 text-white border border-slate-600 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Version
                    </label>
                    <input
                      type="text"
                      value={editingWorkflow.workflowVersion}
                      onChange={(e) => setEditingWorkflow({ ...editingWorkflow, workflowVersion: e.target.value })}
                      className="w-full bg-slate-700 text-white border border-slate-600 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Measurements */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold">Measurement Steps</h4>
                  <button
                    onClick={handleAddStep}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm flex items-center gap-1 transition-colors"
                  >
                    <FaPlus className="text-xs" />
                    Add Step
                  </button>
                </div>

                <div className="space-y-3">
                  {editingWorkflow.measurements.map((step, index) => (
                    <div key={index} className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center font-bold">
                          {index + 1}
                        </div>
                        <div className="flex-1 grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">Step ID</label>
                            <input
                              type="text"
                              value={step.id}
                              onChange={(e) => handleUpdateStep(index, 'id', e.target.value)}
                              className="w-full bg-slate-700 text-white text-sm border border-slate-600 rounded px-2 py-1.5"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">Name</label>
                            <input
                              type="text"
                              value={step.name}
                              onChange={(e) => handleUpdateStep(index, 'name', e.target.value)}
                              className="w-full bg-slate-700 text-white text-sm border border-slate-600 rounded px-2 py-1.5"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">Type</label>
                            <select
                              value={step.type}
                              onChange={(e) => handleUpdateStep(index, 'type', e.target.value)}
                              className="w-full bg-slate-700 text-white text-sm border border-slate-600 rounded px-2 py-1.5"
                            >
                              <option value="polygon">Polygon</option>
                              <option value="line">Line</option>
                              <option value="spline">Spline</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">Section</label>
                            <select
                              value={step.section}
                              onChange={(e) => handleUpdateStep(index, 'section', e.target.value)}
                              className="w-full bg-slate-700 text-white text-sm border border-slate-600 rounded px-2 py-1.5"
                            >
                              <option value="axial">Axial</option>
                              <option value="longaxis">Long Axis</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">Level</label>
                            <select
                              value={step.level}
                              onChange={(e) => handleUpdateStep(index, 'level', e.target.value)}
                              className="w-full bg-slate-700 text-white text-sm border border-slate-600 rounded px-2 py-1.5"
                            >
                              <option value="annulus">Annulus</option>
                              <option value="relative">Relative</option>
                              <option value="dynamic">Dynamic</option>
                              <option value="manual">Manual</option>
                              <option value="coronaryLevel">Coronary Level</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">Offset (mm)</label>
                            <input
                              type="number"
                              value={step.offsetFromAnnulus || 0}
                              onChange={(e) => handleUpdateStep(index, 'offsetFromAnnulus', Number(e.target.value))}
                              className="w-full bg-slate-700 text-white text-sm border border-slate-600 rounded px-2 py-1.5"
                              disabled={step.level !== 'relative'}
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-xs text-slate-400 mb-1">Dynamic Calculation</label>
                            <input
                              type="text"
                              value={step.offsetCalculation || ''}
                              onChange={(e) => handleUpdateStep(index, 'offsetCalculation', e.target.value)}
                              placeholder="e.g., annulusArea < 400 ? 8 : 10"
                              className="w-full bg-slate-700 text-white text-sm border border-slate-600 rounded px-2 py-1.5"
                              disabled={step.level !== 'dynamic'}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">Label</label>
                            <input
                              type="text"
                              value={step.autoLabel}
                              onChange={(e) => handleUpdateStep(index, 'autoLabel', e.target.value)}
                              className="w-full bg-slate-700 text-white text-sm border border-slate-600 rounded px-2 py-1.5"
                            />
                          </div>
                          <div className="flex items-end">
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={step.required}
                                onChange={(e) => handleUpdateStep(index, 'required', e.target.checked)}
                                className="rounded"
                              />
                              Required
                            </label>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveStep(index)}
                          className="flex-shrink-0 p-2 hover:bg-slate-700 rounded transition-colors"
                        >
                          <FaTrash className="text-red-400 text-sm" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="text-white space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Security Settings</h3>
                <p className="text-slate-400 text-sm mb-6">Manage your account security and authentication settings.</p>
              </div>

              {/* User Info */}
              {currentUserEmail && (
                <div className="bg-slate-700 rounded-lg p-4">
                  <label className="text-sm font-medium text-slate-300 block mb-1">Signed in as</label>
                  <p className="text-white font-semibold">{currentUserEmail}</p>
                </div>
              )}

              {/* Change Password */}
              <div className="bg-slate-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h4 className="font-semibold text-white">Password</h4>
                    <p className="text-slate-400 text-sm">Change your account password</p>
                  </div>
                  <button
                    onClick={() => onChangePassword ? setShowChangePassword(true) : alert('Password change not configured')}
                    disabled={!onChangePassword}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium flex items-center gap-2"
                  >
                    <FaLock />
                    Change Password
                  </button>
                </div>
              </div>

              {/* Logout */}
              <div className="bg-slate-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h4 className="font-semibold text-white">Sign Out</h4>
                    <p className="text-slate-400 text-sm">Sign out from your account on this device</p>
                  </div>
                  <button
                    onClick={() => {
                      if (onLogout) {
                        onLogout();
                        onClose();
                      } else {
                        alert('Logout not configured');
                      }
                    }}
                    disabled={!onLogout}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium flex items-center gap-2"
                  >
                    <FaSignOutAlt />
                    Sign Out
                  </button>
                </div>
              </div>

              {/* Session Info */}
              <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                <h4 className="font-semibold text-white mb-3">Security Tips</h4>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 mt-0.5">•</span>
                    <span>Use a strong password with at least 8 characters</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 mt-0.5">•</span>
                    <span>Don't share your password with anyone</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 mt-0.5">•</span>
                    <span>Sign out when using shared computers</span>
                  </li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="text-white">
              <h3 className="text-lg font-semibold mb-4">Appearance Settings</h3>
              <p className="text-slate-400">Appearance settings coming soon...</p>
            </div>
          )}
        </div>
      </div>

      {/* Change Password Modal */}
      {showChangePassword && onChangePassword && (
        <ChangePasswordPage
          onClose={() => setShowChangePassword(false)}
          onChangePassword={onChangePassword}
        />
      )}
    </div>
  );
};

export default SettingsPage;
