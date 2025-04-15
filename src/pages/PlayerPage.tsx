import React, {useEffect, useRef, useState} from 'react';
import {useLocation, useNavigate, useParams} from 'react-router-dom';
import Hls from 'hls.js';
import './PlayerPage.css';

interface VideoInfo {
  videoUrl: string;
  coverUrl: string;
  title: string;
}

export default function PlayerPage() {
  // 获取路由参数中的 id
  const {id} = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // videoRef 用于 video 标签引用
  const videoRef = useRef<HTMLVideoElement>(null);

  // 优先使用传递过来的 state，否则为空
  const locationState = location.state as VideoInfo | undefined;
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(locationState || null);
  const [loading, setLoading] = useState(!locationState);

  // 如果 location.state 丢失，则根据路由 id 调用后端接口获取视频详情
  useEffect(() => {
    if (!videoInfo && id) {
      // 请根据实际后端接口地址进行调整，此处假设接口返回的视频信息格式与 VideoInfo 一致
      fetch(`https://manim.fly.dev/api/v1/video/detail?id=${id}`)
        .then(res => res.json())
        .then(data => {
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
        .catch(err => {
          console.error('获取视频信息出错:', err);
          setLoading(false);
        });
    }
  }, [id, videoInfo]);

  // 初始化视频播放，根据视频地址后缀判断使用 hls.js 还是直接赋值
  useEffect(() => {
    if (videoInfo && videoRef.current) {
      // 如果视频地址以 .m3u8 结尾，则使用 hls.js 播放
      if (videoInfo.videoUrl.endsWith('.m3u8')) {
        if (Hls.isSupported()) {
          const hls = new Hls();
          hls.loadSource(videoInfo.videoUrl);
          hls.attachMedia(videoRef.current);
          return () => {
            hls.destroy();
          };
        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          videoRef.current.src = videoInfo.videoUrl;
        }
      } else {
        // 否则直接赋值给 video 标签
        videoRef.current.src = videoInfo.videoUrl;
      }
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
        <video ref={videoRef} controls poster={videoInfo.coverUrl}/>
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
