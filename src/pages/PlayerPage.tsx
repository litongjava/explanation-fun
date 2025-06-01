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
  answer: string;
  transcript: string[];
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

  // SSE 传入的参数
  const sseParams = (location.state as SSERouteParams) || null;

  const containerRef = useRef<HTMLDivElement>(null);
  const dpRef = useRef<any>(null);

  // 完整的 VideoInfo，通过接口获取
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);

  // 当前视频 ID
  const [videoId, setVideoId] = useState<string | null>(routeId || null);

  // loading 状态
  const [, setLoadingInfo] = useState<boolean>(true);

  // 倒计时、累计秒数
  const [countdown, setCountdown] = useState(120);
  const [pastTwoMinutes, setPastTwoMinutes] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // SSE 进度列表
  const [progressList, setProgressList] = useState<string[]>([]);
  const [isSSEDone, setIsSSEDone] = useState<boolean>(true);
  const sseReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const hasSubscribed = useRef(false);

  // 心跳时间和已过秒数
  const [lastHeartbeatTime, setLastHeartbeatTime] = useState<number | null>(null);
  const [heartbeatElapsed, setHeartbeatElapsed] = useState<number>(0);

  // 当前活动标签：'info' | 'answer' | 'transcript'
  const [activeTab, setActiveTab] = useState<'info' | 'answer' | 'transcript'>('info');

  // —— STEP A：倒计时 & 累计秒数计时器 ——
  useEffect(() => {
    if (videoInfo) {
      setLoadingInfo(false);
      return;
    }
    if (!videoInfo && videoId) {
      setLoadingInfo(true);
    }

    const timer = window.setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
      setCountdown(prev => (prev > 0 ? prev - 1 : 0));
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

  // 心跳计时器
  useEffect(() => {
    if (lastHeartbeatTime === null) return;
    const hbTimer = window.setInterval(() => {
      setHeartbeatElapsed(Math.floor((Date.now() - lastHeartbeatTime) / 1000));
    }, 1000);
    return () => {
      clearInterval(hbTimer);
    };
  }, [lastHeartbeatTime]);

  // —— STEP B：若 URL 中已有 ID，立即拉取视频详情 ——
  useEffect(() => {
    if (videoId && isSSEDone) {
      fetchVideoDetail(videoId);
    }
  }, [videoId, isSSEDone]);

  async function fetchVideoDetail(id: string) {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_BACKEND_BASE_URL}/api/v1/video/detail?id=${id}`
      );
      const result = await res.json();
      if (res.ok && result.code === 1 && result.ok && result.data) {
        const data = result.data as any;
        if (data.video_url) {
          setVideoInfo({
            videoUrl: data.video_url,
            coverUrl: data.cover_url,
            title: data.title || 'Video',
            answer: data.answer || '',
            transcript: Array.isArray(data.transcript) ? data.transcript : [],
          });
        }
      }
    } catch (err) {
      console.error('fetchVideoDetail 出错:', err);
    }
  }

  // —— STEP C：如果 URL 无 ID，但有 SSE 参数，则发起 SSE ——
  useEffect(() => {
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
          // 心跳事件
          if (event.type === 'heartbeat') {
            setLastHeartbeatTime(Date.now());
            setHeartbeatElapsed(0);
            return;
          }

          // 进度更新
          if (event.type === 'progress') {
            try {
              const payload = JSON.parse(event.data) as { info: string };
              setProgressList(prev => [...prev, payload.info]);
            } catch {
              setProgressList(prev => [...prev, event.data]);
            }
            return;
          }

          // 收到 ID（task/metadata）
          if (event.type === 'task' || event.type === 'metadata') {
            try {
              const payload = JSON.parse(event.data) as { id: string };
              const newId = payload.id;
              setVideoId(newId);
              window.history.replaceState({}, '', `/player/${newId}`);
            } catch (e) {
              console.error('解析 task/metadata 失败:', e);
            }
            return;
          }

          // 收到 main（直接拿到播放 URL）
          if (event.type === 'main') {
            try {
              const payload = JSON.parse(event.data) as { url: string };
              const videoUrl = payload.url;
              setVideoInfo(prev => ({
                videoUrl,
                coverUrl: prev?.coverUrl || '',
                title: prev?.title || sseParams.prompt,
                answer: '',
                transcript: [],
              }));
            } catch (e) {
              console.error('解析 main event 失败:', e);
            }
            return;
          }

          // SSE 完成
          if (event.type === 'done') {
            sseReaderRef.current = null;
            setIsSSEDone(true);
            return;
          }
        },
      }).catch(e => {
        console.error('SSE 请求出错:', e);
        setIsSSEDone(true);
      });
    }
  }, [videoId, sseParams]);

  // —— STEP D：轮询获取 videoInfo ——
  useEffect(() => {
    const shouldPoll = Boolean(videoId && !videoInfo && (isSSEDone || !sseParams));
    if (!shouldPoll) return;

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
              title: data.title || 'Video',
              answer: data.answer || '',
              transcript: Array.isArray(data.transcript) ? data.transcript : [],
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

  // —— STEP E：初始化 DPlayer 播放器 ——
  useEffect(() => {
    if (!videoInfo || !containerRef.current) return;
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

  // 渲染不同状态下的 UI
  const renderContent = () => {
    // 1) 未找到 videoId，也没有 SSE 参数
    if (!videoId && !sseParams) {
      return (
        <div className="player-page">
          <h2>未找到视频 ID 或生成参数</h2>
          <button onClick={() => navigate('/')}>返回首页</button>
        </div>
      );
    }

    // 2) 视频生成中（前两分钟）
    if ((!videoInfo && !routeId && sseParams) || (!videoInfo && countdown > 0 && videoId)) {
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
          {!isSSEDone && (
            <div className="heartbeat-info">
              <p>距离上次心跳：{heartbeatElapsed} 秒</p>
            </div>
          )}
          {!isSSEDone && (
            <div className="progress-list">
              <h3>进度更新：</h3>
              <ul>
                {progressList.map((info, idx) => (
                  <li key={idx}>{info}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }

    // 3) 超过两分钟继续后台轮询
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
            <p>已超过两分钟，正在继续后台轮询，请耐心等待。若超过30分钟仍然缺少结果，会提示您联系客服。</p>
            <p>
              已等待：{Math.floor(elapsedSeconds / 60)} 分 {elapsedSeconds % 60} 秒
            </p>
          </div>
          {!isSSEDone && (
            <div className="heartbeat-info">
              <p>距离上次心跳：{heartbeatElapsed} 秒</p>
            </div>
          )}
          {!isSSEDone && (
            <div className="progress-list">
              <h3>进度更新：</h3>
              <ul>
                {progressList.map((info, idx) => (
                  <li key={idx}>{info}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }

    // 4) 超过30分钟仍未拿到 videoInfo => 失败视图
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
          {!isSSEDone && (
            <div className="heartbeat-info">
              <p>距离上次心跳：{heartbeatElapsed} 秒</p>
            </div>
          )}
          {!isSSEDone && (
            <div className="progress-list">
              <h3>进度更新：</h3>
              <ul>
                {progressList.map((info, idx) => (
                  <li key={idx}>{info}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }

    // 5) 拿到 videoInfo => 播放器 + 标签页
    if (videoInfo) {
      return (
        <div className="player-page">
          <header className="player-header">
            <button onClick={() => navigate(-1)} className="back-button">
              ← 返回
            </button>
            <h1>{videoInfo.title}</h1>
          </header>

          <div className="video-container">
            <div ref={containerRef}></div>
          </div>

          {/* 标签页切换 */}
          <div className="tabs">
            <button
              className={activeTab === 'info' ? 'tab active' : 'tab'}
              onClick={() => setActiveTab('info')}
            >
              视频信息
            </button>
            <button
              className={activeTab === 'answer' ? 'tab active' : 'tab'}
              onClick={() => setActiveTab('answer')}
            >
              Answer
            </button>
            <button
              className={activeTab === 'transcript' ? 'tab active' : 'tab'}
              onClick={() => setActiveTab('transcript')}
            >
              Transcript
            </button>
          </div>

          <div className="tab-content">
            {activeTab === 'info' && (
              <div className="tab-panel info-panel">
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
            )}

            {activeTab === 'answer' && (
              <div className="tab-panel answer-panel">
                <pre className="answer-text">{videoInfo.answer}</pre>
              </div>
            )}

            {activeTab === 'transcript' && (
              <div className="tab-panel transcript-panel">
                <ul>
                  {videoInfo.transcript.map((line, idx) => (
                    <li key={idx}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* 如果 SSE 还没结束，继续显示心跳与进度 */}
          {!isSSEDone && (
            <div className="heartbeat-info">
              <p>距离上次心跳：{heartbeatElapsed} 秒</p>
            </div>
          )}
          {!isSSEDone && (
            <div className="progress-list">
              <h3>进度更新：</h3>
              <ul>
                {progressList.map((info, idx) => (
                  <li key={idx}>{info}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  return <>{renderContent()}</>;
}
