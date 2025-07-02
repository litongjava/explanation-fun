import {useEffect, useState, useRef} from 'react';
import {useNavigate} from 'react-router-dom';
import './HomePage.css';
import type {ParsedImageResponse, VideoItem} from '../type/type';
import {UserIdConst} from '../type/UserIdConst.ts';

export default function HomePage() {
  const navigate = useNavigate();

  // 状态管理
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // 分页相关
  const [page, setPage] = useState(1);
  const limit = 12;
  const [total, setTotal] = useState(0);
  const [videos, setVideos] = useState<VideoItem[]>([]);

  // 图片解析相关
  const [conceptText, setConceptText] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('zh-CN');
  const [selectedProvider, setSelectedProvider] = useState<string>('anthropic');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 检查是否为开发环境
  const isDev = localStorage.getItem('app.env') === 'dev';

  // 获取推荐视频
  useEffect(() => {
    const fetchVideos = async () => {
      try {
        const offset = page - 1;
        const response = await fetch(
          `${import.meta.env.VITE_BACKEND_BASE_URL}/api/v1/video/recommends?offset=${offset}&limit=${limit}&sort_by=recent`
        );
        const data = await response.json();

        if (data.code === 1 && data.ok) {
          setVideos(data.data.videos);
          setTotal(data.data.total);
        } else {
          console.error('获取推荐视频返回错误：', data);
        }
      } catch (err) {
        console.error('获取推荐视频失败:', err);
      }
    };

    fetchVideos();
  }, [page]);

  // 清理预览URL
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // 播放视频
  const handlePlayVideo = (video: VideoItem) => {
    navigate(`/player/${video.id}`, {
      state: {
        videoUrl: video.video_url,
        coverUrl: video.cover_url,
        title: video.title,
      },
    });
  };

  // 分页处理
  const totalPages = Math.ceil(total / limit);
  const handlePreviousPage = () => {
    if (page > 1) setPage(page - 1);
  };
  const handleNextPage = () => {
    if (page < totalPages) setPage(page + 1);
  };

  // 文件上传处理
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (file) {
      setSelectedFile(file);
      setError('');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const newPreview = URL.createObjectURL(file);
      setPreviewUrl(newPreview);
      await handleParseImage(file);
    } else {
      setSelectedFile(null);
      setPreviewUrl(null);
      setConceptText('');
    }
  };

  // 图片解析
  const handleParseImage = async (fileToParse: File) => {
    setIsLoading(true);
    setError('');
    setConceptText('');

    const formData = new FormData();
    formData.append('file', fileToParse);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_BACKEND_BASE_URL}/api/v1/file/parse`,
        {
          method: 'POST',
          body: formData,
        }
      );
      const result = await response.json();

      if (response.ok && result.code === 1 && result.ok && result.data) {
        const data = result.data as ParsedImageResponse;
        setConceptText(data.content);
      } else {
        throw new Error(result.msg || result.error || 'Failed to parse image.');
      }
    } catch (err: any) {
      console.error('Error parsing image:', err);
      setError(err.message || 'An unexpected error occurred during parsing.');
      setConceptText('');
    } finally {
      setIsLoading(false);
    }
  };

  // 生成视频
  const handleGenerateVideo = () => {
    if (!conceptText || !conceptText.trim()) {
      setError('请输入主题或上传图片');
      return;
    }

    setError('');
    setLoading(true);

    navigate('/player', {
      state: {
        prompt: conceptText,
        provider: selectedProvider,
        voice_provider: 'openai',
        voice_id: 'shimmer',
        language: selectedLanguage.startsWith('zh') ? 'zh' : 'en',
        user_id: UserIdConst.TONG_LI,
      },
    });

    setLoading(false);
  };

  return (
    <div className="homepage-container">
      <div className="hero-section">
        <h1>🎓 Teach Me Anything</h1>
        <p className="subtitle">通过AI技术，让复杂概念变得简单易懂</p>
      </div>

      <div className="main-content">
        <div className="input-section">
          <div className="concept-input-wrapper">
            <textarea
              placeholder="描述想要讲解的技术概念..."
              value={conceptText}
              onChange={(e) => setConceptText(e.target.value)}
              rows={4}
              className="concept-textarea"
            />

            <div className="upload-section">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                ref={fileInputRef}
                style={{display: 'none'}}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="upload-button secondary"
                disabled={isLoading}
              >
                📷 {selectedFile ? '更换图片' : '上传图片'}
              </button>

              {previewUrl && (
                <div className="image-preview">
                  <img src={previewUrl} alt="Preview"/>
                  <div className="image-overlay">
                    <span>✨ 已自动解析</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="controls-section">
            <div className="select-group">
              <label htmlFor="language-select">🌍 语言</label>
              <select
                id="language-select"
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="modern-select"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
                <option value="es-ES">Español</option>
              </select>
            </div>

            {isDev && (
              <div className="select-group">
                <label htmlFor="provider-select">🤖 LLM Provider</label>
                <select
                  id="provider-select"
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  className="modern-select"
                >
                  <option value="anthropic">Anthropic Claude</option>
                  <option value="openai">OpenAI</option>
                  <option value="openrouter">OpenRouter DeepSeek</option>
                  <option value="google">Google Gemini</option>
                </select>
              </div>
            )}
          </div>

          <button
            onClick={handleGenerateVideo}
            className="generate-button"
            disabled={isLoading || loading || !conceptText.trim()}
          >
            {loading ? (
              <>
                <div className="spinner"></div>
                正在生成...
              </>
            ) : (
              <>
                ✨ 生成视频
              </>
            )}
          </button>
        </div>

        {isLoading && (
          <div className="status-message loading">
            <div className="spinner"></div>
            正在解析图片，请稍候...
          </div>
        )}

        {error && (
          <div className="status-message error">
            ⚠️ {error}
          </div>
        )}

        <div className="videos-section">
          <h2>📚 历史视频</h2>

          {videos.length > 0 ? (
            <>
              <div className="videos-grid">
                {videos.map((video) => (
                  <div
                    key={video.id}
                    className="video-card"
                    onClick={() => handlePlayVideo(video)}
                  >
                    <div className="video-thumbnail">
                      <img
                        src={video.cover_url}
                        alt={video.title}
                        loading="lazy"
                      />
                      <div className="play-overlay">
                        <div className="play-button">▶</div>
                      </div>
                    </div>
                    <div className="video-info">
                      <p className="video-title">{video.title}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pagination">
                <button
                  onClick={handlePreviousPage}
                  disabled={page === 1}
                  className="pagination-button"
                >
                  ← 上一页
                </button>
                <span className="pagination-info">
                  第 {page} 页，共 {totalPages} 页
                </span>
                <button
                  onClick={handleNextPage}
                  disabled={page === totalPages}
                  className="pagination-button"
                >
                  下一页 →
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">📹</div>
              <p>还没有历史视频，快来生成第一个吧！</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}