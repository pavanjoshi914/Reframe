import React from 'react';
import ReactDOM from 'react-dom/client';
import { EditorApp } from './EditorApp';
import '../index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <EditorApp />
  </React.StrictMode>
);
