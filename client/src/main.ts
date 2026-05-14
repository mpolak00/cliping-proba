import { initApp } from './app.js';
import './style.css';

// Bootstrap the application once the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
