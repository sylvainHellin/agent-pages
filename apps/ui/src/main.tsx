import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
/* Pretendard (Korean + Latin), self-hosted: split by unicode-range, the browser loads only the slices a page uses */
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './index.css'
import './lib/theme'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
