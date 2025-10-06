import {useEffect, useState, useRef} from 'react';
import {useNavigate} from 'react-router-dom';
import './HomePage.css';
import type {ParsedImageResponse, VideoItem} from '../type/type';
import {UserIdConst} from '../type/UserIdConst.ts';

const VideoSkeleton = () => (
  <div className="video-item skeleton">
    <div className="video-thumbnail skeleton-thumbnail">
      <div className="skeleton-shimmer"></div>
    </div>
    <div className="video-title skeleton-title">
      <div className="skeleton-shimmer"></div>
    </div>
  </div>
);

export default function HomePage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 12;
  const [total, setTotal] = useState(0);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [conceptText, setConceptText] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('zh-CN');
  const [selectedProvider, setSelectedProvider] = useState<string>('anthropic');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDevEnv, setIsDevEnv] = useState(false);

  const [navData, setNavData] = useState<{ [key: string]: string }>({});
  const [videosLoading, setVideosLoading] = useState<boolean>(true);
  const [navLoading, setNavLoading] = useState<boolean>(true);

  useEffect(() => {
    setIsDevEnv(localStorage.getItem('app.env') === 'dev');

    const offset = page - 1;
    setVideosLoading(true);
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
          console.error('Error retrieving recommended videos:', data);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch recommended videos:', err);
      })
      .finally(() => {
        setVideosLoading(false);
      });
  }, [page]);

  useEffect(() => {
    setNavLoading(true);
    fetch(import.meta.env.VITE_BACKEND_BASE_URL + '/api/v1/nav')
      .then((res) => res.json())
      .then((data) => {
        if (data.code === 1 && data.ok && data.data) {
          setNavData(data.data);
        }
      })
      .catch((err) => console.error('Failed to fetch navigation:', err))
      .finally(() => {
        setNavLoading(false);
      });
  }, []);

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
  const handlePreviousPage = () => page > 1 && setPage(page - 1);
  const handleNextPage = () => page < totalPages && setPage(page + 1);

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

  const handleParseImage = async (fileToParse: File) => {
    setIsLoading(true);
    setError('');
    setConceptText('');

    const formData = new FormData();
    formData.append('file', fileToParse);

    try {
      const response = await fetch(
        import.meta.env.VITE_BACKEND_BASE_URL + '/api/v1/file/parse',
        {method: 'POST', body: formData}
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

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedLanguage(e.target.value);
  };

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedProvider(e.target.value);
  };

  const handleGenerateVideo = () => {
    if (!conceptText.trim()) {
      setError('Please enter a topic');
      return;
    }
    setError('');
    setLoading(true);

    navigate('/player', {
      state: {
        question: conceptText,
        provider: selectedProvider,
        voice_provider: 'openai',
        voice_id: 'shimmer',
        language: selectedLanguage.startsWith('zh') ? 'zh' : 'en',
        user_id: UserIdConst.TONG_LI,
      },
    });
  };

  return (
    <div className="homepage-container">
      {/* Navigation bar */}
      <header className="site-header">
        <div className="site-bar">
          {/* Dynamic navigation from /api/v1/nav */}
          <ul className="site-nav">
            {navLoading ? (
              <>
                {[1, 2, 3, 4].map((i) => (
                  <li key={i}>
                    <div className="nav-item skeleton-nav">
                      <div className="skeleton-shimmer"></div>
                    </div>
                  </li>
                ))}
              </>
            ) : (
              Object.entries(navData).map(([text, link]) => (
                <li key={text}>
                  <a className="nav-item" href={`https://${link}`} target="_blank" rel="noopener noreferrer">
                    {text}
                  </a>
                </li>
              ))
            )}
          </ul>
        </div>
      </header>
      <h1 className="app-title">Teach Me Anything</h1>

      <div className="controls-section">
        <div className="select-group">
          <label htmlFor="language-select">Language:</label>
          <select
            id="language-select"
            value={selectedLanguage}
            onChange={handleLanguageChange}
          >
            <option value="zh-CN">Simplified Chinese</option>
            <option value="en-US">English</option>
            <option value="es-ES">Español</option>
          </select>
        </div>

        {isDevEnv && (
          <div className="select-group">
            <label htmlFor="provider-select">LLM Provider:</label>
            <select
              id="provider-select"
              value={selectedProvider}
              onChange={handleProviderChange}
            >
              <option value="anthropic">Anthropic Claude</option>
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter DeepSeek</option>
              <option value="google">Google Gemini</option>
            </select>
          </div>
        )}

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
          className="generate-button"
          disabled={isLoading || loading}
        >
          {loading ? 'Generating...' : 'Generate Video'}
        </button>
      </div>

      <div className="concept-input-section">
        <textarea
          placeholder="Describe the technical concept you want explained (or upload an image to auto-fill)"
          value={conceptText}
          onChange={(e) => setConceptText(e.target.value)}
          rows={4}
        />
      </div>

      {isLoading && <p className="loading-message">Parsing image, please wait...</p>}
      {error && <p className="error-message">{error}</p>}

      <div className="section-header">
        <h2>Video History</h2>
        <div className="pagination-info">
          Page {page} of {totalPages}
        </div>
      </div>

      <div className="videos-grid">
        {videosLoading ? (
          Array.from({length: limit}).map((_, i) => <VideoSkeleton key={i}/>)
        ) : (
          videos.map((video) => (
            <div
              key={video.id}
              className="video-item"
              onClick={() => handlePlayVideo(video)}
            >
              <div className="video-thumbnail">
                <img
                  src={video.cover_url}
                  alt={video.title}
                />
                <div className="play-icon">▶</div>
              </div>
              <p className="video-title">{video.title}</p>
            </div>
          ))
        )}
      </div>

      <div className="pagination">
        <button onClick={handlePreviousPage} disabled={page === 1}>
          Previous
        </button>
        <button onClick={handleNextPage} disabled={page === totalPages}>
          Next
        </button>
      </div>
    </div>
  );
}