// src/components/HlsPlayer.tsx
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import DPlayer, {DPlayerEvents, type DPlayerOptions} from 'dplayer';
import Hls from 'hls.js';

export interface HlsPlayerHandle {
  dp: any | null;
  video: HTMLVideoElement | null;
  setPlaybackRate: (rate: number) => void;
  destroy: () => void;
}

export interface HlsPlayerProps {
  url: string;                 // .m3u8 或 .mp4
  coverUrl?: string;
  subtitleUrl?: string;
  autoplay?: boolean;          // 默认 true（失败则等待用户点击）
  onReady?: (dp: any) => void;
  onError?: (e: unknown) => void;
  screenshot?: boolean;        // 默认 true
  playbackSpeed?: number[];    // 倍速列表
  hlsDebug?: boolean;          // 默认 false
}

const DEFAULT_PLAYBACK_SPEED = [0.5, 0.75, 1, 1.25, 1.5, 2];

const MAX_RETRY = 4;
const BASE_DELAY_MS = 1000;

const HlsPlayer = forwardRef<HlsPlayerHandle, HlsPlayerProps>(
  (
    {
      url,
      coverUrl,
      autoplay = true,
      onReady,
      onError,
      screenshot = true,
      playbackSpeed = DEFAULT_PLAYBACK_SPEED,
      hlsDebug = false,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const dpRef = useRef<any>(null);

    const hlsRef = useRef<Hls | null>(null);
    const destroyedRef = useRef(false);

    const retryCountRef = useRef(0);
    const retryTimerRef = useRef<number | null>(null);
    const retryLockRef = useRef(false);

    const userPausedRef = useRef(false);

    const videoType: 'hls' | 'normal' = useMemo(() => {
      return url?.toLowerCase().endsWith('.m3u8') ? 'hls' : 'normal';
    }, [url]);

    useImperativeHandle(
      ref,
      () => ({
        dp: dpRef.current,
        video: dpRef.current?.video ?? null,
        setPlaybackRate: (rate: number) => {
          try { dpRef.current?.speed?.(rate); } catch {}
        },
        destroy: () => safeDestroy(),
      }),
      []
    );

    const clearRetryTimer = () => {
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const destroyHls = () => {
      const h = hlsRef.current;
      if (!h) return;
      try { h.stopLoad?.(); } catch {}
      try { h.off(Hls.Events.ERROR, onHlsError as any); } catch {}
      try { h.off(Hls.Events.MANIFEST_PARSED, onManifestParsed as any); } catch {}
      try { h.detachMedia?.(); } catch {}
      try { h.destroy?.(); } catch {}
      hlsRef.current = null;
    };

    const safeDestroy = () => {
      destroyedRef.current = true;
      clearRetryTimer();
      destroyHls();
      try { dpRef.current?.destroy?.(); } catch {}
      dpRef.current = null;
    };

    // 修正点 A：不静音，仅尝试一次；若被策略拦截，只在“仍然处于暂停状态”时提示
    const tryAutoPlayOnce = () => {
      if (!autoplay) return;
      const v: HTMLVideoElement | undefined = dpRef.current?.video;
      if (!v || !v.paused) return; // 已经在播则不再尝试
      try {
        v.autoplay = true;
        v.setAttribute('playsinline', 'true');
        (v as any).webkitPlaysInline = true;
        v.playsInline = true;
      } catch {}
      const p = v.play?.();
      if (p && typeof (p as Promise<void>).catch === 'function') {
        p.catch((err: any) => {
          const name = err?.name || '';
          const msg = String(err?.message || '');
          const isPolicyBlocked = name === 'NotAllowedError';
          const isBenignInterruption =
            name === 'AbortError' ||
            msg.includes('interrupted') ||
            msg.includes('pause');

          // 仅在“策略拦截且仍未播放”时，延迟检查后提示
          if (isPolicyBlocked) {
            setTimeout(() => {
              const vv: HTMLVideoElement | undefined = dpRef.current?.video;
              if (!vv) return;
              if (!vv.paused) return; // 已经开始播放，不提示
              try { dpRef.current?.notice?.('自动播放被浏览器拦截，请点击播放', 3000); } catch {}
            }, 120);
          } else if (!isBenignInterruption) {
            // 其他真正的异常，交给上层
            onError?.(err);
          }
        });
      }
    };

    const onManifestParsed = () => {
      retryCountRef.current = 0;
      retryLockRef.current = false;
      tryAutoPlayOnce();
    };

    const onHlsError = (_evt: any, data: any) => {
      if (!data?.fatal) return;
      if (destroyedRef.current || userPausedRef.current) return;
      if (retryLockRef.current) return;
      if (retryCountRef.current >= MAX_RETRY) {
        onError?.(data?.error ?? data);
        return;
      }

      retryLockRef.current = true;
      const delay = BASE_DELAY_MS * Math.pow(2, retryCountRef.current);
      clearRetryTimer();

      retryTimerRef.current = window.setTimeout(() => {
        const h = hlsRef.current;
        if (!h) { retryLockRef.current = false; return; }
        try {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR: {
              try { h.stopLoad(); } catch {}
              try { h.startLoad(); } catch {}
              break;
            }
            case Hls.ErrorTypes.MEDIA_ERROR: {
              try { h.recoverMediaError(); } catch {}
              break;
            }
            default: {
              const v: HTMLVideoElement | undefined = dpRef.current?.video;
              destroyHls();
              if (Hls.isSupported() && v) {
                const nh = new Hls({ debug: hlsDebug, enableWorker: true });
                nh.on(Hls.Events.ERROR, onHlsError as any);
                nh.on(Hls.Events.MANIFEST_PARSED, onManifestParsed as any);
                nh.attachMedia(v);
                nh.loadSource(url);
                hlsRef.current = nh;
              }
            }
          }
          retryCountRef.current += 1;
        } catch (e) {
          onError?.(e);
        } finally {
          retryLockRef.current = false;
        }
      }, delay) as unknown as number;
    };

    const createAndAttachHls = () => {
      const v: HTMLVideoElement | undefined = dpRef.current?.video;
      if (!v || hlsRef.current) return;
      if (!Hls.isSupported()) return;

      const h = new Hls({ debug: hlsDebug, enableWorker: true });
      h.on(Hls.Events.ERROR, onHlsError as any);
      h.on(Hls.Events.MANIFEST_PARSED, onManifestParsed as any);
      h.attachMedia(v);
      h.loadSource(url);
      hlsRef.current = h;
    };

    useEffect(() => {
      if (!containerRef.current || !url) return;

      destroyedRef.current = false;
      retryCountRef.current = 0;
      retryLockRef.current = false;
      clearRetryTimer();

      const options: DPlayerOptions = {
        container: containerRef.current,
        autoplay,          // 让 DPlayer 自己先试一次
        muted: false,      // 明确不静音
        preload: 'auto',
        screenshot,
        highlight: [],
        hotkey: true,
        mutex: true,
        contextmenu: [],
        airplay: true,
        playbackSpeed,
        video: {
          url,
          pic: coverUrl,
          type: videoType === 'hls' ? 'hls' : 'normal',
        },
      };

      // 先清理旧实例
      safeDestroy();

      try {
        const dp = new DPlayer(options);
        dpRef.current = dp;

        // 用户播放/暂停：尊重用户意图
        dp.on('play' as DPlayerEvents, () => {
          userPausedRef.current = false;
          try { hlsRef.current?.startLoad?.(); } catch {}
        });
        dp.on('pause' as DPlayerEvents, () => {
          userPausedRef.current = true;
          try { hlsRef.current?.stopLoad?.(); } catch {}
        });

        // 修正点 B：过滤“Empty src attribute”这类无害错误
        const onVideoError = () => {
          const v = dp.video as HTMLVideoElement | undefined;
          const err = v?.error as MediaError | null | undefined;
          if (videoType === 'hls' && err && err.code === 4) {
            const currentSrc = (v?.currentSrc ?? '').trim();
            if (!currentSrc) {
              // Hls attachMedia 早期阶段可能触发一次空 src 错误，忽略
              return;
            }
          }
          onError?.(err ?? new Error('Unknown media error'));
        };
        dp.video?.addEventListener('error', onVideoError);

        if (videoType === 'hls') {
          createAndAttachHls();
        } else {
          tryAutoPlayOnce();
        }

        onReady?.(dp);

        return () => {
          try { dp.video?.removeEventListener('error', onVideoError); } catch {}
          safeDestroy();
        };
      } catch (e) {
        onError?.(e);
      }
      // 关键依赖变化才重建
    }, [url, videoType, autoplay, screenshot, hlsDebug, coverUrl, playbackSpeed]);

    return <div ref={containerRef} />;
  }
);

HlsPlayer.displayName = 'HlsPlayer';
export default HlsPlayer;
