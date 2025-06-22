import React, { useState } from 'react';

// Define a more specific type for study search results
interface OrthancStudy {
  StudyInstanceUID: string;
  PatientName?: string;
  PatientID?: string;
  StudyDate?: string;
  StudyDescription?: string;
  ModalitiesInStudy?: string[];
  NumberOfStudyRelatedSeries?: string; // DICOM numbers are often strings in JSON
  // Add other relevant fields as needed by looking at DICOM PS3.18 Table 10.4-1
  // For direct access via DICOM tags (as currently used):
  [key: string]: any; // Allows access like study['00100010']
}

interface OrthancSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (searchParams: { patientName: string; patientId: string; studyDate: string }) => void;
  results: OrthancStudy[];
  loading: boolean;
  error: string | null;
  onSelectStudy: (studyInstanceUID: string) => void;
}

const OrthancSearchModal: React.FC<OrthancSearchModalProps> = ({
  isOpen,
  onClose,
  onSearch,
  results,
  loading,
  error,
  onSelectStudy
}) => {
  const [patientName, setPatientName] = useState('');
  const [patientId, setPatientId] = useState('');
  const [studyDate, setStudyDate] = useState(''); // Format YYYYMMDD or YYYYMMDD-YYYYMMDD

  if (!isOpen) {
    return null;
  }

  const handleSearch = () => {
    onSearch({ patientName, patientId, studyDate });
    // Optionally close modal after search or let parent component decide
    // onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex justify-center items-center">
      <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-md">
        <h2 className="text-2xl font-semibold text-white mb-6">Search Studies on Orthanc</h2>

        <div className="space-y-4">
          <div>
            <label htmlFor="patientName" className="block text-sm font-medium text-gray-300">
              Patient Name
            </label>
            <input
              type="text"
              name="patientName"
              id="patientName"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              placeholder="e.g., Doe^John"
            />
          </div>

          <div>
            <label htmlFor="patientId" className="block text-sm font-medium text-gray-300">
              Patient ID
            </label>
            <input
              type="text"
              name="patientId"
              id="patientId"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              placeholder="e.g., 12345"
            />
          </div>

          <div>
            <label htmlFor="studyDate" className="block text-sm font-medium text-gray-300">
              Study Date
            </label>
            <input
              type="text"
              name="studyDate"
              id="studyDate"
              value={studyDate}
              onChange={(e) => setStudyDate(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              placeholder="YYYYMMDD or YYYYMMDD-YYYYMMDD"
            />
          </div>
        </div>

        <div className="mt-8 flex justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSearch}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500"
          >
            Search
          </button>
        </div>

        {/* Search Results, Loading, and Error Display Area */}
        <div className="mt-6 text-white">
          {loading && <p>Loading results...</p>}
          {error && <p className="text-red-400">Error: {error}</p>}
          {results && results.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-2">Search Results ({results.length})</h3>
              <ul className="max-h-60 overflow-y-auto bg-gray-700 p-2 rounded">
                {results.map((study, index) => {
                  // According to DICOM PS3.18 - Table 10.4-1, DICOM JSON Model
                  // PatientName is 00100010, PatientID is 00100020, StudyDate is 00080020
                  // StudyInstanceUID is 0020000D
                  // Accessing these might require checking .Value[0] and .Alphabetic for PatientName
                  const patientName = study['00100010']?.Value?.[0]?.Alphabetic || 'Unknown';
                  const patientId = study['00100020']?.Value?.[0] || 'Unknown';
                  const studyDate = study['00080020']?.Value?.[0] || 'Unknown';
                  const studyDescription = study['00081030']?.Value?.[0] || 'No description';
                  const studyUID = study['0020000D']?.Value?.[0];

                  return (
                    <li
                      key={studyUID || index}
                      className="p-2 hover:bg-gray-600 cursor-pointer border-b border-gray-600"
                      onClick={() => studyUID && onSelectStudy(studyUID)}
                    >
                      <p className="font-medium">{patientName} ({patientId})</p>
                      <p className="text-sm text-gray-400">{studyDescription} - {studyDate}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {results && results.length === 0 && !loading && <p>No studies found matching your criteria.</p>}
        </div>
      </div>
    </div>
  );
};

export default OrthancSearchModal;
