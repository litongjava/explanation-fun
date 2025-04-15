import React, {useEffect, useState} from 'react';
import './App.css';

type GenerationResponse = {
  code: number;
  ok: boolean;
  data: {
    video_path: string;
    cover_url: string;
    video_length: number;
    video_url: string;
  };
  error: any;
  msg: any;
};

type VideoItem = {
  id: string;
  cover_url: string;
  title: string;
  video_url: string;
  // 其他字段根据需要扩展
};

function App() {
  // 输入主题的 state
  const [topic, setTopic] = useState('');
  // 当前播放的视频 URL、封面等
  const [videoUrl, setVideoUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  // 用于展示错误信息
  const [error, setError] = useState('');
  // 推荐的视频列表
  const [videos, setVideos] = useState<VideoItem[]>([]);
  // 加载状态
  const [loading, setLoading] = useState(false);

  // 页面加载时获取推荐视频列表
  useEffect(() => {
    fetch('https://manim.fly.dev/api/v1/video/recommends?offset=0&limit=12&sort_by=recent')
      .then(response => response.json())
      .then(data => {
        if (data.code === 1 && data.ok) {
          setVideos(data.data.videos);
        }
      })
      .catch(err => {
        console.error('获取推荐视频失败:', err);
      });
  }, []);

  // 调用生成接口，生成视频
  const generateVideo = () => {
    if (!topic.trim()) {
      setError('请输入主题');
      return;
    }
    setError('');
    setLoading(true);
    const url = `https://manim.fly.dev/manim/video?topic=${encodeURIComponent(topic)}`;
    fetch(url)
      .then(response => response.json())
      .then((data: GenerationResponse) => {
        setLoading(false);
        if (data.code === 1 && data.ok && data.data) {
          // 使用生成接口返回的 mp4 视频地址进行播放（也可根据实际情况选择 m3u8 地址）
          setVideoUrl(data.data.video_url);
          setCoverUrl(data.data.cover_url);
        } else {
          setError('视频生成失败');
          // 如需要播放错误或默认视频，可在此设置 fallback 视频 URL
          // setVideoUrl('https://xxx/default-error-video.mp4');
        }
      })
      .catch(err => {
        console.error('生成视频出错:', err);
        setLoading(false);
        setError('视频生成失败');
      });
  };

  // 播放指定视频（点击推荐列表中的视频）
  const playVideo = (url: string, cover?: string) => {
    setVideoUrl(url);
    if (cover) {
      setCoverUrl(cover);
    }
  };

  return (
    <div className="App">
      <h1>视频生成和回放</h1>
      {/* 输入主题生成视频 */}
      <div className="generate-section">
        <input
          type="text"
          placeholder="输入主题"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <button onClick={generateVideo} disabled={loading}>
          {loading ? '生成中...' : '生成视频'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {/* 视频播放器 */}
      {videoUrl && (
        <div className="video-player">
          <video width="640" height="360" controls poster={coverUrl}>
            <source src={videoUrl} type="video/mp4"/>
            您的浏览器不支持 video 标签。
          </video>
        </div>
      )}
      {/* 展示推荐的（之前播放过的）视频 */}
      <div className="video-list">
        <h2>之前播放的视频</h2>
        <div className="videos-grid">
          {videos.map((video) => (
            <div
              key={video.id}
              className="video-item"
              onClick={() => playVideo(video.video_url, video.cover_url)}
            >
              <img src={video.cover_url} alt={video.title} width="160" height="90"/>
              <p>{video.title}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
