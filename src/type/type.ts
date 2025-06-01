export type ParsedImageResponse = {
  id: string;
  content: string;
};

export type VideoItem = {
  id: string;
  cover_url: string;
  title: string;
  video_url: string;
};

export type GenerationResponse = {
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