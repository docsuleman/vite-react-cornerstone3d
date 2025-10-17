import React, { useState, useEffect } from 'react';
import { FaSearch, FaUser, FaCalendar, FaStethoscope, FaChevronRight, FaSpinner } from 'react-icons/fa';
import { dicomWebService, Patient, Study, Series } from '../services/DicomWebService';

interface PatientSearchProps {
  onSeriesSelected: (study: Study, series: Series) => void;
  onClose: () => void;
}

const PatientSearch: React.FC<PatientSearchProps> = ({ onSeriesSelected, onClose }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState<'id' | 'name'>('name');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [studies, setStudies] = useState<Study[]>([]);
  const [selectedStudy, setSelectedStudy] = useState<Study | null>(null);
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;

    setLoading(true);
    setError(null);
    
    try {
      const searchParams = searchType === 'id' 
        ? { PatientID: searchTerm }
        : { PatientName: searchTerm };
      
      const foundPatients = await dicomWebService.searchPatients(searchParams);
      setPatients(foundPatients);
      
      if (foundPatients.length === 0) {
        setError('No patients found matching the search criteria');
      }
    } catch (err) {
      setError('Failed to search patients. Please check your connection to the DICOM server.');
    } finally {
      setLoading(false);
    }
  };

  const handlePatientSelect = async (patient: Patient) => {
    setSelectedPatient(patient);
    setSelectedStudy(null);
    setSeries([]);
    setLoading(true);
    setError(null);

    try {
      const patientStudies = await dicomWebService.getStudiesForPatient(patient.PatientID);
      setStudies(patientStudies);
    } catch (err) {
      setError('Failed to load studies for patient');
    } finally {
      setLoading(false);
    }
  };

  const handleStudySelect = async (study: Study) => {
    setSelectedStudy(study);
    setSeries([]);
    setLoading(true);
    setError(null);

    try {
      const studySeries = await dicomWebService.getSeriesForStudy(study.StudyInstanceUID);
      
      // Filter for CT series that might be relevant for cardiac imaging
      const ctSeries = dicomWebService.filterSeriesByModality(studySeries, ['CT']);
      const cardiacSeries = dicomWebService.filterSeriesByDescription(ctSeries, [
        'cardiac', 'coronary', 'aorta', 'heart', 'CTA', 'angio'
      ]);
      
      // Show cardiac series first, then all CT series
      const sortedSeries = [
        ...cardiacSeries,
        ...ctSeries.filter(s => !cardiacSeries.includes(s))
      ];
      
      setSeries(sortedSeries.length > 0 ? sortedSeries : studySeries);
    } catch (err) {
      setError('Failed to load series for study');
    } finally {
      setLoading(false);
    }
  };

  const handleSeriesSelect = (selectedSeries: Series) => {
    if (selectedStudy) {
      onSeriesSelected(selectedStudy, selectedSeries);
    }
  };

  const formatDate = (date?: string) => {
    if (!date) return 'Unknown';
    return `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;
  };

  const isCardiacSeries = (seriesDescription?: string) => {
    if (!seriesDescription) return false;
    const description = seriesDescription.toLowerCase();
    return ['cardiac', 'coronary', 'aorta', 'heart', 'cta', 'angio'].some(term => 
      description.includes(term)
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-slate-900 text-white rounded-lg shadow-2xl w-full max-w-6xl h-5/6 flex flex-col border border-slate-700">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 p-4 rounded-t-lg">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <FaUser />
              Patient Selection - TAVI Planning
            </h2>
            <button
              onClick={onClose}
              className="text-white hover:text-gray-300 text-xl font-bold"
            >
              ×
            </button>
          </div>
        </div>

        {/* Search Section */}
        <div className="p-4 border-b border-slate-700 bg-slate-800">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-2 text-slate-200">Search Patients</label>
              <div className="flex gap-2">
                <select
                  value={searchType}
                  onChange={(e) => setSearchType(e.target.value as 'id' | 'name')}
                  className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="name">Patient Name</option>
                  <option value="id">Patient ID</option>
                </select>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder={`Enter ${searchType === 'id' ? 'Patient ID' : 'Patient Name'}`}
                  className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={handleSearch}
                  disabled={loading || !searchTerm.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed px-6 py-2 rounded flex items-center gap-2 text-white font-medium transition-colors"
                >
                  {loading ? <FaSpinner className="animate-spin" /> : <FaSearch />}
                  Search
                </button>
              </div>
            </div>
          </div>
          
          {error && (
            <div className="mt-3 text-red-200 bg-red-900/30 border border-red-700 rounded p-3">
              {error}
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden bg-slate-800">
          {/* Patients List */}
          <div className="w-1/3 border-r border-slate-700 flex flex-col">
            <div className="p-4 bg-slate-700 font-semibold text-white border-b border-slate-600">
              <FaUser className="inline mr-2" />
              Patients ({patients.length})
            </div>
            <div className="flex-1 overflow-y-auto">
              {patients.map((patient) => (
                <div
                  key={patient.PatientID}
                  onClick={() => handlePatientSelect(patient)}
                  className={`p-4 border-b border-slate-700 cursor-pointer hover:bg-slate-700 transition-colors ${
                    selectedPatient?.PatientID === patient.PatientID ? 'bg-blue-900/50 border-blue-600' : 'bg-slate-800'
                  }`}
                >
                  <div className="font-medium text-white">{patient.PatientName || 'Unknown Patient'}</div>
                  <div className="text-sm text-slate-300 mt-1">ID: {patient.PatientID || 'Unknown ID'}</div>
                  {patient.PatientBirthDate && (
                    <div className="text-sm text-slate-400 mt-1">
                      DOB: {formatDate(patient.PatientBirthDate)}
                    </div>
                  )}
                  {patient.PatientSex && (
                    <div className="text-sm text-slate-400">Sex: {patient.PatientSex}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Studies List */}
          <div className="w-1/3 border-r border-slate-700 flex flex-col">
            <div className="p-4 bg-slate-700 font-semibold text-white border-b border-slate-600">
              <FaCalendar className="inline mr-2" />
              Studies ({studies.length})
            </div>
            <div className="flex-1 overflow-y-auto">
              {studies.map((study) => (
                <div
                  key={study.StudyInstanceUID}
                  onClick={() => handleStudySelect(study)}
                  className={`p-4 border-b border-slate-700 cursor-pointer hover:bg-slate-700 transition-colors ${
                    selectedStudy?.StudyInstanceUID === study.StudyInstanceUID ? 'bg-blue-900/50 border-blue-600' : 'bg-slate-800'
                  }`}
                >
                  <div className="font-medium flex items-center gap-2 text-white">
                    <FaCalendar className="text-sm text-blue-400" />
                    {formatDate(study.StudyDate)}
                  </div>
                  {study.StudyDescription && (
                    <div className="text-sm text-slate-300 mt-1">{study.StudyDescription}</div>
                  )}
                  {study.AccessionNumber && (
                    <div className="text-sm text-slate-400 mt-1">Acc: {study.AccessionNumber}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Series List */}
          <div className="w-1/3 flex flex-col">
            <div className="p-4 bg-slate-700 font-semibold text-white border-b border-slate-600">
              <FaStethoscope className="inline mr-2" />
              Series ({series.length})
            </div>
            <div className="flex-1 overflow-y-auto">
              {series.map((s) => (
                <div
                  key={s.SeriesInstanceUID}
                  onClick={() => handleSeriesSelect(s)}
                  className="p-4 border-b border-slate-700 cursor-pointer hover:bg-slate-700 bg-slate-800 hover:bg-blue-800/30 group transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FaStethoscope className="text-sm text-blue-400" />
                      <span className="font-medium text-white">Series {s.SeriesNumber}</span>
                      {isCardiacSeries(s.SeriesDescription) && (
                        <span className="bg-red-600 text-white text-xs px-2 py-1 rounded font-medium">CARDIAC</span>
                      )}
                    </div>
                    <FaChevronRight className="text-slate-400 group-hover:text-white transition-colors" />
                  </div>
                  
                  <div className="text-sm text-slate-300 mt-2">
                    {s.SeriesDescription || 'No Description'}
                  </div>
                  
                  <div className="flex justify-between text-sm text-slate-400 mt-2">
                    <span className="font-medium">{s.Modality}</span>
                    <span>{s.NumberOfSeriesRelatedInstances} images</span>
                  </div>
                  
                  {s.SeriesDate && (
                    <div className="text-sm text-slate-400 mt-1">
                      {formatDate(s.SeriesDate)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-700 rounded-b-lg border-t border-slate-600">
          <div className="text-sm text-slate-300 flex items-center gap-2">
            <FaChevronRight className="text-blue-400" />
            Select a series to start TAVI planning workflow
          </div>
        </div>
      </div>
    </div>
  );
};

export default PatientSearch;