// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OrthancSearchModal from './OrthancSearchModal';

describe('OrthancSearchModal', () => {
  const mockOnClose = vi.fn();
  const mockOnSearch = vi.fn();
  const mockOnSelectStudy = vi.fn();

  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    onSearch: mockOnSearch,
    results: [],
    loading: false,
    error: null,
    onSelectStudy: mockOnSelectStudy,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing if not open', () => {
    render(<OrthancSearchModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Search Studies on Orthanc')).toBeNull();
  });

  it('renders correctly when open', () => {
    render(<OrthancSearchModal {...defaultProps} />);
    expect(screen.getByText('Search Studies on Orthanc')).toBeInTheDocument();
    expect(screen.getByLabelText('Patient Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Patient ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Study Date')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls onSearch with input values when search button is clicked', () => {
    render(<OrthancSearchModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText('Patient Name'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText('Patient ID'), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText('Study Date'), { target: { value: '20230101' } });

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(mockOnSearch).toHaveBeenCalledWith({
      patientName: 'Doe',
      patientId: '123',
      studyDate: '20230101',
    });
  });

  it('calls onClose when cancel button is clicked', () => {
    render(<OrthancSearchModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('displays loading message when loading is true', () => {
    render(<OrthancSearchModal {...defaultProps} loading={true} />);
    expect(screen.getByText('Loading results...')).toBeInTheDocument();
  });

  it('displays error message when error is present', () => {
    render(<OrthancSearchModal {...defaultProps} error="Test error" />);
    expect(screen.getByText('Error: Test error')).toBeInTheDocument();
  });

  it('displays "no studies found" message when results are empty and not loading', () => {
    render(<OrthancSearchModal {...defaultProps} results={[]} loading={false} />);
    expect(screen.getByText('No studies found matching your criteria.')).toBeInTheDocument();
  });

  it('displays search results and handles study selection', () => {
    const mockResults = [
      { '00100010': { Value: [{ Alphabetic: 'Patient One' }] }, '00100020': { Value: ['P001'] }, '00080020': { Value: ['20230101'] }, '00081030': { Value: ['Study One Desc'] }, '0020000D': { Value: ['studyUID1'] } },
      { '00100010': { Value: [{ Alphabetic: 'Patient Two' }] }, '00100020': { Value: ['P002'] }, '00080020': { Value: ['20230102'] }, '00081030': { Value: ['Study Two Desc'] }, '0020000D': { Value: ['studyUID2'] } },
    ];
    render(<OrthancSearchModal {...defaultProps} results={mockResults} />);

    expect(screen.getByText('Patient One (P001)')).toBeInTheDocument();
    expect(screen.getByText('Study One Desc - 20230101')).toBeInTheDocument();
    expect(screen.getByText('Patient Two (P002)')).toBeInTheDocument();
    expect(screen.getByText('Study Two Desc - 20230102')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Patient One (P001)'));
    expect(mockOnSelectStudy).toHaveBeenCalledWith('studyUID1');
  });
});
