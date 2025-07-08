// App.tsx
import {HashRouter, Route, Routes} from 'react-router-dom';
import HomePage from './pages/HomePage';
import PlayerPage from './pages/PlayerPage';
import Footer from "./componment/Footer.tsx";


function App() {
  return (
    <div style={{
      position: 'relative',
      minHeight: '100vh',
      paddingBottom: '50px',
      fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    }}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/player/:id?" element={<PlayerPage />} />
        </Routes>
      </HashRouter>
      <Footer />
    </div>
  );
}

export default App;