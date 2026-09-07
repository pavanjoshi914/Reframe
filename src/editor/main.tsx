// Apply the saved theme before React mounts. Setting it inside a component
// would paint one dark frame first, which reads as a flash on every launch.
try {
  document.documentElement.setAttribute(
    'data-theme', localStorage.getItem('reframe.theme') || 'dark'
  );
} catch { /* private mode — dark is the default anyway */ }

import React from 'react';
import ReactDOM from 'react-dom/client';
import { EditorApp } from './EditorApp';
import '../index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <EditorApp />
  </React.StrictMode>
);
