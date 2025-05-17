import {useEffect, useState, useRef} from 'react';
import {useNavigate} from 'react-router-dom';
import './HomePage.css';
import type {ParsedImageResponse} from "../type/type.ts"; // 根据需要编写样式

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

  const [conceptText, setConceptText] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [parsedImageId, setParsedImageId] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('zh-CN');
  const [selectedProvider, setSelectedProvider] = useState<string>('openai');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 根据页码加载推荐视频列表，计算 offset 为 (page - 1)
  useEffect(() => {
    const offset = page - 1;
    fetch(import.meta.env.VITE_BACKEND_BASE_URL + `/api/v1/video/recommends?offset=${offset}&limit=${limit}&sort_by=recent`)
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

  // Cleanup for preview URL
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);


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

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null); // Clear previous errors

      // Create a preview
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl); // Revoke old object URL
      }
      const newPreviewUrl = URL.createObjectURL(file);
      setPreviewUrl(newPreviewUrl);

      // Automatically parse the image upon selection
      await handleParseImage(file);
    } else {
      setSelectedFile(null);
      setPreviewUrl(null);
      setConceptText(''); // Clear text if file is removed
      setParsedImageId(null);
    }
  };

  const handleParseImage = async (fileToParse: File) => {
    if (!fileToParse) {
      setError('Please select an image file first.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setConceptText(''); // Clear previous parsed text
    setParsedImageId(null);

    const formData = new FormData();
    formData.append('file', fileToParse);

    try {
      const response = await fetch(import.meta.env.VITE_BACKEND_BASE_URL + '/api/v1/file/parse', {
        method: 'POST',
        body: formData,
        // Note: Don't set 'Content-Type' header manually for FormData,
        // the browser will set it correctly with the boundary.
      });

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
      setConceptText(''); // Clear text on error
      setParsedImageId(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedLanguage(event.target.value);
  };

  const handleProviderChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedProvider(event.target.value);
  };

  const handleGenerateVideo = () => {
    if (!conceptText) {
      setError('Please provide a concept, either by typing or uploading an image.');
      return;
    }
    if (!conceptText.trim()) {
      setError('请输入主题');
      return;
    }
    setError('');
    setLoading(true);
    const url = import.meta.env.VITE_BACKEND_BASE_URL + `/manim/video?topic=${encodeURIComponent(conceptText)}`;
    fetch(url)
      .then(res => res.json())
      .then((data: GenerationResponse) => {
        setLoading(false);
        if (data.code === 1 && data.ok && data.data) {
          const newVideo: VideoItem = {
            id: new Date().getTime().toString(), // 生成一个简单的唯一 ID
            cover_url: data.data.cover_url,
            title: conceptText,
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


  return (

    <div className="homepage-container">
      <h1>Teach Me Anything</h1>
      <div className="controls-section">
        <div className="select-group">
          <label htmlFor="language-select">Language:</label>
          <select id="language-select" value={selectedLanguage} onChange={handleLanguageChange}>
            <option value="zh-CN">简体中文 (Chinese)</option>
            <option value="en-US">English (US)</option>
            <option value="es-ES">Español (Spanish)</option>
            {/* Add more languages as needed */}
          </select>
        </div>

        <div className="select-group">
          <label htmlFor="provider-select">LLM Provider:</label>
          <select id="provider-select" value={selectedProvider} onChange={handleProviderChange}>
            <option value="openai">OpenAI</option>
            <option value="google">Google Gemini</option>
            <option value="anthropic">Anthropic Claude</option>
            {/* Add more providers as needed */}
          </select>
        </div>
      </div>
      <div className="concept-input-section">
        <textarea
          placeholder="描述想要讲解的技术概念 (或上传图片自动填充)"
          value={conceptText}
          onChange={(e) => setConceptText(e.target.value)}
          rows={5}
        />
      </div>
      <div className="upload-section">
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          ref={fileInputRef}
          style={{display: 'none'}} // Hide default input
        />
        <button onClick={() => fileInputRef.current?.click()} className="upload-button">
          {selectedFile ? 'Change Image' : 'Upload Image'}
        </button>
        {previewUrl && (
          <div className="image-preview">
            <img src={previewUrl} alt="Preview"/>
          </div>
        )}
      </div>
      {isLoading && <p className="loading-message">Parsing image, please wait...</p>}
      {error && <p className="error-message">{error}</p>}

      <button onClick={handleGenerateVideo} className="generate-button" disabled={isLoading}>
        Generate Video
      </button>

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
