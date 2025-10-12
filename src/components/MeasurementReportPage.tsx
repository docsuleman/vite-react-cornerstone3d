/**
 * MeasurementReportPage - Comprehensive TAVI measurement report
 * Displays all collected measurements in a structured, printable format
 */

import React from 'react';
import { FaPrint, FaDownload, FaTimes, FaCheck, FaRuler, FaCircle } from 'react-icons/fa';
import { TAVIMeasurements } from '../types/WorkflowTypes';
import { MeasurementStep } from '../types/MeasurementWorkflowTypes';

interface MeasurementReportPageProps {
  patientInfo: {
    patientID?: string;
    patientName?: string;
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
  };
  measurements: TAVIMeasurements;
  completedSteps: MeasurementStep[];
  onClose: () => void;
}

const MeasurementReportPage: React.FC<MeasurementReportPageProps> = ({
  patientInfo,
  measurements,
  completedSteps,
  onClose
}) => {
  const handlePrint = () => {
    window.print();
  };

  const handleExport = () => {
    // Create a JSON export of all measurements
    const exportData = {
      patient: patientInfo,
      measurements: measurements,
      completedSteps: completedSteps.map(step => ({
        id: step.id,
        name: step.name,
        type: step.type,
        section: step.section,
        measuredValue: step.measuredValue
      })),
      generatedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TAVI_Report_${patientInfo.patientID}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = () => {
    return new Date().toLocaleString();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-90 flex items-center justify-center p-8">
      <div className="bg-white w-full max-w-6xl h-full overflow-y-auto rounded-lg shadow-2xl print:shadow-none">
        {/* Header - Hidden when printing */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-800 text-white p-6 flex justify-between items-center print:hidden">
          <div>
            <h1 className="text-3xl font-bold">QuanTAVI Measurement Report</h1>
            <p className="text-blue-100 mt-1">Quantitative TAVI Planning · by Dr. Suleman</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-white text-blue-600 rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-2 font-medium"
            >
              <FaPrint />
              Print
            </button>
            <button
              onClick={handleExport}
              className="px-4 py-2 bg-white text-blue-600 rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-2 font-medium"
            >
              <FaDownload />
              Export JSON
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 font-medium"
            >
              <FaTimes />
              Close
            </button>
          </div>
        </div>

        {/* Print Header - Only visible when printing */}
        <div className="hidden print:block p-8 border-b-4 border-blue-600">
          <h1 className="text-4xl font-bold text-gray-900">QuanTAVI Measurement Report</h1>
          <p className="text-xl text-gray-600 mt-2">Quantitative TAVI Planning · by Dr. Suleman</p>
        </div>

        {/* Report Content */}
        <div className="p-8 bg-gray-50">
          {/* Patient Information */}
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b-2 border-blue-600 pb-2">
              Patient Information
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-600 font-semibold">Patient Name</div>
                <div className="text-lg text-gray-900">{patientInfo.patientName || 'N/A'}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600 font-semibold">Patient ID</div>
                <div className="text-lg text-gray-900">{patientInfo.patientID || 'N/A'}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600 font-semibold">Study Instance UID</div>
                <div className="text-sm text-gray-700 font-mono break-all">{patientInfo.studyInstanceUID || 'N/A'}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600 font-semibold">Report Generated</div>
                <div className="text-lg text-gray-900">{formatDate()}</div>
              </div>
            </div>
          </div>

          {/* Annulus Measurements */}
          {measurements.annulus && (
            <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b-2 border-blue-600 pb-2">
                Annular Measurements
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
                  <div className="text-sm text-blue-800 font-semibold">Area</div>
                  <div className="text-3xl font-bold text-blue-900">{measurements.annulus.area.toFixed(1)}</div>
                  <div className="text-sm text-blue-700">mm²</div>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
                  <div className="text-sm text-blue-800 font-semibold">Perimeter</div>
                  <div className="text-3xl font-bold text-blue-900">{measurements.annulus.perimeter.toFixed(1)}</div>
                  <div className="text-sm text-blue-700">mm</div>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
                  <div className="text-sm text-blue-800 font-semibold">Area-Derived Ø</div>
                  <div className="text-3xl font-bold text-blue-900">{measurements.annulus.areaDerivedDiameter.toFixed(1)}</div>
                  <div className="text-sm text-blue-700">mm</div>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
                  <div className="text-sm text-blue-800 font-semibold">Perimeter-Derived Ø</div>
                  <div className="text-3xl font-bold text-blue-900">{measurements.annulus.perimeterDerivedDiameter.toFixed(1)}</div>
                  <div className="text-sm text-blue-700">mm</div>
                </div>
              </div>
            </div>
          )}

          {/* Axial Measurements */}
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b-2 border-purple-600 pb-2">
              Axial Measurements
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {measurements.lvot && (
                <div className="bg-purple-50 p-4 rounded-lg border-2 border-purple-200">
                  <h3 className="font-bold text-purple-900 mb-2 flex items-center gap-2">
                    <FaCircle className="text-purple-600" />
                    LVOT (Left Ventricular Outflow Tract)
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-purple-700">Area:</div>
                      <div className="font-bold text-purple-900">{measurements.lvot.area.toFixed(1)} mm²</div>
                    </div>
                    <div>
                      <div className="text-purple-700">Perimeter:</div>
                      <div className="font-bold text-purple-900">{measurements.lvot.perimeter.toFixed(1)} mm</div>
                    </div>
                    <div>
                      <div className="text-purple-700">Area Ø:</div>
                      <div className="font-bold text-purple-900">{measurements.lvot.areaDerivedDiameter.toFixed(1)} mm</div>
                    </div>
                    <div>
                      <div className="text-purple-700">Perimeter Ø:</div>
                      <div className="font-bold text-purple-900">{measurements.lvot.perimeterDerivedDiameter.toFixed(1)} mm</div>
                    </div>
                  </div>
                </div>
              )}

              {measurements.stj && (
                <div className="bg-purple-50 p-4 rounded-lg border-2 border-purple-200">
                  <h3 className="font-bold text-purple-900 mb-2 flex items-center gap-2">
                    <FaCircle className="text-purple-600" />
                    STJ (Sinotubular Junction)
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-purple-700">Area:</div>
                      <div className="font-bold text-purple-900">{measurements.stj.area.toFixed(1)} mm²</div>
                    </div>
                    <div>
                      <div className="text-purple-700">Perimeter:</div>
                      <div className="font-bold text-purple-900">{measurements.stj.perimeter.toFixed(1)} mm</div>
                    </div>
                    <div>
                      <div className="text-purple-700">Area Ø:</div>
                      <div className="font-bold text-purple-900">{measurements.stj.areaDerivedDiameter.toFixed(1)} mm</div>
                    </div>
                    <div>
                      <div className="text-purple-700">Perimeter Ø:</div>
                      <div className="font-bold text-purple-900">{measurements.stj.perimeterDerivedDiameter.toFixed(1)} mm</div>
                    </div>
                  </div>
                </div>
              )}

              {measurements.ascendingAorta && (
                <div className="bg-purple-50 p-4 rounded-lg border-2 border-purple-200">
                  <h3 className="font-bold text-purple-900 mb-2 flex items-center gap-2">
                    <FaCircle className="text-purple-600" />
                    Ascending Aorta
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-purple-700">Area:</div>
                      <div className="font-bold text-purple-900">{measurements.ascendingAorta.area.toFixed(1)} mm²</div>
                    </div>
                    <div>
                      <div className="text-purple-700">Perimeter:</div>
                      <div className="font-bold text-purple-900">{measurements.ascendingAorta.perimeter.toFixed(1)} mm</div>
                    </div>
                    <div>
                      <div className="text-purple-700">Area Ø:</div>
                      <div className="font-bold text-purple-900">{measurements.ascendingAorta.areaDerivedDiameter.toFixed(1)} mm</div>
                    </div>
                    <div>
                      <div className="text-purple-700">Perimeter Ø:</div>
                      <div className="font-bold text-purple-900">{measurements.ascendingAorta.perimeterDerivedDiameter.toFixed(1)} mm</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* SOV Measurements */}
            {measurements.sovMeasurements && (
              <div className="mt-4 bg-purple-50 p-4 rounded-lg border-2 border-purple-200">
                <h3 className="font-bold text-purple-900 mb-2 flex items-center gap-2">
                  <FaRuler className="text-purple-600" />
                  Sinus of Valsalva (SOV) Diameters
                </h3>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-purple-700">SOV-L (Left):</div>
                    <div className="font-bold text-purple-900">{measurements.sovMeasurements.left.toFixed(1)} mm</div>
                  </div>
                  <div>
                    <div className="text-purple-700">SOV-R (Right):</div>
                    <div className="font-bold text-purple-900">{measurements.sovMeasurements.right.toFixed(1)} mm</div>
                  </div>
                  <div>
                    <div className="text-purple-700">SOV-N (Non-coronary):</div>
                    <div className="font-bold text-purple-900">{measurements.sovMeasurements.nonCoronary.toFixed(1)} mm</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Long Axis Measurements */}
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b-2 border-cyan-600 pb-2">
              Long Axis Measurements
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {measurements.coronaryHeights && (
                <div className="bg-cyan-50 p-4 rounded-lg border-2 border-cyan-200">
                  <h3 className="font-bold text-cyan-900 mb-2 flex items-center gap-2">
                    <FaRuler className="text-cyan-600" />
                    Coronary Heights
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-cyan-700">LCA Height:</div>
                      <div className="font-bold text-cyan-900">{measurements.coronaryHeights.leftCoronary.toFixed(1)} mm</div>
                    </div>
                    <div>
                      <div className="text-cyan-700">RCA Height:</div>
                      <div className="font-bold text-cyan-900">{measurements.coronaryHeights.rightCoronary.toFixed(1)} mm</div>
                    </div>
                  </div>
                </div>
              )}

              {measurements.leafletLengths && (
                <div className="bg-cyan-50 p-4 rounded-lg border-2 border-cyan-200">
                  <h3 className="font-bold text-cyan-900 mb-2 flex items-center gap-2">
                    <FaRuler className="text-cyan-600" />
                    Leaflet Lengths
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-cyan-700">Left Leaflet:</div>
                      <div className="font-bold text-cyan-900">{measurements.leafletLengths.left.toFixed(1)} mm</div>
                    </div>
                    <div>
                      <div className="text-cyan-700">Right Leaflet:</div>
                      <div className="font-bold text-cyan-900">{measurements.leafletLengths.right.toFixed(1)} mm</div>
                    </div>
                  </div>
                </div>
              )}

              {measurements.stjHeight && (
                <div className="bg-cyan-50 p-4 rounded-lg border-2 border-cyan-200">
                  <h3 className="font-bold text-cyan-900 mb-2 flex items-center gap-2">
                    <FaRuler className="text-cyan-600" />
                    STJ Height
                  </h3>
                  <div className="text-3xl font-bold text-cyan-900">{measurements.stjHeight.toFixed(1)} mm</div>
                </div>
              )}

              {measurements.membranousSeptum && (
                <div className="bg-cyan-50 p-4 rounded-lg border-2 border-cyan-200">
                  <h3 className="font-bold text-cyan-900 mb-2 flex items-center gap-2">
                    <FaRuler className="text-cyan-600" />
                    Membranous Septum
                  </h3>
                  <div className="text-3xl font-bold text-cyan-900">{measurements.membranousSeptum.toFixed(1)} mm</div>
                </div>
              )}
            </div>

            {/* Optional Sinus Distances */}
            {measurements.sinusDistances && (
              <div className="mt-4 bg-cyan-50 p-4 rounded-lg border-2 border-cyan-200">
                <h3 className="font-bold text-cyan-900 mb-2 flex items-center gap-2">
                  <FaRuler className="text-cyan-600" />
                  Sinus Distances
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-cyan-700">LCA-Sinus:</div>
                    <div className="font-bold text-cyan-900">{measurements.sinusDistances.lcaSinus.toFixed(1)} mm</div>
                  </div>
                  <div>
                    <div className="text-cyan-700">RCA-Sinus:</div>
                    <div className="font-bold text-cyan-900">{measurements.sinusDistances.rcaSinus.toFixed(1)} mm</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Workflow Completion Status */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b-2 border-green-600 pb-2">
              Workflow Status
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {completedSteps.map((step) => (
                <div key={step.id} className="flex items-center gap-2 bg-green-50 p-3 rounded-lg border border-green-200">
                  <FaCheck className="text-green-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-green-900 truncate">{step.name}</div>
                    <div className="text-xs text-green-700">{step.type} - {step.section}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="mt-6 text-center text-sm text-gray-600">
            <p>This report was generated automatically by QuanTAVI</p>
            <p className="mt-1">Generated on {formatDate()}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MeasurementReportPage;
