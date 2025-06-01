// src/pages/PlayerPage.tsx

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import DPlayer from 'dplayer';
import Hls from 'hls.js';
import './PlayerPage.css';

interface VideoInfo {
  videoUrl: string;
  coverUrl: string;
  title: string;
}

export default function PlayerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const containerRef = useRef<HTMLDivElement>(null);
  const dpRef = useRef<any>(null);

  const locationState = (location.state as any) as { title?: string; videoUrl?: string; coverUrl?: string } | undefined;

  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(
    locationState && locationState.videoUrl
      ? {
        videoUrl: locationState.videoUrl,
        coverUrl: locationState.coverUrl || '',
        title: locationState.title || 'Video',
      }
      : null
  );
  const [loadingInfo, setLoadingInfo] = useState(!videoInfo);

  const [countdown, setCountdown] = useState(120);
  const [pastTwoMinutes, setPastTwoMinutes] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // 每秒更新倒计时和累计秒数
  useEffect(() => {
    if (!videoInfo && id) {
      setLoadingInfo(true);
    }

    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [id, videoInfo]);

  useEffect(() => {
    if (countdown === 0) {
      setPastTwoMinutes(true);
    }
  }, [countdown]);

  // —— 下面这段是改进后的轮询逻辑 ——
  useEffect(() => {
    if (!id) return;

    // 如果已经拿到 videoInfo，就不需要轮询了
    if (videoInfo) {
      return;
    }

    const pollInterval = 5000; // 5 秒
    const timerRef = { current: 0 as number }; // 用 useRef 也行，这里用普通对象包一下

    // 封装一次 fetch，拿到 video_url 就立即清除定时器
    async function pollForUrl() {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_BASE_URL}/api/v1/video/detail?id=${id}`
        );
        const result = await res.json();
        if (res.ok && result.code === 1 && result.ok && result.data) {
          const data = result.data as any;
          if (data.video_url) {
            // 拿到可播放的 URL，立刻清除后续所有轮询
            clearInterval(timerRef.current);
            setVideoInfo({
              videoUrl: data.video_url,
              coverUrl: data.cover_url,
              title: data.title || 'Video',
            });
            return;
          }
        }
      } catch (err) {
        console.error('轮询获取视频信息失败:', err);
      }
    }

    // 先立刻调用一次，如果两分钟内可能已经就完成了
    pollForUrl();

    // 然后每 5 秒再拉一次
    timerRef.current = window.setInterval(() => {
      // 如果超过 30 分钟（1800 秒），放弃并提示
      if (elapsedSeconds >= 1800) {
        clearInterval(timerRef.current);
        window.alert('视频生成超时，请联系 litonglinux@qq.com 获取帮助。');
        return;
      }
      // 如果此时 videoInfo 已经被 set，先安全地 clear 掉
      if (videoInfo) {
        clearInterval(timerRef.current);
        return;
      }
      // 继续拉取
      pollForUrl();
    }, pollInterval);

    // 清理：组件卸载 或 依赖变化时，清掉这次的定时器
    return () => {
      clearInterval(timerRef.current);
    };
    // 只要 id、elapsedSeconds 或 videoInfo 改变，就重新跑一次。
  }, [id, elapsedSeconds, videoInfo]);
  // —— 轮询逻辑结束 ——

  // —— DPlayer 初始化：一旦 videoInfo 有值立即运行 ——
  useEffect(() => {
    if (!videoInfo || !containerRef.current) return;

    let videoType: string = 'normal';
    if (videoInfo.videoUrl.endsWith('.m3u8')) {
      videoType = 'hls';
      (window as any).Hls = Hls;
    }

    dpRef.current = new DPlayer({
      container: containerRef.current,
      autoplay: false,
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
          maxBufferLength: 60,
          maxMaxBufferLength: 600,
          maxBufferSize: 50 * 1000 * 1000,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 10,
        },
      },
    });

    if (videoType === 'hls' && dpRef.current.video) {
      dpRef.current.video.addEventListener('loadedmetadata', () => {
        dpRef.current.video.currentTime = 0.1;
        dpRef.current.play();
      });
    }

    return () => {
      if (dpRef.current) {
        if (dpRef.current.$hls) {
          dpRef.current.$hls.destroy();
        }
        dpRef.current.destroy();
        dpRef.current = null;
      }
    };
  }, [videoInfo]);
  // —— DPlayer 逻辑结束 ——

  if (!id) {
    return (
      <div className="player-page">
        <h2>未找到视频 ID</h2>
        <button onClick={() => navigate('/')}>返回首页</button>
      </div>
    );
  }

  // 下面保持原来的各种“倒计时页面”、“继续等待页面”、“超时失败页面”判断
  if (!videoInfo && loadingInfo) {
    return (
      <div className="player-page">
        <header className="player-header">
          <button onClick={() => navigate(-1)} className="back-button">
            ← 返回
          </button>
          <h1>生成中…请稍候</h1>
        </header>
        <div className="countdown">
          <p>
            预计等待：{Math.floor(countdown / 60)} 分 {countdown % 60} 秒
          </p>
        </div>
        <div className="waiting-info">
          <p>如果两分钟内完成生成，将自动播放。</p>
          <p>若超过两分钟，将继续为您轮询，最长等待30分钟。</p>
        </div>
      </div>
    );
  }

  if (!videoInfo && pastTwoMinutes && elapsedSeconds < 1800) {
    return (
      <div className="player-page">
        <header className="player-header">
          <button onClick={() => navigate(-1)} className="back-button">
            ← 返回
          </button>
          <h1>继续等待生成</h1>
        </header>
        <div className="waiting-info">
          <p>
            已超过两分钟，正在继续后台轮询，请耐心等待。若超过30分钟仍然缺少结果，会提示您联系客服。
          </p>
          <p>
            已等待：{Math.floor(elapsedSeconds / 60)} 分 {elapsedSeconds % 60} 秒
          </p>
        </div>
      </div>
    );
  }

  if (!videoInfo && elapsedSeconds >= 1800) {
    return (
      <div className="player-page">
        <header className="player-header">
          <button onClick={() => navigate(-1)} className="back-button">
            ← 返回
          </button>
          <h1>生成失败</h1>
        </header>
        <div className="error-info">
          <p>视频生成超时，请联系 litonglinux@qq.com 获取帮助。</p>
        </div>
      </div>
    );
  }

  // 拿到 videoInfo 之后，就只剩播放器视图
  return (
    <div className="player-page">
      <header className="player-header">
        <button onClick={() => navigate(-1)} className="back-button">
          ← 返回
        </button>
        <h1>{videoInfo!.title}</h1>
      </header>
      <div className="video-container">
        <div ref={containerRef}></div>
      </div>
      <div className="video-info">
        <h3>视频信息</h3>
        <p>
          <strong>视频地址: </strong>
          <a href={videoInfo!.videoUrl} target="_blank" rel="noopener noreferrer">
            {videoInfo!.videoUrl}
          </a>
        </p>
        <p>
          <strong>封面地址: </strong>
          <a href={videoInfo!.coverUrl} target="_blank" rel="noopener noreferrer">
            {videoInfo!.coverUrl}
          </a>
        </p>
      </div>
    </div>
  );
}
