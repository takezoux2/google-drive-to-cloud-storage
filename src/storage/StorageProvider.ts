export interface UploadParams {
  key: string;
  data: Buffer;
  contentType: string;
}

export interface StorageProvider {
  upload(params: UploadParams): Promise<void>;
  delete(key: string): Promise<void>;
  download(key: string): Promise<Buffer | undefined>;
}
