// src/components/HlsPlayer.tsx
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useMemo,
} from 'react';
import DPlayer, {DPlayerEvents, type DPlayerOptions} from 'dplayer';
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

// —— 重试相关常量 ——
const MAX_RETRY = 5;
const BASE_DELAY_MS = 1000;

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

    // 重试计数与定时器
    const retryCountRef = useRef(0);
    const retryTimerRef = useRef<number | null>(null);

    // 记录绑定的 hls 事件 handler，便于卸载时 off
    const hlsHandlersRef = useRef<{
      onError?: (event: any, data: any) => void;
      onOk?: () => void;
    }>({});

    // 计算视频类型
    const videoType: 'hls' | 'normal' = useMemo(() => {
      return url?.toLowerCase().endsWith('.m3u8') ? 'hls' : 'normal';
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
          } catch (e) {
            console.error('setPlaybackRate 失败：', e);
          }
        },
        destroy: () => {
          safeDestroy();
        },
      }),
      []
    );

    // —— hls 工具函数 —— //
    const getHls = (): Hls | undefined => {
      const dp: any = dpRef.current;
      return dp?.$hls || dp?.plugins?.hls?.hls; // 兼容不同版本的挂载位置
    };

    const wireHlsEvents = (hls: Hls) => {
      const onOk = () => {
        console.info('Hls 加载/解析成功（LEVEL_LOADED / MANIFEST_PARSED）。');
        resetRetry();
      };
      const onHlsError = (_event: any, data: any) => {
        console.error('Hls ERROR 事件：', {
          type: data?.type,
          details: data?.details,
          fatal: data?.fatal,
          error: data?.error ?? data,
        });
        if (!data?.fatal) return;
        try {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              scheduleRetry('start-load', `网络错误（details=${data?.details}）`);
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              scheduleRetry('recover-media', `媒体错误（details=${data?.details}）`);
              break;
            default:
              scheduleRetry('switch-video', `致命错误（type=${data?.type}）`);
              break;
          }
        } catch (e) {
          console.error('处理 Hls 致命错误时异常：', e);
          onError?.(e);
        }
      };

      // 保存 handler 引用，用于卸载时 off
      hlsHandlersRef.current.onOk = onOk;
      hlsHandlersRef.current.onError = onHlsError;

      hls.on(Hls.Events.ERROR, onHlsError as any);
      hls.on(Hls.Events.LEVEL_LOADED, onOk as any);
      hls.on(Hls.Events.MANIFEST_PARSED, onOk as any);
    };

    /** 若 DPlayer 未创建 hls 实例，则手动创建并接管 */
    const ensureHls = () => {
      if (videoType !== 'hls') return;
      const dp: any = dpRef.current;
      if (!dp?.video) return;

      let hls = getHls();
      if (hls) return;

      if (Hls.isSupported()) {
        console.warn('DPlayer 未挂载 hls，手动接管 hls.js。');
        hls = new Hls({
          debug: hlsDebug,
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 60,
          maxMaxBufferLength: 600,
          maxBufferSize: 50 * 1000 * 1000,
          liveDurationInfinity: false,
          startPosition: 0,
        });
        hls.attachMedia(dp.video);
        hls.loadSource(url);
        // 让后续逻辑也能拿到
        (dp as any).$hls = hls;
        wireHlsEvents(hls);
      } else {
        console.error('当前环境不支持 MSE，无法使用 hls.js。');
      }
    };

    // —— 定时器工具 —— //
    const clearRetryTimer = () => {
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const resetRetry = () => {
      if (retryCountRef.current > 0) console.info('恢复成功，重置重试计数。');
      retryCountRef.current = 0;
      clearRetryTimer();
    };

    // 触发一次重试（指数退避）
    const scheduleRetry = (
      strategy: 'recover-media' | 'start-load' | 'switch-video',
      reason?: string
    ) => {
      if (retryCountRef.current >= MAX_RETRY) {
        console.error('已达到最大重试次数，停止重试。最后错误原因：', reason);
        return;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, retryCountRef.current);
      console.warn(
        `准备重试（第 ${retryCountRef.current + 1}/${MAX_RETRY} 次，策略：${strategy}，延迟：${delay}ms）`,
        reason ? `原因：${reason}` : ''
      );

      try {
        dpRef.current?.notice?.(`正在重试播放${reason ? `（${reason}）` : ''}...`, delay);
      } catch {
      }

      clearRetryTimer();
      retryTimerRef.current = window.setTimeout(() => {
        const dp = dpRef.current;
        const hls: Hls | undefined = getHls();

        try {
          if (strategy === 'recover-media') {
            console.info('调用 recoverMediaError()...');
            hls?.recoverMediaError();
          } else if (strategy === 'start-load') {
            console.info('调用 stopLoad() → startLoad()...');
            try {
              hls?.stopLoad();
            } catch (e) {
              console.warn('stopLoad() 异常：', e);
            }
            hls?.startLoad();
          } else {
            console.info('通过 switchVideo() 触发 Hls 重建...');
            dp?.switchVideo?.({
              url,
              type: videoType === 'hls' ? 'hls' : 'normal',
              pic: coverUrl,
            });
            // 关键：切换后确保 hls 存在（若 DPlayer 仍未挂载则手动接管）
            setTimeout(() => ensureHls(), 0);
            if (autoplay) {
              dp?.play?.().catch(() => {
              });
            }
          }
          retryCountRef.current += 1;
        } catch (e) {
          console.error('重试流程异常：', e);
          onError?.(e);
        }
      }, delay) as unknown as number;
    };

    // 推动播放（卡顿/暂停时触发）
    const nudge = () => {
      const dp: any = dpRef.current;
      const hls = getHls();
      try {
        hls?.startLoad?.();
      } catch {
      }
      try {
        const v: HTMLVideoElement | undefined = dp?.video;
        if (v && v.readyState < 3) {
          v.currentTime = Math.max(0, v.currentTime - 0.001);
        }
      } catch {
      }
      if (autoplay) {
        dp?.play?.()
      }
    };

    // 安全销毁
    const safeDestroy = () => {
      clearRetryTimer();

      try {
        const hls = getHls();
        if (hls) {
          const {onError, onOk} = hlsHandlersRef.current;
          if (onError) hls.off(Hls.Events.ERROR, onError as any);
          if (onOk) {
            hls.off(Hls.Events.LEVEL_LOADED, onOk as any);
            hls.off(Hls.Events.MANIFEST_PARSED, onOk as any);
          }
        }
      } catch (e) {
        console.warn('解绑 Hls 事件时出现异常：', e);
      }

      try {
        (dpRef.current as any)?.$hls?.destroy?.();
      } catch (e) {
        console.warn('销毁内部 $hls 异常：', e);
      }
      try {
        dpRef.current?.destroy?.();
      } catch (e) {
        console.warn('销毁 DPlayer 实例异常：', e);
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
        muted: autoplay, // 提高无手势自动播放的成功率
        preload: 'auto',
        screenshot,
        highlight: [{time: 0, text: ''}],
        hotkey: true,
        mutex: true,
        contextmenu: [],
        airplay: true,
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
        //console.info('DPlayer 初始化完成。', {url, videoType, autoplay});

        // loadedmetadata 后优先展示第一条字幕（如有）
        dp.video?.addEventListener('loadedmetadata', () => {
          try {
            const tracks = dp.video?.textTracks;
            if (tracks && tracks.length > 0) {
              tracks[0].mode = 'showing';
            }
          } catch (e) {
            console.warn('处理字幕时出现异常：', e);
          }
        });

        // 原生 video 错误兜底：触发一次“切换同源视频”的重试
        const onVideoError = () => {
          const mediaError = (dp.video as any)?.error;
          console.error('HTMLVideoElement error 触发：', mediaError);
          scheduleRetry('switch-video', 'video 元素错误');
        };
        dp.video?.addEventListener?.('error', onVideoError);

        // 卡顿/等待/可疑暂停时推动一下
        dp.video?.addEventListener?.('stalled', nudge);
        dp.video?.addEventListener?.('waiting', nudge);
        dp.on?.('pause' as DPlayerEvents, () => {
          const v: HTMLVideoElement | undefined = dpRef.current?.video;
          if (v && !v.ended && v.currentTime + 0.3 < (v.duration || Infinity)) {
            console.warn('检测到异常暂停，尝试恢复拉流。');
            nudge();
          }
        });

        // 尝试获取 DPlayer 内部 hls，否则手动接管
        setTimeout(() => {
          const h = getHls();
          // 只在 HLS 模式下执行 hls 检测
          if (videoType === 'hls') {
            if (h) {
              console.info('检测到 DPlayer 内部 hls 实例。');
              wireHlsEvents(h);
            } else {
              console.warn('未检测到 DPlayer.$hls，将手动接管。');
              ensureHls();
            }
          }
        }, 0);

        onReady?.(dp);

        // 清理
        return () => {
          try {
            dp.video?.removeEventListener?.('error', onVideoError);
            dp.video?.removeEventListener?.('stalled', nudge);
            dp.video?.removeEventListener?.('waiting', nudge);
          } catch (e) {
            console.warn('解绑 video 事件异常：', e);
          }
          safeDestroy();
        };
      } catch (e) {
        console.error('DPlayer 初始化失败：', e);
        onError?.(e);
      }

      // 仅当这些关键参数变化时重建
    }, [url, videoType, autoplay, screenshot, hlsDebug, coverUrl, subtitleUrl, playbackSpeed]);

    return <div ref={containerRef}/>;
  }
);

HlsPlayer.displayName = 'HlsPlayer';

export default HlsPlayer;
