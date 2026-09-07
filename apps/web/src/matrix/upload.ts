import { encryptAttachment, type EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { MsgType, type MatrixClient } from 'matrix-js-sdk';
import type {
  AudioContent,
  FileContent,
  ImageContent,
  MediaEventContent,
  VideoContent,
} from 'matrix-js-sdk/lib/@types/media';

type MediaLocation = { url: string } | { file: EncryptedAttachmentInfo & { url: string } };

function buildMediaContent(
  mimetype: string,
  body: string,
  location: MediaLocation,
  info: { mimetype: string; size: number; w?: number; h?: number }
): MediaEventContent {
  if (mimetype.startsWith('image/')) return { msgtype: MsgType.Image, body, ...location, info } as ImageContent;
  if (mimetype.startsWith('video/')) return { msgtype: MsgType.Video, body, ...location, info } as VideoContent;
  if (mimetype.startsWith('audio/')) return { msgtype: MsgType.Audio, body, ...location, info } as AudioContent;
  return { msgtype: MsgType.File, body, ...location, info } as FileContent;
}

/** Best-effort pixel dimensions for an image file, so the sent event carries `info.w`/`info.h`
 *  up front the same way received images do — that's what lets ImageMessage reserve the right
 *  aspect ratio before the bytes round-trip back down. Skipped for non-images or anything that
 *  fails to decode; the message still sends fine either way. */
async function readImageDimensions(file: File): Promise<{ w: number; h: number } | undefined> {
  if (!file.type.startsWith('image/')) return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { w: bitmap.width, h: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return undefined;
  }
}

/**
 * Uploads a local file and sends it as a room message — the composer's counterpart to how
 * ImageMessage/useAttachmentUrl already receive attachments, just running the same encrypted-
 * attachments spec in reverse. In an encrypted room the file bytes are encrypted client-side
 * (browser-encrypt-attachment, the same library the receive path decrypts with) before upload,
 * and the ciphertext blob is uploaded without its real filename (`includeFilename: false`,
 * matching Element's convention) since the filename itself is only safe inside the already-
 * encrypted event body, not as unencrypted upload metadata.
 */
export async function sendFileMessage(
  mx: MatrixClient,
  roomId: string,
  threadId: string | null,
  file: File
): Promise<void> {
  const mimetype = file.type || 'application/octet-stream';
  const dimensions = await readImageDimensions(file);
  const info = { mimetype, size: file.size, ...dimensions };

  if (mx.isRoomEncrypted(roomId)) {
    const { data, info: encryptInfo } = await encryptAttachment(await file.arrayBuffer());
    const { content_uri: mxcUrl } = await mx.uploadContent(new Blob([data]), {
      type: 'application/octet-stream',
      includeFilename: false,
    });
    const content = buildMediaContent(mimetype, file.name, { file: { ...encryptInfo, url: mxcUrl } }, info);
    await mx.sendMessage(roomId, threadId, content);
    return;
  }

  const { content_uri: mxcUrl } = await mx.uploadContent(file);
  const content = buildMediaContent(mimetype, file.name, { url: mxcUrl }, info);
  await mx.sendMessage(roomId, threadId, content);
}
