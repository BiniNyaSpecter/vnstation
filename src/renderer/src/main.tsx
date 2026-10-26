import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import './styles/ui.css'
import './styles/game.css'
import './styles/shell.css'
import './styles/views.css'
import './styles/social.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
