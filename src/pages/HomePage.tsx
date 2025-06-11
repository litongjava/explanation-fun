// src/pages/HomePage.tsx

import {useEffect, useState, useRef} from 'react';
import {useNavigate} from 'react-router-dom';
import './HomePage.css';
import type {ParsedImageResponse, VideoItem} from '../type/type';
import {UserIdConst} from '../type/UserIdConst.ts'; // 确保这里导出了 TONG_LI

export default function HomePage() {
  const navigate = useNavigate();

  // 生成后的视频记录（现在不再直接用）
  const [generatedVideo] = useState<VideoItem | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // 分页相关（不变）
  const [page, setPage] = useState(1);
  const limit = 12;
  const [total, setTotal] = useState(0);
  const [videos, setVideos] = useState<VideoItem[]>([]);

  // 图片解析相关
  const [conceptText, setConceptText] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [, setParsedImageId] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('zh-CN');
  const [selectedProvider, setSelectedProvider] = useState<string>('openrouter');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 每次 page 改变就去拉推荐视频
  useEffect(() => {
    const offset = page - 1;
    fetch(
      import.meta.env.VITE_BACKEND_BASE_URL +
      `/api/v1/video/recommends?offset=${offset}&limit=${limit}&sort_by=recent`
    )
      .then((response) => response.json())
      .then((data) => {
        if (data.code === 1 && data.ok) {
          setVideos(data.data.videos);
          setTotal(data.data.total);
        } else {
          console.error('获取推荐视频返回错误：', data);
        }
      })
      .catch((err) => {
        console.error('获取推荐视频失败:', err);
      });
  }, [page]);

  // 清理旧的 previewUrl
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handlePlayVideo = (video: VideoItem) => {
    navigate(`/player/${video.id}`, {
      state: {
        videoUrl: video.video_url,
        coverUrl: video.cover_url,
        title: video.title,
      },
    });
  };

  const totalPages = Math.ceil(total / limit);
  const handlePreviousPage = () => {
    if (page > 1) setPage(page - 1);
  };
  const handleNextPage = () => {
    if (page < totalPages) setPage(page + 1);
  };

  // 图片上传 & 预览 & 自动解析（和之前一模一样）
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (file) {
      setSelectedFile(file);
      setError('');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const newPreview = URL.createObjectURL(file);
      setPreviewUrl(newPreview);

      // 自动调用解析接口
      await handleParseImage(file);
    } else {
      setSelectedFile(null);
      setPreviewUrl(null);
      setConceptText('');
      setParsedImageId(null);
    }
  };

  const handleParseImage = async (fileToParse: File) => {
    setIsLoading(true);
    setError('');
    setConceptText('');
    setParsedImageId(null);

    const formData = new FormData();
    formData.append('file', fileToParse);

    try {
      const response = await fetch(
        import.meta.env.VITE_BACKEND_BASE_URL + '/api/v1/file/parse',
        {
          method: 'POST',
          body: formData,
        }
      );
      const result = await response.json();
      if (response.ok && result.code === 1 && result.ok && result.data) {
        const data = result.data as ParsedImageResponse;
        setConceptText(data.content);
        setParsedImageId(data.id);
      } else {
        throw new Error(result.msg || result.error || 'Failed to parse image.');
      }
    } catch (err: any) {
      console.error('Error parsing image:', err);
      setError(err.message || 'An unexpected error occurred during parsing.');
      setConceptText('');
      setParsedImageId(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedLanguage(e.target.value);
  };
  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedProvider(e.target.value);
  };

  /**
   * 点击“Generate Video”：
   * 1) 校验 conceptText
   * 2) 直接 navigate('/player')，并把 SSE 所需的参数都传给 PlayerPage
   */
  const handleGenerateVideo = () => {
    if (!conceptText || !conceptText.trim()) {
      setError('请输入主题');
      return;
    }
    setError('');
    setLoading(true);

    // 把参数放到 location.state 里，交给 PlayerPage 处理 SSE
    navigate('/player', {
      state: {
        prompt: conceptText,
        provider: selectedProvider,    // "openrouter"
        voice_provider: 'openai',      // 固定为 openai
        voice_id: 'shimmer',           // 固定为 shimmer
        language: selectedLanguage.startsWith('zh') ? 'zh' : 'en',
        user_id: UserIdConst.TONG_LI,
      },
    });

    // 立即把 loading 关掉即可，PlayerPage 会做后续展示
    setLoading(false);
  };

  return (
    <div className="homepage-container">
      <h1>Teach Me Anything</h1>

      <div className="controls-section">
        <div className="select-group">
          <label htmlFor="language-select">Language:</label>
          <select
            id="language-select"
            value={selectedLanguage}
            onChange={handleLanguageChange}
          >
            <option value="zh-CN">简体中文 (Chinese)</option>
            <option value="en-US">English (US)</option>
            <option value="es-ES">Español (Spanish)</option>
          </select>
        </div>

        <div className="select-group">
          <label htmlFor="provider-select">LLM Provider:</label>
          <select
            id="provider-select"
            value={selectedProvider}
            onChange={handleProviderChange}
          >
            <option value="openrouter">OpenRouter DeepSeek</option>
            <option value="openai">OpenAI</option>
            <option value="google">Google Gemini</option>
            <option value="anthropic">Anthropic Claude</option>
          </select>
        </div>

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
            className="upload-button"
          >
            {selectedFile ? 'Change Image' : 'Upload Image'}
          </button>
          {previewUrl && (
            <div className="image-preview">
              <img src={previewUrl} alt="Preview"/>
            </div>
          )}
        </div>

        <button
          onClick={handleGenerateVideo}
          className="upload-button"
          disabled={isLoading || loading}
        >
          {loading ? '正在生成…' : 'Generate Video'}
        </button>
      </div>

      <div className="concept-input-section">
        <textarea
          placeholder="描述想要讲解的技术概念 (或上传图片自动填充)"
          value={conceptText}
          onChange={(e) => setConceptText(e.target.value)}
          rows={5}
        />
      </div>

      {isLoading && (
        <p className="loading-message">Parsing image, please wait...</p>
      )}
      {error && <p className="error-message">{error}</p>}

      {generatedVideo && (
        <div className="generated-card">
          <h3>{generatedVideo.title}</h3>
          <img
            src={generatedVideo.cover_url}
            alt={generatedVideo.title}
            width="160"
          />
          <button onClick={() => handlePlayVideo(generatedVideo)}>
            去播放
          </button>
        </div>
      )}

      <h2>历史视频</h2>
      <div className="videos-grid">
        {videos.map((video) => (
          <div
            key={video.id}
            className="video-item"
            onClick={() => handlePlayVideo(video)}
          >
            <img
              src={video.cover_url}
              alt={video.title}
              width="160"
              height="90"
            />
            <p className="multiline-ellipsis">{video.title}</p>
          </div>
        ))}
      </div>

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
