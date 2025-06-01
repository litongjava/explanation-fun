// src/pages/PlayerPage.tsx
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import DPlayer from 'dplayer';
import Hls from 'hls.js';
import './PlayerPage.css';
import { sendVideoSSERequest, type SSEEvent } from '../client/SSEClient.ts';

interface VideoInfo {
  videoUrl: string;
  coverUrl: string;
  title: string;
}

interface SSERouteParams {
  prompt: string;
  provider: string;
  voice_provider: string;
  voice_id: string;
  language: string;
  user_id: string;
}

export default function PlayerPage() {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // SSE 传进来的参数，当 URL 里还没 id 时，就在这里发 SSE
  const sseParams = (location.state as SSERouteParams) || null;

  const containerRef = useRef<HTMLDivElement>(null);
  const dpRef = useRef<any>(null);

  // 影片信息：有值时就立即播放
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);

  // “videoId” 保存当前已知的 ID（无论是从 routeId 来，还是 SSE 返回来的）
  const [videoId, setVideoId] = useState<string | null>(routeId || null);

  // loading 状态：在没有 videoInfo 时为 true
  const [, setLoadingInfo] = useState<boolean>(true);

  // 倒计时、累计秒数、是否超出两分钟
  const [countdown, setCountdown] = useState(120);
  const [pastTwoMinutes, setPastTwoMinutes] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // 收到的 progress 文本列表，渲染到底部
  const [progressList, setProgressList] = useState<string[]>([]);

  // 用来标记 SSE 是否已经结束
  const [isSSEDone, setIsSSEDone] = useState<boolean>(true);

  // 用来保存 SSEReader Controller，以便后面主动取消
  const sseReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const hasSubscribed = useRef(false);

  // —— STEP A：初始化倒计时、累计秒数 ——
  useEffect(() => {
    // 如果已经有 videoInfo，就不需要倒计时
    if (videoInfo) {
      setLoadingInfo(false);
      return;
    }
    if (!videoInfo && videoId) {
      // 有 videoId 但是还没拿到 videoInfo，也要继续 loading
      setLoadingInfo(true);
    }

    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [videoInfo, videoId]);

  useEffect(() => {
    if (countdown === 0) {
      setPastTwoMinutes(true);
    }
  }, [countdown]);

  // —— STEP B：如果 URL 里已有 ID，直接去拉一次 /video/detail 拿 video_url ——
  useEffect(() => {
    // 如果路由里带了 id，就优先去拿详情
    if (videoId && isSSEDone) {
      fetchVideoDetail(videoId);
    }
    // 只依赖 videoId & sseParams，如果这俩都不改变，就不会重复跑
  }, [videoId]);

  // helper：拉一次 video/detail 并处理
  async function fetchVideoDetail(id: string) {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_BACKEND_BASE_URL}/api/v1/video/detail?id=${id}`
      );
      const result = await res.json();
      if (res.ok && result.code === 1 && result.ok && result.data) {
        const data = result.data as any;
        if (data.video_url) {
          // 拿到 video_url 立即播放
          setVideoInfo({
            videoUrl: data.video_url,
            coverUrl: data.cover_url,
            title: data.title || data.title || 'Video',
          });
        }
      }
    } catch (err) {
      console.error('fetchVideoDetail 出错:', err);
    }
  }

  // —— STEP C：如果 URL 没有 ID，但 location.state 有 SSE 参数，就发 SSE ——
  useEffect(() => {
    // 只有当 videoId 为空（URL 里没 ID）&& sseParams 有值 时，才做 SSE
    if (!videoId && sseParams && !hasSubscribed.current) {
      hasSubscribed.current = true;
      setIsSSEDone(false);
      sendVideoSSERequest({
        prompt: sseParams.prompt,
        provider: sseParams.provider,
        voice_provider: sseParams.voice_provider,
        voice_id: sseParams.voice_id,
        language: sseParams.language,
        user_id: sseParams.user_id,
        onEvent: (event: SSEEvent) => {
          // 1) 如果收到 progress，就把信息 append 到列表
          if (event.type === 'progress') {
            try {
              const payload = JSON.parse(event.data) as { info: string };
              setProgressList((prev) => [...prev, payload.info]);
            } catch {
              setProgressList((prev) => [...prev, event.data]);
            }
          }

          // 2) 如果收到 task / metadata，就解析出 id，并把 URL 栏替换成 /player/<id>
          if (event.type === 'task' || event.type === 'metadata') {
            try {
              const payload = JSON.parse(event.data) as { id: string };
              const newId = payload.id;
              setVideoId(newId);
              // 把地址替换成 /player/<newId>，但不刷新页面
              window.history.replaceState({}, '', `/player/${newId}`);
            } catch (e) {
              console.error('解析 task/metadata 失败:', e);
            }
          }

          // 3) 如果收到 main，就表示已经拿到视频播放 URL，直接设置 videoInfo
          if (event.type === 'main') {
            try {
              const payload = JSON.parse(event.data) as { url: string };
              const videoUrl = payload.url;
              setVideoInfo((prev) => ({
                videoUrl,
                coverUrl: prev?.coverUrl || '',
                title: prev?.title || sseParams.prompt,
              }));
            } catch (e) {
              console.error('解析 main event 失败:', e);
            }
          }

          // 4) 如果连接结束但还没拿到 video_url，就交给后面 STEP D 的轮询去拿
          if (event.type === 'done') {
            sseReaderRef.current = null;
            setIsSSEDone(true);
          }
        },
      }).catch((e) => {
        console.error('SSE 请求出错:', e);
        // 如果 SSE 本身失败，也让轮询有机会启动
        setIsSSEDone(true);
      });
    }
  }, [videoId, sseParams]);

  // —— STEP D：如果 SSE 完成或根本没有 SSE，但拿到 videoId 且还没拿到 videoInfo，就继续轮询，一直到 30 分钟为止 ——
  useEffect(() => {
    const shouldPoll = Boolean(videoId && !videoInfo && (isSSEDone || !sseParams));
    if (!shouldPoll) {
      return;
    }

    const pollInterval = 5000;
    const timerRef = { current: 0 as number };

    async function tryFetch() {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_BASE_URL}/api/v1/video/detail?id=${videoId}`
        );
        const result = await res.json();
        if (res.ok && result.code === 1 && result.ok && result.data) {
          const data = result.data as any;
          if (data.video_url) {
            clearInterval(timerRef.current);
            setVideoInfo({
              videoUrl: data.video_url,
              coverUrl: data.cover_url,
              title: data.title || data.title || 'Video',
            });
          }
        }
      } catch (err) {
        console.error('轮询 fetchVideoDetail 失败:', err);
      }
    }
    timerRef.current = window.setInterval(() => {
      if (elapsedSeconds >= 1800) {
        clearInterval(timerRef.current);
        window.alert('视频生成超时，请联系 litonglinux@qq.com 获取帮助。');
        return;
      }
      if (videoInfo) {
        clearInterval(timerRef.current);
        return;
      }
      tryFetch();
    }, pollInterval);

    return () => {
      clearInterval(timerRef.current);
    };
  }, [videoId, videoInfo, elapsedSeconds, isSSEDone, sseParams]);

  // —— STEP E：一旦拿到 videoInfo，就初始化 DPlayer 播放器 ——
  useEffect(() => {
    if (!videoInfo || !containerRef.current) {
      return;
    }
    setLoadingInfo(false);

    let videoType: string = 'normal';
    if (videoInfo.videoUrl.endsWith('.m3u8')) {
      videoType = 'hls';
      // @ts-ignore
      window.Hls = Hls;
    }

    dpRef.current = new DPlayer({
      container: containerRef.current!,
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

  // —— STEP F：根据状态渲染不同 UI ——
  // 1) 没有 videoId，也没有 sseParams：这基本上进不到这儿，一般会被 “未找到视频 ID” 拦截
  if (!videoId && !sseParams) {
    return (
      <div className="player-page">
        <h2>未找到视频 ID 或生成参数</h2>
        <button onClick={() => navigate('/')}>返回首页</button>
      </div>
    );
  }

  // 2) 有 sseParams 且还没拿到 videoId：说明正在 SSE 阶段或倒计时阶段
  //    或者：videoId 已经有，但 countdown > 0，说明在 2 分钟内还没拿到 videoInfo
  if (
    (!videoInfo && !routeId && sseParams) ||
    (!videoInfo && countdown > 0 && videoId)
  ) {
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
          <p>若超过两分钟，将继续后台轮询，最长等待30分钟。</p>
        </div>
        <div className="progress-list">
          <h3>进度更新：</h3>
          <ul>
            {progressList.map((info, idx) => (
              <li key={idx}>{info}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // 3) 倒计时已过两分钟，但还没拿到 videoInfo，且没超过 30 分钟
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
        <div className="progress-list">
          <h3>进度更新：</h3>
          <ul>
            {progressList.map((info, idx) => (
              <li key={idx}>{info}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // 4) 超过 30 分钟还没拿到 videoInfo
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
        <div className="progress-list">
          <h3>进度更新：</h3>
          <ul>
            {progressList.map((info, idx) => (
              <li key={idx}>{info}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // 5) 成功拿到 videoInfo，展示播放器
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