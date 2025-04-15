import React, {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import './HomePage.css'; // 根据需要编写样式

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
  // 可根据需要添加其他字段
};

export default function HomePage() {
  const navigate = useNavigate();
  // 输入主题的 state
  const [topic, setTopic] = useState('');
  // 生成后的视频记录（可以用于历史记录）
  const [generatedVideo, setGeneratedVideo] = useState<VideoItem | null>(null);
  // 错误提示信息
  const [error, setError] = useState('');
  // 加载状态
  const [loading, setLoading] = useState(false);

  // 分页参数：当前页(起始页面为1)和每页的数量
  const [page, setPage] = useState(1);
  const limit = 12;
  // 总视频数量（假设后端返回的是视频总数）
  const [total, setTotal] = useState(0);
  // 存储推荐视频列表
  const [videos, setVideos] = useState<VideoItem[]>([]);

  // 根据页码加载推荐视频列表，计算 offset 为 (page - 1)
  useEffect(() => {
    const offset = page - 1;
    fetch(`https://manim.fly.dev/api/v1/video/recommends?offset=${offset}&limit=${limit}&sort_by=recent`)
      .then(response => response.json())
      .then(data => {
        if (data.code === 1 && data.ok) {
          setVideos(data.data.videos);
          setTotal(data.data.total);
        } else {
          console.error('获取推荐视频返回错误：', data);
        }
      })
      .catch(err => {
        console.error('获取推荐视频失败:', err);
      });
  }, [page]);

  // 调用生成接口生成视频
  const generateVideo = () => {
    if (!topic.trim()) {
      setError('请输入主题');
      return;
    }
    setError('');
    setLoading(true);

    const url = `https://manim.fly.dev/manim/video?topic=${encodeURIComponent(topic)}`;
    fetch(url)
      .then(res => res.json())
      .then((data: GenerationResponse) => {
        setLoading(false);
        if (data.code === 1 && data.ok && data.data) {
          const newVideo: VideoItem = {
            id: new Date().getTime().toString(), // 生成一个简单的唯一 ID
            cover_url: data.data.cover_url,
            title: topic,
            video_url: data.data.video_url,
          };
          setGeneratedVideo(newVideo);
          // 如果需要，也可以直接加入推荐列表中，实现“历史记录”
          // setVideos(prev => [newVideo, ...prev]);
        } else {
          setError('视频生成失败');
        }
      })
      .catch(err => {
        console.error('生成视频出错:', err);
        setLoading(false);
        setError('视频生成失败');
      });
  };

  // 点击视频跳转到播放器页面
  const handlePlayVideo = (video: VideoItem) => {
    navigate(`/player/${video.id}`, {
      state: {videoUrl: video.video_url, coverUrl: video.cover_url, title: video.title},
    });
  };

  // 分页操作：上一页 & 下一页
  const handlePreviousPage = () => {
    if (page > 1) {
      setPage(page - 1);
    }
  };

  // 假设 total 表示总视频条数，那么总页数为 Math.ceil(total/limit)
  const totalPages = Math.ceil(total / limit);
  const handleNextPage = () => {
    if (page < totalPages) {
      setPage(page + 1);
    }
  };

  return (
    <div className="home-page">
      <h1>Teach Me Anything</h1>

      {/* 输入生成视频的部分 */}
      <div className="generate-section">
        <input
          type="text"
          placeholder="描述想要讲解的技术概念"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <button onClick={generateVideo} disabled={loading}>
          {loading ? '生成中...' : '生成视频'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {/* 生成成功后的视频卡片 */}
      {generatedVideo && (
        <div className="generated-card">
          <h3>{generatedVideo.title}</h3>
          <img src={generatedVideo.cover_url} alt={generatedVideo.title} width="160"/>
          <button onClick={() => handlePlayVideo(generatedVideo)}>去播放</button>
        </div>
      )}

      {/* 推荐/历史视频展示 */}
      <h2>推荐/历史视频</h2>
      <div className="videos-grid">
        {videos.map((video) => (
          <div
            key={video.id}
            className="video-item"
            onClick={() => handlePlayVideo(video)}
          >
            <img src={video.cover_url} alt={video.title} width="160" height="90"/>
            <p>{video.title}</p>
          </div>
        ))}
      </div>

      {/* 分页控制 */}
      <div className="pagination">
        <button onClick={handlePreviousPage} disabled={page === 1}>
          上一页
        </button>
        <span>
          第 {page} 页，共 {totalPages} 页
        </span>
        <button onClick={handleNextPage} disabled={page === totalPages}>
          下一页
        </button>
      </div>
    </div>
  );
}
