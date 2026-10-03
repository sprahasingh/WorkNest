import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

// Files are uploaded as "authenticated", so they have no public link at all.
// They are only ever fetched by this server, after it has checked that the
// person asking belongs to the conversation.
const UPLOAD_TYPE = "authenticated";

export function isCloudinaryConfigured(): boolean {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
    env.CLOUDINARY_API_KEY &&
    env.CLOUDINARY_API_SECRET,
  );
}

function sha1(value: string): Buffer {
  return createHash("sha1").update(value).digest();
}

function sign(params: Record<string, string | number>): string {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return sha1(toSign + env.CLOUDINARY_API_SECRET).toString("hex");
}

// The browser uploads straight to Cloudinary with this signature, so files
// never pass through (or sit on) the API server.
export function createUploadSignature(folder: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    cloudName: env.CLOUDINARY_CLOUD_NAME!,
    apiKey: env.CLOUDINARY_API_KEY!,
    timestamp,
    folder,
    type: UPLOAD_TYPE,
    signature: sign({ folder, timestamp, type: UPLOAD_TYPE }),
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/auto/upload`,
  };
}

export function isCloudinaryUrl(url: string): boolean {
  return url.startsWith(
    `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/`,
  );
}

// Signed delivery link for an authenticated asset: the signature is the first
// 8 characters of the URL-safe base64 SHA-1 of "<public id><api secret>".
export function signedDeliveryUrl(
  publicId: string,
  resourceType: string,
): string {
  const signature = sha1(publicId + env.CLOUDINARY_API_SECRET)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, 8);
  const path = publicId.split("/").map(encodeURIComponent).join("/");
  return `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/${resourceType}/${UPLOAD_TYPE}/s--${signature}--/${path}`;
}

function adminAuthHeader(): string {
  return `Basic ${Buffer.from(`${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`).toString("base64")}`;
}

// The real size of an uploaded file, or null when Cloudinary can't say. The
// browser's own size limit can be bypassed, so this is the one that counts.
export async function fetchUploadedSize(
  publicId: string,
  resourceType: string,
): Promise<number | null> {
  if (!isCloudinaryConfigured()) return null;
  try {
    const path = publicId.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/resources/${resourceType}/${UPLOAD_TYPE}/${path}`,
      { headers: { Authorization: adminAuthHeader() } },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { bytes?: unknown };
    return typeof body.bytes === "number" ? body.bytes : null;
  } catch (error) {
    logger.warn({ error }, "Could not check an uploaded file's size");
    return null;
  }
}

// Best effort: a failed cleanup should never fail the request.
export async function destroyUpload(
  publicId: string,
  resourceType: string,
): Promise<void> {
  if (!isCloudinaryConfigured()) return;
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = new URLSearchParams({
      public_id: publicId,
      type: UPLOAD_TYPE,
      timestamp: String(timestamp),
      api_key: env.CLOUDINARY_API_KEY!,
      signature: sign({
        public_id: publicId,
        type: UPLOAD_TYPE,
        timestamp,
      }),
    });
    await fetch(
      `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${resourceType}/destroy`,
      { method: "POST", body },
    );
  } catch (error) {
    logger.warn({ error }, "Could not remove an uploaded file");
  }
}
