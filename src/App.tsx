// App.tsx
import {HashRouter, Route, Routes} from 'react-router-dom';
import HomePage from './pages/HomePage';
import PlayerPage from './pages/PlayerPage';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage/>}/>
        {/* 路由中包含 video id 参数 */}
        <Route path="/player/:id?" element={<PlayerPage/>}/>
      </Routes>
    </HashRouter>
  );
}

export default App;