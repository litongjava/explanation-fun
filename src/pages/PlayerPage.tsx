// src/pages/PlayerPage.tsx
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import DPlayer from 'dplayer';
import Hls from 'hls.js';
import './PlayerPage.css';
import { sendVideoSSERequest, type SSEEvent } from '../client/SSEClient.ts';

// 默认封面URL
const DEFAULT_COVER_URL = 'https://via.placeholder.com/800x450?text=Video+Cover';

interface VideoInfo {
  videoUrl: string;
  coverUrl: string;
  title: string;
  answer: string;
  transcript: string[];
}

interface SSERouteParams {
  question: string;
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
  const isDev = localStorage.getItem('app.env') === 'dev';

  const sseParams = (location.state as SSERouteParams) || null;
  const containerRef = useRef<HTMLDivElement>(null);
  const dpRef = useRef<any>(null);

  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [videoId, setVideoId] = useState<string | null>(routeId || null);
  const [countdown, setCountdown] = useState(180); // 3分钟
  const [pastThreeMinutes, setPastThreeMinutes] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [progressList, setProgressList] = useState<string[]>([]);
  const [isSSEDone, setIsSSEDone] = useState<boolean>(true);
  const [lastHeartbeatTime, setLastHeartbeatTime] = useState<number | null>(null);
  const [heartbeatElapsed, setHeartbeatElapsed] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'info' | 'answer' | 'transcript'>('info');
  const [selectedProvider, setSelectedProvider] = useState(sseParams?.provider || 'openai');
  const sseReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const hasSubscribed = useRef(false);

  // 确保封面URL有效
  const getSafeCoverUrl = (url: string | null | undefined): string => {
    return url && url.trim() !== '' ? url : DEFAULT_COVER_URL;
  };

  // 倒计时和总耗时计时器
  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
      setCountdown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (countdown === 0) setPastThreeMinutes(true);
  }, [countdown]);

  // 心跳计时器
  useEffect(() => {
    if (lastHeartbeatTime === null) return;

    const hbTimer = window.setInterval(() => {
      setHeartbeatElapsed(Math.floor((Date.now() - lastHeartbeatTime) / 1000));
    }, 1000);

    return () => clearInterval(hbTimer);
  }, [lastHeartbeatTime]);

  // 获取视频详情
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
            coverUrl: getSafeCoverUrl(data.cover_url), // 使用安全封面URL
            title: data.title || 'Video',
            answer: data.answer || '',
            transcript: Array.isArray(data.transcript) ? data.transcript : [],
          });
        }
      }
    } catch (err) {
      console.error('获取视频详情出错:', err);
    }
  }

  // 发起SSE请求
  useEffect(() => {
    if (!videoId && sseParams && !hasSubscribed.current) {
      hasSubscribed.current = true;
      setIsSSEDone(false);

      const params = {...sseParams};
      if (isDev) params.provider = selectedProvider;

      sendVideoSSERequest({
        ...params,
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

          // 收到ID
          if (event.type === 'task' || event.type === 'metadata') {
            try {
              const payload = JSON.parse(event.data) as { id: string };
              setVideoId(payload.id);
              window.history.replaceState({}, '', `/player/${payload.id}`);
            } catch (e) {
              console.error('解析ID失败:', e);
            }
            return;
          }

          // 收到播放URL
          if (event.type === 'main') {
            try {
              const payload = JSON.parse(event.data) as { url: string };
              setVideoInfo(prev => ({
                videoUrl: payload.url,
                coverUrl: getSafeCoverUrl(prev?.coverUrl), // 使用安全封面URL
                title: prev?.title || sseParams.question,
                answer: '',
                transcript: [],
              }));
            } catch (e) {
              console.error('解析播放URL失败:', e);
            }
            return;
          }

          // SSE完成
          if (event.type === 'done') {
            sseReaderRef.current = null;
            setIsSSEDone(true);
          }
        },
      }).catch(e => {
        console.error('SSE请求出错:', e);
        setIsSSEDone(true);
      });
    }
  }, [videoId, sseParams, selectedProvider]);

  // 轮询获取视频信息
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
              coverUrl: getSafeCoverUrl(data.cover_url), // 使用安全封面URL
              title: data.title || 'Video',
              answer: data.answer || '',
              transcript: Array.isArray(data.transcript) ? data.transcript : [],
            });
          }
        }
      } catch (err) {
        console.error('轮询获取视频失败:', err);
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

    return () => clearInterval(timerRef.current);
  }, [videoId, videoInfo, elapsedSeconds, isSSEDone, sseParams]);

  // 初始化播放器
  useEffect(() => {
    if (!videoInfo || !containerRef.current) return;

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
        pic: videoInfo.coverUrl, // 确保封面URL有效
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
        if (dpRef.current.$hls) dpRef.current.$hls.destroy();
        dpRef.current.destroy();
        dpRef.current = null;
      }
    };
  }, [videoInfo]);

  // 渲染不同状态下的UI
  const renderContent = () => {
    // 1) 缺少必要参数
    if (!videoId && !sseParams) {
      return (
        <div className="player-page error-view">
          <div className="error-card">
            <h2>未找到视频信息</h2>
            <p>请检查URL或返回首页重新开始</p>
            <button onClick={() => navigate('/')} className="primary-button">
              返回首页
            </button>
          </div>
        </div>
      );
    }

    // 2) 视频生成中（前三分钟）
    if ((!videoInfo && !routeId && sseParams) || (!videoInfo && countdown > 0 && videoId)) {
      return (
        <div className="player-page generating-view">
          <div className="header">
            <button onClick={() => navigate(-1)} className="back-button">
              ← 返回
            </button>
            <h1>视频生成中</h1>
          </div>

          <div className="progress-container">
            <div className="countdown-badge">
              {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
            </div>

            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${((180 - countdown) / 180) * 100}%` }}
              ></div>
            </div>

            <div className="status-message">
              {countdown > 120 ? '准备生成资源...' :
                countdown > 60 ? '处理视频内容...' :
                  '合成最终视频...'}
            </div>
          </div>

          {isDev && (
            <div className="provider-selector">
              <label>LLM Provider:</label>
              <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                disabled={!isSSEDone}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="cohere">Cohere</option>
                <option value="replicate">Replicate</option>
              </select>
            </div>
          )}

          {!isSSEDone && (
            <div className="heartbeat-info">
              <span className="heartbeat-icon">❤️</span>
              心跳: {heartbeatElapsed}秒前
            </div>
          )}

          {progressList.length > 0 && (
            <div className="progress-log">
              <h3>生成日志</h3>
              <div className="log-container">
                {progressList.map((info, idx) => (
                  <div key={idx} className="log-entry">
                    <span className="log-time">
                      {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {info}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    // 3) 超过三分钟继续后台轮询
    if (!videoInfo && pastThreeMinutes && elapsedSeconds < 1800) {
      return (
        <div className="player-page generating-view">
          <div className="header">
            <button onClick={() => navigate(-1)} className="back-button">
              ← 返回
            </button>
            <h1>后台处理中</h1>
          </div>

          <div className="waiting-message">
            <div className="spinner"></div>
            <p>视频仍在生成中，请耐心等待...</p>
            <p className="elapsed-time">
              已等待: {Math.floor(elapsedSeconds / 60)}分{elapsedSeconds % 60}秒
            </p>
          </div>

          {!isSSEDone && (
            <div className="heartbeat-info">
              <span className="heartbeat-icon">❤️</span>
              心跳: {heartbeatElapsed}秒前
            </div>
          )}

          {progressList.length > 0 && (
            <div className="progress-log">
              <h3>生成日志</h3>
              <div className="log-container">
                {progressList.map((info, idx) => (
                  <div key={idx} className="log-entry">{info}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    // 4) 超过30分钟仍未拿到 videoInfo
    if (!videoInfo && elapsedSeconds >= 1800) {
      return (
        <div className="player-page error-view">
          <div className="error-card">
            <h2>生成超时</h2>
            <p>视频生成时间超过30分钟，请联系客服获取帮助</p>
            <div className="contact-info">
              <p>邮箱: litonglinux@qq.com</p>
            </div>
            <button onClick={() => navigate('/')} className="primary-button">
              返回首页
            </button>
          </div>

          {progressList.length > 0 && (
            <div className="progress-log">
              <h3>生成日志</h3>
              <div className="log-container">
                {progressList.map((info, idx) => (
                  <div key={idx} className="log-entry">{info}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    // 5) 成功获取视频信息
    if (videoInfo) {
      return (
        <div className="player-page success-view">
          <div className="header">
            <button onClick={() => navigate(-1)} className="back-button">
              ← 返回
            </button>
            <h1>{videoInfo.title}</h1>
          </div>

          <div className="video-container">
            <div ref={containerRef}></div>
          </div>

          <div className="tabs">
            <button
              className={`tab ${activeTab === 'info' ? 'active' : ''}`}
              onClick={() => setActiveTab('info')}
            >
              <i className="tab-icon">📋</i> 信息
            </button>
            <button
              className={`tab ${activeTab === 'answer' ? 'active' : ''}`}
              onClick={() => setActiveTab('answer')}
            >
              <i className="tab-icon">💬</i> 答案
            </button>
            <button
              className={`tab ${activeTab === 'transcript' ? 'active' : ''}`}
              onClick={() => setActiveTab('transcript')}
            >
              <i className="tab-icon">📝</i> 字幕
            </button>
          </div>

          <div className="tab-content">
            {activeTab === 'info' && (
              <div className="tab-panel info-panel">
                <div className="info-card">
                  <h3>视频信息</h3>
                  <div className="info-grid">
                    <div className="info-item">
                      <label>视频地址</label>
                      <a
                        href={videoInfo.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="info-link"
                      >
                        {videoInfo.videoUrl.substring(0, 40)}...
                      </a>
                    </div>
                    <div className="info-item">
                      <label>封面地址</label>
                      <a
                        href={videoInfo.coverUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="info-link"
                      >
                        {videoInfo.coverUrl === DEFAULT_COVER_URL
                          ? "默认封面"
                          : videoInfo.coverUrl.substring(0, 40) + '...'}
                      </a>
                    </div>
                    {isDev && sseParams && (
                      <div className="info-item">
                        <label>LLM Provider</label>
                        <div className="provider-value">{sseParams.provider}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'answer' && (
              <div className="tab-panel answer-panel">
                <div className="answer-card">
                  <h3>答案文本</h3>
                  <div className="answer-content">
                    {videoInfo.answer}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'transcript' && (
              <div className="tab-panel transcript-panel">
                <div className="transcript-card">
                  <h3>视频字幕</h3>
                  <ul className="transcript-list">
                    {videoInfo.transcript.map((line, idx) => (
                      <li key={idx} className="transcript-item">
                        <span className="line-number">{idx + 1}.</span>
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {!isSSEDone && (
            <div className="footer-info">
              <div className="heartbeat-info">
                <span className="heartbeat-icon">❤️</span>
                心跳: {heartbeatElapsed}秒前
              </div>
              {progressList.length > 0 && (
                <div className="progress-log">
                  <div className="log-container">
                    {progressList.slice(-3).map((info, idx) => (
                      <div key={idx} className="log-entry">{info}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  return <>{renderContent()}</>;
}