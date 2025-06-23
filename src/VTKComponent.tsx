import React, { useEffect, useRef } from 'react';
import '@kitware/vtk.js/favicon';
import '@kitware/vtk.js/Rendering/Profiles/All';
import '@kitware/vtk.js/IO/Core/DataAccessHelper/HttpDataAccessHelper';
import vtkFullScreenRenderWindow from '@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow';
import vtkHttpDataSetReader from '@kitware/vtk.js/IO/Core/HttpDataSetReader';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkInteractorStyleImage from '@kitware/vtk.js/Interaction/Style/InteractorStyleImage';

const volumePath = `/data/LIDC2.vti`;

const VTKComponent = () => {
  const renderWindowRef = useRef(null);

  useEffect(() => {
    const fullScreenRenderer = vtkFullScreenRenderWindow.newInstance();
    const renderer = fullScreenRenderer.getRenderer();
    const renderWindow = fullScreenRenderer.getRenderWindow();
    renderWindowRef.current = renderWindow;

    const interactor = renderWindow.getInteractor();
    interactor.setInteractorStyle(vtkInteractorStyleImage.newInstance());

    const reader = vtkHttpDataSetReader.newInstance({ fetchGzip: true });
    const mapper = vtkImageMapper.newInstance();
    const actor = vtkImageSlice.newInstance();

    mapper.setInputConnection(reader.getOutputPort());
    actor.setMapper(mapper);
    renderer.addActor(actor);

    // TODO: Fix VTK data loading
    // reader.setUrl(volumePath);
    // reader.loadData();
    // const image = reader.getOutputData();
    // renderer.resetCamera(image.getBounds());
    renderWindow.render();

    return () => {
      fullScreenRenderer.delete();
      reader.delete();
      mapper.delete();
      actor.delete();
    };
  }, []);

  return <div ref={renderWindowRef} style={{ width: '100%', height: '100%' }} />;
};

export default VTKComponent;
