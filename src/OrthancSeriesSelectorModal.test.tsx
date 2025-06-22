import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OrthancSeriesSelectorModal from './OrthancSeriesSelectorModal';

describe('OrthancSeriesSelectorModal', () => {
  const mockOnClose = vi.fn();
  const mockOnSelectSeries = vi.fn();

  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    seriesList: [],
    studyInstanceUID: 'study123',
    onSelectSeries: mockOnSelectSeries,
    loading: false,
    error: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing if not open', () => {
    render(<OrthancSeriesSelectorModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Select Series')).toBeNull();
  });

  it('renders correctly when open', () => {
    render(<OrthancSeriesSelectorModal {...defaultProps} />);
    expect(screen.getByText('Select Series')).toBeInTheDocument();
    expect(screen.getByText(`For Study: ${defaultProps.studyInstanceUID}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel / Back to Studies' })).toBeInTheDocument();
  });

  it('calls onClose when cancel button is clicked', () => {
    render(<OrthancSeriesSelectorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel / Back to Studies' }));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('displays loading message when loading is true', () => {
    render(<OrthancSeriesSelectorModal {...defaultProps} loading={true} />);
    expect(screen.getByText('Loading series...')).toBeInTheDocument();
  });

  it('displays error message when error is present', () => {
    render(<OrthancSeriesSelectorModal {...defaultProps} error="Test series error" />);
    expect(screen.getByText('Error fetching series: Test series error')).toBeInTheDocument();
  });

  it('displays "no series found" message when seriesList is empty and not loading', () => {
    render(<OrthancSeriesSelectorModal {...defaultProps} seriesList={[]} loading={false} />);
    expect(screen.getByText('No series found for this study.')).toBeInTheDocument();
  });

  it('displays series list and handles series selection', () => {
    const mockSeriesList = [
      { '0020000E': { Value: ['seriesUID1'] }, '00200011': { Value: ['1'] }, '00080060': { Value: ['CT'] }, '0008103E': { Value: ['Series CT 1'] }, '00201209': { Value: ['100'] } },
      { '0020000E': { Value: ['seriesUID2'] }, '00200011': { Value: ['2'] }, '00080060': { Value: ['MR'] }, '0008103E': { Value: ['Series MR 2'] }, '00201209': { Value: ['120'] } },
    ];
    render(<OrthancSeriesSelectorModal {...defaultProps} seriesList={mockSeriesList} />);

    expect(screen.getByText('Series 1 (CT)')).toBeInTheDocument();
    expect(screen.getByText('Series CT 1')).toBeInTheDocument();
    expect(screen.getByText('Instances: 100')).toBeInTheDocument();

    expect(screen.getByText('Series 2 (MR)')).toBeInTheDocument();
    expect(screen.getByText('Series MR 2')).toBeInTheDocument();
    expect(screen.getByText('Instances: 120')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Series 1 (CT)'));
    expect(mockOnSelectSeries).toHaveBeenCalledWith('seriesUID1');
  });
});
