// src/pages/PlayerPage.tsx
import {useEffect, useRef, useState} from 'react';
import {useLocation, useNavigate, useParams} from 'react-router-dom';
import DPlayer, {type DPlayerOptions} from 'dplayer';
import Hls from 'hls.js';
import './PlayerPage.css';
import {sendVideoSSERequest, type SSEEvent} from '../client/SSEClient.ts';
import ReactMarkdown from 'react-markdown';
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter';
import {materialDark} from 'react-syntax-highlighter/dist/esm/styles/prism';
// Add math formula and table support
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import 'katex/dist/katex.min.css';

// Default cover URL
const DEFAULT_COVER_URL = 'https://i.loli.net/2019/06/06/5cf8c5d9c57b510947.png';

interface VideoInfo {
  videoUrl: string;
  mp4Url?: string;
  coverUrl: string;
  subtitle_url?: string
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

// 过滤文件名中的特殊字符
const sanitizeFilename = (filename: string): string => {
  // 移除或替换不允许的文件名字符
  return filename
    .replace(/[<>:"/\\|?*]/g, '') // 移除 Windows 不允许的字符
    .replace(/[\x00-\x1f\x80-\x9f]/g, '') // 移除控制字符
    .replace(/^\.+/, '') // 移除开头的点
    .replace(/\s+/g, '_') // 空格替换为下划线
    .trim()
    .slice(0, 200); // 限制长度
};

// Add preprocessing function at the top of your PlayerPage.tsx file
const preprocessMathContent = (content: string): string => {
  if (!content) return content;

  let processed = content;

  // Convert \( \) to $ $
  processed = processed.replace(/\\\((.*?)\\\)/g, '$$$1$$');

  // Convert \[ \] to $$ $$
  processed = processed.replace(/\\\[(.*?)\\\]/gs, '$$$$\n$1\n$$$$');

  // Handle common LaTeX math environments
  const mathEnvironments = ['equation', 'align', 'gather', 'multline', 'split', 'cases'];
  mathEnvironments.forEach(env => {
    const regex = new RegExp(`\\\\begin\\{${env}\\}(.*?)\\\\end\\{${env}\\}`, 'gs');
    processed = processed.replace(regex, `$$\n\\\\begin{${env}}$1\\\\end{${env}}\n$$`);
  });

  return processed;
};

export default function PlayerPage() {
  const {id: routeId} = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isDev = localStorage.getItem('app.env') === 'dev';

  const sseParams = (location.state as SSERouteParams) || null;
  const containerRef = useRef<HTMLDivElement>(null);
  const dpRef = useRef<any>(null);

  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [videoId, setVideoId] = useState<string | null>(routeId || null);
  const [countdown, setCountdown] = useState(240); // 4 minutes
  const [pastThreeMinutes, setPastThreeMinutes] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [progressList, setProgressList] = useState<string[]>([]);
  const [isSSEDone, setIsSSEDone] = useState<boolean>(true);
  const [lastHeartbeatTime, setLastHeartbeatTime] = useState<number | null>(null);
  const [heartbeatElapsed, setHeartbeatElapsed] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'info' | 'answer' | 'transcript'>('info');
  const [selectedProvider, setSelectedProvider] = useState(sseParams?.provider || 'openai');
  const [copiedItems, setCopiedItems] = useState<Record<string, boolean>>({});
  const [sseError, setSseError] = useState<string | null>(null);
  const [pendingTitle, setPendingTitle] = useState<string>('');

  const sseReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const hasSubscribed = useRef(false);

  // Ensure cover URL is valid
  const getSafeCoverUrl = (url: string | null | undefined): string => {
    return url && url.trim() !== '' ? url : DEFAULT_COVER_URL;
  };

  // Copy text to clipboard
  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedItems(prev => ({...prev, [key]: true}));
      setTimeout(() => setCopiedItems(prev => ({...prev, [key]: false})), 2000);
    });
  };

  // Countdown and total elapsed time timer
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

  // Heartbeat timer
  useEffect(() => {
    if (lastHeartbeatTime === null) return;

    const hbTimer = window.setInterval(() => {
      setHeartbeatElapsed(Math.floor((Date.now() - lastHeartbeatTime) / 1000));
    }, 1000);

    return () => clearInterval(hbTimer);
  }, [lastHeartbeatTime]);

  // Fetch video details
  useEffect(() => {
    if (videoId && isSSEDone) {
      fetchVideoDetail(videoId);
    }
  }, [videoId]);

  async function fetchVideoDetail(id: string) {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_BACKEND_BASE_URL}/api/v1/video/detail?id=${id}`
      );
      const result = await res.json();

      if (res.ok && result.code === 1 && result.ok && result.data) {
        const data = result.data as any;
        // 优先使用 mp4，如果没有则使用 m3u8
        const playbackUrl = data.mp4_url || data.video_url;

        if (playbackUrl) {
          setVideoInfo({
            videoUrl: playbackUrl,
            mp4Url: data.mp4_url || undefined,
            coverUrl: getSafeCoverUrl(data.cover_url),
            subtitle_url: data.subtitle_url,
            title: data.title || 'Video',
            answer: data.answer || '',
            transcript: Array.isArray(data.transcript) ? data.transcript : [],
          });
        }
      }
    } catch (err) {
      console.error('Error fetching video details:', err);
    }
  }

  // Initiate SSE request
  useEffect(() => {
    if (!videoId && sseParams && !hasSubscribed.current) {
      hasSubscribed.current = true;
      setIsSSEDone(false);

      const params = {...sseParams};
      if (isDev) params.provider = selectedProvider;

      sendVideoSSERequest({
        ...params,
        onEvent: (event: SSEEvent) => {
          // Heartbeat event
          if (event.type === 'error') {
            try {
              const errorData = JSON.parse(event.data);
              setSseError(errorData.error || "Video generation failed");

            } catch (e) {
              setSseError("An error occurred during video generation");
            }
            setIsSSEDone(true);
            return;
          } else if (event.type === '401') {
            const errorData = JSON.parse(event.data);
            setSseError(errorData.msg || "Insufficient credits, please recharge and try again");
          } else if (event.type === 'heartbeat') {
            setLastHeartbeatTime(Date.now());
            setHeartbeatElapsed(0);
            return;
          }
          // Progress update
          else if (event.type === 'progress') {
            try {
              const payload = JSON.parse(event.data) as { info: string };
              setProgressList(prev => [...prev, payload.info]);
            } catch {
              setProgressList(prev => [...prev, event.data]);
            }
            return;
          }

          // Received ID
          else if (event.type === 'task' || event.type === 'metadata') {
            try {
              const payload = JSON.parse(event.data) as { id: string };
              setVideoId(payload.id);
              window.history.replaceState({}, '', `#/player/${payload.id}`);
            } catch (e) {
              console.error('Failed to parse ID:', e);
            }
            return;
          }

          // Received title
          else if (event.type === 'title') {
            try {
              const payload = JSON.parse(event.data) as { title: string };
              setPendingTitle(payload.title);  // 只暂存 title，不创建 videoInfo
            } catch (e) {
              console.error('Failed to parse title:', e);
            }
            return;
          }
          // Received playback URL (main.m3u8)
          else if (event.type === 'main') {
            try {
              const payload = JSON.parse(event.data) as { url: string };
              setVideoInfo(prev => ({
                videoUrl: payload.url,
                mp4Url: prev?.mp4Url,  // 保持现有的 mp4Url
                coverUrl: getSafeCoverUrl(prev?.coverUrl),
                title: prev?.title || pendingTitle || sseParams.question,
                answer: prev?.answer || '',
                transcript: prev?.transcript || [],
              }));
            } catch (e) {
              console.error('Failed to parse playback URL:', e);
            }
            return;
          }
            // Received video URL (mp4)
          // Received video URL (mp4)
          else if (event.type === 'video') {
            try {
              const payload = JSON.parse(event.data) as { url: string };

              setVideoInfo(prev => {
                // 如果已经有 videoInfo（已经在播放），只更新 mp4Url，不触发重新渲染播放器
                if (prev && prev.videoUrl) {
                  return {
                    ...prev,
                    mp4Url: payload.url,
                  };
                }

                // 如果还没有 videoInfo，创建新的（使用 mp4 作为播放源）
                return {
                  videoUrl: payload.url,  // 如果 main 还没到，用 mp4 作为播放源
                  mp4Url: payload.url,
                  coverUrl: getSafeCoverUrl(prev?.coverUrl),
                  title: prev?.title || pendingTitle || sseParams.question,
                  answer: prev?.answer || '',
                  transcript: prev?.transcript || [],
                };
              });
            } catch (e) {
              console.error('Failed to parse video URL:', e);
            }
            return;
          }
          // SSE complete
          else if (event.type === 'done') {
            sseReaderRef.current = null;
            setIsSSEDone(true);
          }
        },
      }).catch(e => {
        console.error('SSE request error:', e);
        setIsSSEDone(true);
      });
    }
  }, [videoId, sseParams, selectedProvider]);

  // Poll for video information
  useEffect(() => {
    const shouldPoll = Boolean(videoId && !videoInfo?.videoUrl && (isSSEDone || !sseParams));
    if (!shouldPoll) return;

    const pollInterval = 5000;
    const timerRef = {current: 0 as number};

    async function tryFetch() {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_BASE_URL}/api/v1/video/detail?id=${videoId}`
        );
        const result = await res.json();

        if (res.ok && result.code === 1 && result.ok && result.data) {
          const data = result.data as any;
          const playbackUrl = data.mp4_url || data.video_url;

          if (playbackUrl) {
            clearInterval(timerRef.current);
            setVideoInfo({
              videoUrl: playbackUrl,
              mp4Url: data.mp4_url || undefined,
              coverUrl: getSafeCoverUrl(data.cover_url),
              subtitle_url: data.subtitle_url,
              title: data.title || 'Video',
              answer: data.answer || '',
              transcript: Array.isArray(data.transcript) ? data.transcript : [],
            });
          }
        }
      } catch (err) {
        console.error('Failed to poll video:', err);
      }
    }

    timerRef.current = window.setInterval(() => {
      if (elapsedSeconds >= 1800) {
        clearInterval(timerRef.current);
        window.alert('Video generation timeout. Please contact litonglinux@qq.com for assistance.');
        return;
      }
      if (videoInfo?.videoUrl) {
        clearInterval(timerRef.current);
        return;
      }
      tryFetch();
    }, pollInterval);

    return () => clearInterval(timerRef.current);
  }, [videoId, videoInfo, elapsedSeconds, isSSEDone, sseParams]);

  // Initialize player
  useEffect(() => {
    if (!videoInfo || !containerRef.current) return;

    let videoType: string = 'normal';
    if (videoInfo.videoUrl.endsWith('.m3u8')) {
      videoType = 'hls';
      // @ts-ignore
      window.Hls = Hls;
    }

    let options: DPlayerOptions = {
      container: containerRef.current!,
      autoplay: false,
      preload: 'auto',
      screenshot: true,
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
      }

    };
    // if (videoInfo.subtitle_url) {
    //   options.subtitle = {
    //     url: videoInfo.subtitle_url,
    //     type: 'webvtt',
    //     fontSize: '25px',
    //     bottom: '2%',
    //     color: '#000'
    //   }
    // }


    dpRef.current = new DPlayer(options);

    if (dpRef.current.video) {
      dpRef.current.video.addEventListener('loadedmetadata', () => {
        if (dpRef.current.video.textTracks.length > 0) {
          const track = dpRef.current.video.textTracks[0];
          track.mode = 'showing';
        }
        dpRef.current.video.currentTime = 0.1;

        dpRef.current.play().catch((err: any) => {
          console.warn('自动播放被阻止:', err);
          // ✅ 显示播放按钮提示
          if (dpRef.current && dpRef.current.container) {
            const notice = dpRef.current.container.querySelector('.dplayer-notice');
            if (notice) {
              notice.innerHTML = 'Click the play button to start watching';
              notice.style.opacity = '1';
              setTimeout(() => {
                notice.style.opacity = '0';
              }, 3000);
            }
          }
        });
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

  // 下载视频（带水印）
  const handleDownload = () => {
    if (!videoInfo?.mp4Url) {
      alert('MP4 文件尚未生成，无法下载');
      return;
    }

    const filename = sanitizeFilename(videoInfo.title || 'video');
    const downloadUrl = `${import.meta.env.VITE_BACKEND_BASE_URL}/video/download/water?path=${encodeURIComponent(videoInfo.mp4Url)}&text=jieti.cc&filename=${encodeURIComponent(filename)}`;
    window.open(downloadUrl, '_blank');
  };

  // Render UI for different states
  const renderContent = () => {
    if (sseError) {
      return (
        <div className="player-page error-view">
          <div className="error-card">
            <h2>Error Occurred</h2>
            <p>{sseError}</p>
            {sseError.includes("Insufficient credits") && (
              <button
                onClick={() => navigate('/recharge')}
                className="primary-button"
                style={{marginTop: '15px'}}
              >
                Recharge Now
              </button>
            )}
            <button
              onClick={() => navigate('/')}
              className="primary-button"
              style={{marginTop: '10px'}}
            >
              Back to Home
            </button>
          </div>
        </div>
      );
    }
    // 1) Missing required parameters
    if (!videoId && !sseParams) {
      return (
        <div className="player-page error-view">
          <div className="error-card">
            <h2>Video Not Found</h2>
            <p>Please check the URL or return to the homepage to start over</p>
            <button onClick={() => navigate('/')} className="primary-button">
              Back to Home
            </button>
          </div>
        </div>
      );
    }

    // 2) Video generating (first three minutes)
    if ((!videoInfo?.videoUrl && !routeId && sseParams) || (!videoInfo?.videoUrl && countdown > 0 && videoId)) {
      return (
        <div className="player-page generating-view">
          <div className="header">
            <button onClick={() => navigate(-1)} className="back-button">
              ← Back
            </button>
            <h1>Generating Video</h1>
          </div>

          <div className="progress-container">
            <div className="countdown-badge">
              {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
            </div>

            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{width: `${((180 - countdown) / 180) * 100}%`}}
              ></div>
            </div>

            <div className="status-message">
              {countdown > 120 ? 'Preparing resources...' :
                countdown > 60 ? 'Processing video content...' :
                  'Composing final video...'}
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
              Heartbeat: {heartbeatElapsed}s ago
            </div>
          )}

          {progressList.length > 0 && (
            <div className="progress-log">
              <h3>Generation Log</h3>
              <div className="log-container">
                {progressList.map((info, idx) => (
                  <div key={idx} className="log-entry">
                    <span className="log-time">
                      {new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
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

    // 3) After three minutes, continue background polling
    if (!videoInfo?.videoUrl && pastThreeMinutes && elapsedSeconds < 1800) {
      return (
        <div className="player-page generating-view">
          <div className="header">
            <button onClick={() => navigate(-1)} className="back-button">
              ← Back
            </button>
            <h1>Processing in Background</h1>
          </div>

          <div className="waiting-message">
            <div className="spinner"></div>
            <p>Video is still being generated, please be patient...</p>
            <p className="elapsed-time">
              Waiting time: {Math.floor(elapsedSeconds / 60)}m {elapsedSeconds % 60}s
            </p>
          </div>

          {!isSSEDone && (
            <div className="heartbeat-info">
              <span className="heartbeat-icon">❤️</span>
              Heartbeat: {heartbeatElapsed}s ago
            </div>
          )}

          {progressList.length > 0 && (
            <div className="progress-log">
              <h3>Generation Log</h3>
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

    // 4) After 30 minutes still no videoInfo
    if (!videoInfo?.videoUrl && elapsedSeconds >= 1800) {
      return (
        <div className="player-page error-view">
          <div className="error-card">
            <h2>Generation Timeout</h2>
            <p>Video generation exceeded 30 minutes. Please contact customer service for assistance</p>
            <div className="contact-info">
              <p>Email: litonglinux@qq.com</p>
            </div>
            <button onClick={() => navigate('/')} className="primary-button">
              Back to Home
            </button>
          </div>

          {progressList.length > 0 && (
            <div className="progress-log">
              <h3>Generation Log</h3>
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

    // 5) Successfully retrieved video information
    if (videoInfo?.videoUrl) {
      return (
        <div className="player-page success-view">
          <div className="header">
            <button onClick={() => navigate(-1)} className="back-button">
              ← Back
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
              <i className="tab-icon">📋</i> Info
            </button>
            <button
              className={`tab ${activeTab === 'answer' ? 'active' : ''}`}
              onClick={() => setActiveTab('answer')}
            >
              <i className="tab-icon">💬</i> Answer
            </button>
            <button
              className={`tab ${activeTab === 'transcript' ? 'active' : ''}`}
              onClick={() => setActiveTab('transcript')}
            >
              <i className="tab-icon">📝</i> Subtitles
            </button>
          </div>

          <div className="tab-content">
            {activeTab === 'info' && (
              <div className="tab-panel info-panel">
                <div className="info-card">
                  <h3>Video Information</h3>
                  <div className="info-grid">
                    <div className="info-item">
                      <label>Download Video</label>
                      <button
                        className={`download-button ${!videoInfo.mp4Url ? 'disabled' : ''}`}
                        onClick={handleDownload}
                        disabled={!videoInfo.mp4Url}
                      >
                        {videoInfo.mp4Url ? '⬇️ Download' : '⏳ MP4 Generating...'}
                      </button>
                      {!videoInfo.mp4Url && (
                        <p className="download-tip">MP4 file is being generated, please wait...</p>
                      )}
                    </div>
                    <div className="info-item">
                      <div className="info-header">
                        <label>Cover URL</label>
                        <button
                          className="copy-button"
                          onClick={() => copyToClipboard(videoInfo.coverUrl, 'coverUrl')}
                        >
                          {copiedItems['coverUrl'] ? '✓ Copied' : 'Copy'}
                        </button>
                      </div>
                      <a
                        href={videoInfo.coverUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="info-link"
                        style={{wordBreak: 'break-all'}}
                      >
                        {videoInfo.coverUrl === DEFAULT_COVER_URL
                          ? "Default Cover"
                          : videoInfo.coverUrl}
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
                  <div className="answer-header">
                    <h3>Answer Text</h3>
                    <button
                      className="copy-button"
                      onClick={() => copyToClipboard(videoInfo.answer, 'answer')}
                    >
                      {copiedItems['answer'] ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="answer-content">
                    <ReactMarkdown
                      remarkPlugins={[remarkMath, remarkGfm]}
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        code({node, className, children, ...props}) {
                          const match = /language-(\w+)/.exec(className || '');
                          const isInline = !match;
                          if (isInline) {
                            return (
                              <code className={className} {...props}>
                                {children}
                              </code>
                            );
                          }

                          const {ref: _rmRef, ...sanitizedProps} = props as any;

                          return (
                            <SyntaxHighlighter
                              style={materialDark}
                              language={match ? match : [1]}
                              PreTag="div"
                              {...sanitizedProps}
                            >
                              {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          );
                        },
                        table({children}) {
                          return (
                            <div className="table-container">
                              <table className="markdown-table">{children}</table>
                            </div>
                          );
                        },
                        th({children}) {
                          return <th className="table-header">{children}</th>;
                        },
                        td({children}) {
                          return <td className="table-cell">{children}</td>;
                        }
                      }}
                    >
                      {preprocessMathContent(videoInfo.answer)}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'transcript' && (
              <div className="tab-panel transcript-panel">
                <div className="transcript-card">
                  <div className="transcript-header">
                    <h3>Video Subtitles</h3>
                    <button
                      className="copy-button"
                      onClick={() => copyToClipboard(videoInfo.transcript.join('\n'), 'transcript')}
                    >
                      {copiedItems['transcript'] ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
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
                Heartbeat: {heartbeatElapsed}s ago
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