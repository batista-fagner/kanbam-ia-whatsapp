import { useState } from 'react'
import LoginPage from './pages/LoginPage'
import KanbanPage from './pages/KanbanPage'

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false)

  return loggedIn
    ? <KanbanPage onLogout={() => setLoggedIn(false)} />
    : <LoginPage onLogin={() => setLoggedIn(true)} />
}
