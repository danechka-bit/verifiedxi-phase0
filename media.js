// Highlight video handling: parses pasted YouTube/Vimeo links into embeds,
// and saves uploaded video files — to Cloudinary when CLOUDINARY_* env vars
// are set, otherwise to local disk (data/uploads/videos/) as a dev-only
// fallback. Local disk does NOT survive most hosting platforms' ephemeral
// filesystems, so Cloudinary must be configured before deploying — see
// README. Either way, callers only ever get back a URL; nothing else in the
// app cares which one produced it.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads', 'videos');
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024; // 150MB — enough for a short highlight clip
const ALLOWED_EXTENSIONS = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/x-m4v' };

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

let cloudinary = null;
if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET
  });
}

function isCloudConfigured() {
  return !!cloudinary;
}

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Recognizes a YouTube or Vimeo URL and returns {source, embedUrl}, or null
// if the link doesn't match either — callers can still store it as a plain
// outbound link in that case.
function parseVideoLink(url) {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/);
  if (yt) return { source: 'youtube', embedUrl: `https://www.youtube.com/embed/${yt[1]}` };
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return { source: 'vimeo', embedUrl: `https://player.vimeo.com/video/${vimeo[1]}` };
  return null;
}

// Saves a formidable-parsed file — to Cloudinary when configured (returns
// its permanent https:// URL), otherwise under a random local filename
// (the client-supplied filename is never trusted either way). Throws on a
// disallowed extension or an oversized file, checked before any upload.
async function saveUploadedFile(file) {
  const ext = path.extname(file.originalFilename || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS[ext]) {
    throw new Error(`Unsupported video format "${ext}". Allowed: ${Object.keys(ALLOWED_EXTENSIONS).join(', ')}`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Video is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB)`);
  }

  if (cloudinary) {
    const result = await cloudinary.uploader.upload(file.filepath, {
      resource_type: 'video',
      folder: 'verifiedxi'
    });
    fs.unlinkSync(file.filepath); // formidable's own tmp file
    return result.secure_url;
  }

  ensureUploadDir();
  const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  fs.copyFileSync(file.filepath, path.join(UPLOAD_DIR, filename));
  fs.unlinkSync(file.filepath);
  return `/uploads/videos/${filename}`;
}

// Serves a *local-fallback* upload by its already-sanitized filename (no
// path separators allowed — this is the only way in, so directory
// traversal isn't reachable even if a caller forgot to validate upstream).
// Cloudinary-hosted videos never hit this — their stored URL is already the
// full https://res.cloudinary.com/... address, served directly by Cloudinary.
function readUploadedFile(filename) {
  if (!/^[a-f0-9]{32}\.\w+$/.test(filename)) return null;
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filename).toLowerCase();
  return { filePath, contentType: ALLOWED_EXTENSIONS[ext] || 'application/octet-stream' };
}

module.exports = { parseVideoLink, saveUploadedFile, readUploadedFile, isCloudConfigured, MAX_UPLOAD_BYTES, ALLOWED_EXTENSIONS };
