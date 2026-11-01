import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@ceo/shared/theme.css';
import './desktop.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
