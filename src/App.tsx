// App.tsx
import {BrowserRouter, Route, Routes} from 'react-router-dom';
import HomePage from './pages/HomePage';
import PlayerPage from './pages/PlayerPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage/>}/>
        {/* 路由中包含 video id 参数 */}
        <Route path="/player/:id?" element={<PlayerPage/>}/>
      </Routes>
    </BrowserRouter>
  );
}

export default App;