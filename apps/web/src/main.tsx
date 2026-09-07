import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyStoredThemeOnLoad } from './app/theme';
import './styles/tokens.css';
import './styles/base/shell.css';
import './styles/base/form.css';

// Before anything renders, so a saved custom theme (see app/theme.ts) is already in place —
// no flash of the default look first.
applyStoredThemeOnLoad();

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root element not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
