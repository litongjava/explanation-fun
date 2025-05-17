import {useEffect, useRef, useState} from 'react';
import {useLocation, useNavigate, useParams} from 'react-router-dom';
import DPlayer from 'dplayer';
import Hls from 'hls.js';
import './PlayerPage.css';

interface VideoInfo {
  videoUrl: string;
  coverUrl: string;
  title: string;
}

export default function PlayerPage() {
  // 从路由中获取 id 参数
  const {id} = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // DPlayer 播放器容器 ref
  const containerRef = useRef<HTMLDivElement>(null);
  // 保存 DPlayer 实例引用，便于后续销毁播放器
  const dpRef = useRef<any>(null);

  // 优先使用 route 的 state 中传入的视频信息
  const locationState = location.state as VideoInfo | undefined;
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(locationState || null);
  const [loading, setLoading] = useState(!locationState);

  // 如果 videoInfo 不存在，则通过路由 id 从后端接口获取视频详情
  useEffect(() => {
    if (!videoInfo && id) {
      fetch(import.meta.env.VITE_BACKEND_BASE_URL + `/api/v1/video/detail?id=${id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.code === 1 && data.ok && data.data) {
            setVideoInfo({
              videoUrl: data.data.video_url,
              coverUrl: data.data.cover_url,
              title: data.data.title || 'Video',
            });
          } else {
            console.error('无法获取视频信息:', data);
          }
          setLoading(false);
        })
        .catch((err) => {
          console.error('获取视频信息出错:', err);
          setLoading(false);
        });
    }
  }, [id, videoInfo]);

  // 当 videoInfo 可用时，初始化 DPlayer 播放器
  useEffect(() => {
    if (videoInfo && containerRef.current) {
      let videoType: string = 'normal';
      // 如果视频地址以 .m3u8 结尾，则使用内置 hls 播放器（须使用全局 Hls）
      if (videoInfo.videoUrl.endsWith('.m3u8')) {
        videoType = 'hls';
        // 将 Hls 挂载到全局（DPlayer 内部会从 window.Hls 获取）
        (window as any).Hls = Hls;
      }

      dpRef.current = new DPlayer({
        container: containerRef.current,
        autoplay: false,
        // 建议设置 preload 为 'auto' 以便尽快加载数据
        preload: 'auto',
        video: {
          url: videoInfo.videoUrl,
          pic: videoInfo.coverUrl,
          type: videoType,
        },
        pluginOptions: {
          hls: {
            debug: false,
            enableWorker: true,
            lowLatencyMode: true,
            // 增大内存缓冲区允许的最大秒数
            maxBufferLength: 60,               // 默认 30s
            maxMaxBufferLength: 600,           // 对 live 场景更友好
            maxBufferSize: 50 * 1000 * 1000,   // 50MB
            // 如果是直播流，可以加快同步速度
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 10,
          },
        },
      });

      // 如果为 hls 播放，添加 loadedmetadata 事件，在视频元数据加载完成后跳转到 0.1 秒（触发缓冲），并启动播放
      if (videoType === 'hls' && dpRef.current && dpRef.current.video) {
        dpRef.current.video.addEventListener('loadedmetadata', () => {
          // 轻微快进以触发加载
          dpRef.current.video.currentTime = 0.1;
          dpRef.current.play();
        });
      }

      // 组件卸载时销毁播放器（以及可能的 hls 实例）
      return () => {
        if (dpRef.current) {
          // 如果自定义挂载了 Hls 实例到播放器上，则销毁它
          if (dpRef.current.$hls) {
            dpRef.current.$hls.destroy();
          }
          dpRef.current.destroy();
          dpRef.current = null;
        }
      };
    }
  }, [videoInfo]);

  if (loading) {
    return (
      <div className="player-page">
        <p>加载视频信息中...</p>
      </div>
    );
  }

  if (!videoInfo) {
    return (
      <div className="player-page">
        <h2>未找到视频信息</h2>
        <button onClick={() => navigate('/')}>返回首页</button>
      </div>
    );
  }

  return (
    <div className="player-page">
      <header className="player-header">
        <button onClick={() => navigate(-1)} className="back-button">
          ← 返回
        </button>
        <h1>{videoInfo.title}</h1>
      </header>

      <div className="video-container">
        {/* DPlayer 播放器容器 */}
        <div ref={containerRef}></div>
      </div>

      <div className="video-info">
        <h3>视频信息</h3>
        <p>
          <strong>视频地址: </strong>
          <a href={videoInfo.videoUrl} target="_blank" rel="noopener noreferrer">
            {videoInfo.videoUrl}
          </a>
        </p>
        <p>
          <strong>封面地址: </strong>
          <a href={videoInfo.coverUrl} target="_blank" rel="noopener noreferrer">
            {videoInfo.coverUrl}
          </a>
        </p>
      </div>
    </div>
  );
}
