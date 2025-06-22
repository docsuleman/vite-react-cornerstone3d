import React from 'react';

// Define a type for series data (simplified for now)
interface OrthancSeries {
  SeriesInstanceUID: string;
  SeriesNumber?: string;
  Modality?: string;
  SeriesDescription?: string;
  NumberOfSeriesRelatedInstances?: string;
  // Add other relevant fields as needed by looking at DICOM PS3.18 Table 10.5-1
  [key: string]: any; // Allows access like series['0020000E']
}

interface OrthancSeriesSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  seriesList: OrthancSeries[];
  studyInstanceUID: string | null; // To display or use as context
  onSelectSeries: (seriesInstanceUID: string) => void;
  loading: boolean;
  error: string | null;
}

const OrthancSeriesSelectorModal: React.FC<OrthancSeriesSelectorModalProps> = ({
  isOpen,
  onClose,
  seriesList,
  studyInstanceUID,
  onSelectSeries,
  loading,
  error,
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex justify-center items-center">
      <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-lg">
        <h2 className="text-2xl font-semibold text-white mb-2">Select Series</h2>
        {studyInstanceUID && <p className="text-sm text-gray-400 mb-4">For Study: {studyInstanceUID}</p>}

        {loading && <p className="text-white">Loading series...</p>}
        {error && <p className="text-red-400">Error fetching series: {error}</p>}

        {!loading && !error && seriesList.length === 0 && <p className="text-white">No series found for this study.</p>}

        {seriesList.length > 0 && (
          <ul className="max-h-96 overflow-y-auto bg-gray-700 p-2 rounded text-white">
            {seriesList.map((series, index) => {
              const seriesUID = series['0020000E']?.Value?.[0];
              const seriesNumber = series['00200011']?.Value?.[0] || 'N/A';
              const modality = series['00080060']?.Value?.[0] || 'N/A';
              const seriesDescription = series['0008103E']?.Value?.[0] || 'No description';
              const numInstances = series['00201209']?.Value?.[0] || 'N/A';

              return (
                <li
                  key={seriesUID || index}
                  className="p-3 hover:bg-gray-600 cursor-pointer border-b border-gray-600"
                  onClick={() => seriesUID && onSelectSeries(seriesUID)}
                >
                  <p className="font-medium">Series {seriesNumber} ({modality})</p>
                  <p className="text-sm text-gray-300">{seriesDescription}</p>
                  <p className="text-xs text-gray-400">Instances: {numInstances}</p>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-8 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500"
          >
            Cancel / Back to Studies
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrthancSeriesSelectorModal;
