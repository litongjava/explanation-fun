// src/components/HlsPlayer.tsx
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useMemo,
} from 'react';
import DPlayer, {type DPlayerOptions} from 'dplayer';
import Hls from 'hls.js';

export interface HlsPlayerHandle {
  /** DPlayer 实例 */
  dp: any | null;
  /** 原生 video 元素 */
  video: HTMLVideoElement | null;
  /** 设置播放速度 */
  setPlaybackRate: (rate: number) => void;
  /** 销毁播放器 */
  destroy: () => void;
}

export interface HlsPlayerProps {
  /** 视频地址，支持 m3u8 与 mp4 */
  url: string;
  /** 封面图，可选 */
  coverUrl?: string;
  /** 可选：字幕 vtt 地址（如有） */
  subtitleUrl?: string;
  /** 自动播放，默认 true */
  autoplay?: boolean;
  /** 发生错误回调 */
  onError?: (e: unknown) => void;
  /** 初始化完毕回调（拿到实例） */
  onReady?: (dp: any) => void;
  /** 是否开启截图按钮，默认 true */
  screenshot?: boolean;
  /** 自定义 DPlayer playbackSpeed 列表 */
  playbackSpeed?: number[];
  /** 是否启用 Hls.js 的 debug，默认 false */
  hlsDebug?: boolean;
}

const DEFAULT_PLAYBACK_SPEED = [0.5, 0.75, 1, 1.25, 1.5, 2];

const HlsPlayer = forwardRef<HlsPlayerHandle, HlsPlayerProps>(
  (
    {
      url,
      coverUrl,
      subtitleUrl,
      autoplay = true,
      onError,
      onReady,
      screenshot = true,
      playbackSpeed = DEFAULT_PLAYBACK_SPEED,
      hlsDebug = false,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const dpRef = useRef<any>(null);

    // 计算视频类型
    const videoType: 'hls' | 'normal' = useMemo(() => {
      return url?.endsWith('.m3u8') ? 'hls' : 'normal';
    }, [url]);

    // 暴露实例给父组件
    useImperativeHandle(
      ref,
      () => ({
        dp: dpRef.current,
        video: dpRef.current?.video ?? null,
        setPlaybackRate: (rate: number) => {
          try {
            dpRef.current?.speed?.(rate);
          } catch {
          }
        },
        destroy: () => {
          safeDestroy();
        },
      }),
      []
    );

    // 安全销毁
    const safeDestroy = () => {
      try {
        if (dpRef.current?.$hls) {
          // DPlayer 在使用 hls 类型时会挂载 $hls
          dpRef.current.$hls.destroy();
        }
      } catch {
      }
      try {
        dpRef.current?.destroy?.();
      } catch {
      }
      dpRef.current = null;
    };

    // 初始化 / 更新
    useEffect(() => {
      if (!containerRef.current || !url) return;

      // 如为 hls，确保把 Hls 挂到 window，供 DPlayer 使用
      if (videoType === 'hls') {
        (window as any).Hls = Hls;
      }

      const options: DPlayerOptions = {
        container: containerRef.current,
        autoplay,
        preload: 'auto',
        screenshot,
        highlight: [{time: 0, text: ''}],
        hotkey: true,
        mutex: true,
        contextmenu: [],
        airplay: false,
        playbackSpeed,
        previewMode: false,
        video: {
          url,
          pic: coverUrl,
          type: videoType === 'hls' ? 'hls' : 'normal',
        },
        pluginOptions: {
          hls: {
            debug: hlsDebug,
            enableWorker: true,
            lowLatencyMode: false,
            maxBufferLength: 60,
            maxMaxBufferLength: 600,
            maxBufferSize: 50 * 1000 * 1000,
            liveDurationInfinity: false,
            startPosition: 0,
          },
        },
      };

      // 重新创建前，先销毁旧实例
      safeDestroy();

      try {
        const dp = new DPlayer(options);
        dpRef.current = dp;

        // loadedmetadata 后优先展示第一条字幕（如有）
        dp.video?.addEventListener('loadedmetadata', () => {
          try {
            const tracks = dp.video?.textTracks;
            if (tracks && tracks.length > 0) {
              tracks[0].mode = 'showing';
            }
          } catch {
          }
        });

        // 设置字幕（如果你需要用 DPlayer 的 subtitle 方案，可切换到内建配置。
        // 这里保留“手动添加 track” 的示例，通常你在 video 标签层面添加 <track> 更合适。
        // if (subtitleUrl) {
        //   // 通过原生 track 添加 (DPlayer 未直接暴露添加 track 的 API，需要原生处理)
        //   const track = document.createElement('track');
        //   track.kind = 'subtitles';
        //   track.label = 'Subtitles';
        //   track.srclang = 'en';
        //   track.src = subtitleUrl;
        //   dp.video?.appendChild(track);
        // }

        onReady?.(dp);
      } catch (e) {
        onError?.(e);
      }

      // url 变化或组件卸载时清理
      return () => {
        safeDestroy();
      };
      // 仅当 url 或类型变化时重建
    }, [url, videoType, autoplay, screenshot, hlsDebug, coverUrl, subtitleUrl, playbackSpeed]);

    return <div ref={containerRef}/>;
  }
);

HlsPlayer.displayName = 'HlsPlayer';

export default HlsPlayer;