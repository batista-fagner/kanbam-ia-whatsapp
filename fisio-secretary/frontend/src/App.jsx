import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import KanbanPage from './pages/KanbanPage'
import BulkMessagePage from './pages/BulkMessagePage'
import Layout from './components/Layout'

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false)

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={!loggedIn ? <LoginPage onLogin={() => setLoggedIn(true)} /> : null}
        />
        <Route
          element={loggedIn ? <Layout onLogout={() => setLoggedIn(false)} /> : <LoginPage onLogin={() => setLoggedIn(true)} />}
        >
          <Route path="/" element={<KanbanPage />} />
          <Route path="/mass-message" element={<BulkMessagePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
