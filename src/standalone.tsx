import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import App from './app';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary fallback={<p className="p-6">页面加载失败，请刷新后重试。</p>}>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
